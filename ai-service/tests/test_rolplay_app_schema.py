"""Regression test for schema_discovery._rolplay_app_schema.

Locks in a real gap found while investigating why the builder showed
"no data available" for a rolplay-app client (Takeda): the function left
schema.modules and schema.date_range unset for EVERY rolplay-app client, so
the builder could not tell a Coach-only client from a full one and had no
observed window to render trends over.

Verified live against production data before this test was written (see the
commit message): Takeda -> modules=['coach'], window 2026-05-09..2026-05-11,
5/5 sessions scored via raw_closing_data. This test pins that shape with a
mocked SQL endpoint so it can't regress silently.
"""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.agents import schema_discovery
from app.models import ConfidenceLevel, NormalizedSchema, ServiceDescriptor, ServiceKind


def _svc(client_id: int) -> ServiceDescriptor:
    return ServiceDescriptor(
        kind=ServiceKind.rolplay_app_sql,
        name="Test Co (rolplay-app)",
        base_url="https://rolplay.app/ajax/remote-access.php",
        alive=True,
        has_data=True,
        handle={"client_id": client_id, "display_name": "Test Co"},
        endpoints=["r_user_session", "r_user", "r_simulator"],
    )


async def _noop_log(*_args):
    return None


class RolplayAppSchemaTests(unittest.TestCase):
    def _run(self, client_id: int, category_rows, scored_count: int) -> NormalizedSchema:
        """post_json is called twice per client: scored-count, then category groupby."""
        calls = {"n": 0}

        async def fake_post_json(_url, payload):
            calls["n"] += 1
            sql = payload["sql"]
            if "GROUP BY sim.category" in sql:
                return 200, {"result": "success", "data": category_rows}
            return 200, {"result": "success", "data": [{"scored": scored_count}]}

        schema = NormalizedSchema(company="Test Co", slug="test-co")
        with patch("app.agents.schema_discovery.post_json", new=AsyncMock(side_effect=fake_post_json)):
            asyncio.run(schema_discovery._rolplay_app_schema(_svc(client_id), schema, _noop_log))
        self.assertEqual(calls["n"], 2, "expected exactly one scored-count call and one module/date-range call")
        return schema

    def test_discovers_modules_from_category(self) -> None:
        schema = self._run(
            13,
            [{"category": "COACH", "min_d": "2026-05-09 04:06:53", "max_d": "2026-05-11 09:01:20"}],
            scored_count=5,
        )
        self.assertEqual(schema.modules, ["coach"])
        self.assertEqual(schema.date_range, ("2026-05-09", "2026-05-11"))

    def test_excludes_second_brain_category(self) -> None:
        # Takeda's real shape: 2 COACH + 3 SB sessions. SB must never appear as
        # a rolplay-app module — it has its own dedicated, token-authenticated
        # API and must not be double-counted through this one.
        schema = self._run(
            13,
            [
                {"category": "COACH", "min_d": "2026-05-09 00:00:00", "max_d": "2026-05-11 00:00:00"},
                {"category": "SB", "min_d": "2026-05-01 00:00:00", "max_d": "2026-05-20 00:00:00"},
            ],
            scored_count=5,
        )
        self.assertEqual(schema.modules, ["coach"])
        # The SB-only window must not widen the reported range either.
        self.assertEqual(schema.date_range, ("2026-05-09", "2026-05-11"))

    def test_multiple_modules_in_category_order(self) -> None:
        schema = self._run(
            29,
            [
                {"category": "SIM", "min_d": "2026-06-23 00:00:00", "max_d": "2026-07-24 00:00:00"},
                {"category": "SEGMENT", "min_d": "2026-06-01 00:00:00", "max_d": "2026-06-05 00:00:00"},
            ],
            scored_count=136,
        )
        self.assertEqual(set(schema.modules), {"simulator", "certification"})
        self.assertEqual(schema.date_range, ("2026-06-01", "2026-07-24"))

    def test_still_adds_score_metrics_when_scored_rows_exist(self) -> None:
        # This must keep working exactly as before — the module/date-range
        # addition must not disturb the existing, verified score-extraction path.
        schema = self._run(
            13, [{"category": "COACH", "min_d": "2026-05-09 00:00:00", "max_d": "2026-05-11 00:00:00"}],
            scored_count=5,
        )
        keys = {m.key for m in schema.metrics}
        self.assertIn("avg_score", keys)
        self.assertIn("pass_rate", keys)

    def test_no_modules_or_range_without_a_client_id(self) -> None:
        schema = NormalizedSchema(company="X", slug="x")
        svc = _svc(0)
        asyncio.run(schema_discovery._rolplay_app_schema(svc, schema, _noop_log))
        self.assertEqual(schema.modules, [])
        self.assertIsNone(schema.date_range)

    def test_bridge_failure_during_discovery_is_flagged_not_silently_empty(self) -> None:
        """Regression: post_json never raises -- a network error/timeout comes
        back as {"__error": "..."} (app/http.py), which the old code reduced
        straight to scored=0/modules=[] with no distinction from a client that
        genuinely has zero data. A real client with real modules must never
        be reported as "verified: no capabilities" just because the bridge
        was briefly unreachable during discovery -- that must show up as an
        explicit warning in schema.note, not a clean empty result."""
        async def failing_post_json(_url, _payload):
            return 0, {"__error": "TimeoutError: rolplay-app SQL timed out after 20 seconds"}

        schema = NormalizedSchema(company="Test Co", slug="test-co")
        with patch("app.agents.schema_discovery.post_json", new=AsyncMock(side_effect=failing_post_json)):
            asyncio.run(schema_discovery._rolplay_app_schema(_svc(13), schema, _noop_log))

        self.assertEqual(schema.modules, [])
        self.assertIn("WARNING", schema.note)
        self.assertIn("failed", schema.note.lower())

    def test_one_query_failing_still_flags_the_warning(self) -> None:
        """Only the module/date-range query fails; the score-count query
        succeeds. The warning must still surface -- a partial failure is
        still a failure, not a clean result with one gap silently absorbed."""
        async def fake_post_json(_url, payload):
            if "GROUP BY sim.category" in payload["sql"]:
                return 0, {"__error": "connection reset"}
            return 200, {"result": "success", "data": [{"scored": 5}]}

        schema = NormalizedSchema(company="Test Co", slug="test-co")
        with patch("app.agents.schema_discovery.post_json", new=AsyncMock(side_effect=fake_post_json)):
            asyncio.run(schema_discovery._rolplay_app_schema(_svc(13), schema, _noop_log))

        self.assertEqual(schema.modules, [])
        self.assertIn("WARNING", schema.note)
        # The score-derived metrics must still be added -- that query genuinely succeeded.
        keys = {m.key for m in schema.metrics}
        self.assertIn("avg_score", keys)

    def test_successful_discovery_never_carries_the_warning(self) -> None:
        schema = self._run(
            13, [{"category": "COACH", "min_d": "2026-05-09 00:00:00", "max_d": "2026-05-11 00:00:00"}],
            scored_count=5,
        )
        self.assertNotIn("WARNING", schema.note)


class CapabilityAndBusinessQuestionTests(unittest.TestCase):
    """Semantic-layer additions: each rolplay_app_sql module becomes a typed
    Capability (business_concept + confidence + evidence), and every metric
    carries the real business question it answers -- never a bare metric
    key. Additive only; the existing modules/date_range/metrics shape is
    untouched (covered by RolplayAppSchemaTests above)."""

    def _run(self, client_id: int, category_rows, scored_count: int) -> NormalizedSchema:
        async def fake_post_json(_url, payload):
            sql = payload["sql"]
            if "GROUP BY sim.category" in sql:
                return 200, {"result": "success", "data": category_rows}
            return 200, {"result": "success", "data": [{"scored": scored_count}]}

        schema = NormalizedSchema(company="Test Co", slug="test-co")
        with patch("app.agents.schema_discovery.post_json", new=AsyncMock(side_effect=fake_post_json)):
            asyncio.run(schema_discovery._rolplay_app_schema(_svc(client_id), schema, _noop_log))
        return schema

    def test_one_capability_per_discovered_module(self) -> None:
        schema = self._run(
            29,
            [
                {"category": "SIM", "min_d": "2026-06-23 00:00:00", "max_d": "2026-07-24 00:00:00"},
                {"category": "SEGMENT", "min_d": "2026-06-01 00:00:00", "max_d": "2026-06-05 00:00:00"},
            ],
            scored_count=136,
        )
        self.assertEqual(len(schema.capabilities), 2)
        modules = {c.module for c in schema.capabilities}
        self.assertEqual(modules, {"simulator", "certification"})

    def test_capabilities_are_verified_confidence_with_evidence(self) -> None:
        schema = self._run(
            13, [{"category": "COACH", "min_d": "2026-05-09 00:00:00", "max_d": "2026-05-11 00:00:00"}],
            scored_count=5,
        )
        cap = schema.capabilities[0]
        self.assertEqual(cap.confidence, ConfidenceLevel.verified)
        self.assertTrue(cap.evidence)
        self.assertEqual(cap.business_concept, "Master Coach")

    def test_no_capabilities_without_a_client_id(self) -> None:
        schema = NormalizedSchema(company="X", slug="x")
        asyncio.run(schema_discovery._rolplay_app_schema(_svc(0), schema, _noop_log))
        self.assertEqual(schema.capabilities, [])

    def test_every_metric_carries_a_business_question(self) -> None:
        schema = self._run(
            13, [{"category": "COACH", "min_d": "2026-05-09 00:00:00", "max_d": "2026-05-11 00:00:00"}],
            scored_count=5,
        )
        for m in schema.metrics:
            self.assertTrue(m.business_question, f"{m.key} has no business_question")

    def test_counts_only_metrics_still_carry_business_questions(self) -> None:
        schema = self._run(
            13, [{"category": "COACH", "min_d": "2026-05-09 00:00:00", "max_d": "2026-05-11 00:00:00"}],
            scored_count=0,
        )
        keys = {m.key: m.business_question for m in schema.metrics}
        self.assertIn("How many practice sessions have reps completed?", keys["total_sessions"])


if __name__ == "__main__":
    unittest.main()
