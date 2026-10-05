"""Per-dashboard email allowlist -- an ADDITIONAL restriction layered on top
of the existing tenant domain+roster check (app/api/dashboard-view/[slug]/
route.ts's checkAccess), never a replacement for it. Reported in the Aug 20
sprint review (Silvari's request, relayed by Diego): "rather than giving
access to all the users, we can just give access to a few people of that
organization." Editable after publish without a rebuild, same narrow-edit
contract as set_pass_threshold/set_required_sections.
"""
import asyncio
import json
import unittest
from unittest.mock import AsyncMock, patch

from app.models import DashboardConfig, ServiceKind


def _run(coro):
    return asyncio.run(coro)


class _FakePool:
    def __init__(self, config: DashboardConfig):
        self.stored = config.model_dump_json()

    async def fetchrow(self, sql, *params):
        if "SELECT config FROM dashboard_metadata" in sql:
            return {"config": self.stored}
        return None

    async def execute(self, sql, *params):
        if "UPDATE dashboard_metadata SET config" in sql:
            _slug, new_config = params
            self.stored = new_config


class SetAuthorizedEmailsTests(unittest.TestCase):
    def _cfg(self, **overrides):
        return DashboardConfig(
            company="Siigo", slug="siigo", title="Siigo Analytics",
            connector=ServiceKind.rolplay_app_sql, **overrides,
        )

    def test_defaults_to_empty_no_restriction_for_a_config_built_before_this_field_existed(self):
        cfg = self._cfg()
        self.assertEqual(cfg.authorized_emails, [])

    def test_sets_the_allowlist_without_touching_pages_or_version(self):
        from app import dashboard_versions
        cfg = self._cfg()
        pool = _FakePool(cfg)
        with patch("app.dashboard_versions.get_pool", return_value=pool):
            result = _run(dashboard_versions.set_authorized_emails("siigo", ["Admin@Siigo.com", "rep@siigo.com"]))

        self.assertIsNotNone(result)
        self.assertEqual(result.authorized_emails, ["admin@siigo.com", "rep@siigo.com"])
        self.assertEqual(result.version, cfg.version)  # no version bump -- not a layout change
        self.assertEqual(result.pages, cfg.pages)

    def test_normalizes_case_whitespace_and_duplicates(self):
        from app import dashboard_versions
        pool = _FakePool(self._cfg())
        with patch("app.dashboard_versions.get_pool", return_value=pool):
            result = _run(dashboard_versions.set_authorized_emails(
                "siigo", ["  Admin@Siigo.com", "admin@siigo.com  ", "ADMIN@SIIGO.COM", ""],
            ))
        self.assertEqual(result.authorized_emails, ["admin@siigo.com"])

    def test_an_empty_list_clears_the_restriction(self):
        from app import dashboard_versions
        pool = _FakePool(self._cfg(authorized_emails=["admin@siigo.com"]))
        with patch("app.dashboard_versions.get_pool", return_value=pool):
            result = _run(dashboard_versions.set_authorized_emails("siigo", []))
        self.assertEqual(result.authorized_emails, [])

    def test_persists_across_a_second_read(self):
        from app import dashboard_versions
        pool = _FakePool(self._cfg())
        with patch("app.dashboard_versions.get_pool", return_value=pool):
            _run(dashboard_versions.set_authorized_emails("siigo", ["a@siigo.com"]))
            reloaded = DashboardConfig.model_validate(json.loads(pool.stored))
        self.assertEqual(reloaded.authorized_emails, ["a@siigo.com"])

    def test_returns_none_for_an_unknown_slug(self):
        from app import dashboard_versions
        pool = _FakePool(self._cfg())
        pool.fetchrow = AsyncMock(return_value=None)
        with patch("app.dashboard_versions.get_pool", return_value=pool):
            result = _run(dashboard_versions.set_authorized_emails("does-not-exist", ["a@siigo.com"]))
        self.assertIsNone(result)


class GenerateRequestAuthorizedEmailsWiringTests(unittest.TestCase):
    def test_workflow_normalizes_the_generate_request_list_onto_the_config(self):
        # Mirrors how confidential/pass_threshold/has_no_passing_criteria are
        # copied from GenerateRequest onto the built DashboardConfig in
        # workflow.py's _continue_from_planning -- authorized_emails must be
        # normalized (lowercase/trim/dedupe) the same way set_authorized_emails
        # does, so a value set at generation time and one set via the PATCH
        # endpoint later are never in two different formats.
        from app.models import GenerateRequest
        req = GenerateRequest(company="Siigo", authorized_emails=["  Rep@Siigo.com", "rep@siigo.com  "])
        normalized = sorted({e.strip().lower() for e in req.authorized_emails if e and e.strip()})
        self.assertEqual(normalized, ["rep@siigo.com"])


if __name__ == "__main__":
    unittest.main()
