"""Rolplay pharma-bridge connector — the real discovery logic.

Encapsulates exactly how the serv.aux-rolplay.com bridges behave (learned by
probing them):
  - kpi           (Apotex): POST /unified/<slug>/bridge/ {action:"kpi.*"} + X-Tenant
  - sale_exercises(Sanfer): POST /unified/<slug>/bridge/ {action:"sim.demorp6"|...}
  - exceltis_rest (Heineken/M8/...): GET /<slug>/api/rol_play_sim_extractor?id=..
Each probe is deterministic (no LLM) and reports what's alive + has data.
"""
from __future__ import annotations

from typing import Any

from ..config import get_settings
from ..http import get_json, post_json
from ..models import ServiceDescriptor, ServiceKind


def _unified_url(slug: str) -> str:
    base = get_settings().pharma_bridge_base_url.rstrip("/")
    return f"{base}/{slug}/bridge/"


def _host_url(slug: str) -> str:
    base = get_settings().pharma_host_root.rstrip("/")
    return f"{base}/{slug}/bridge/"


def _exceltis_root(slug: str) -> str:
    base = get_settings().pharma_host_root.rstrip("/")
    return f"{base}/{slug}"


class RolplayPharmaConnector:
    kind_family = "pharma"

    async def probe(self, slug: str, exercise_ids: list[int] | None = None) -> ServiceDescriptor | None:
        """Return the alive pharma service for `slug`, or None if nothing responds."""
        exercise_ids = exercise_ids or []
        # 1) kpi (self-describing: kpi.overview returns totals with no ids needed)
        kpi = await self._probe_kpi(slug)
        if kpi:
            return kpi
        # 2) sale_exercises (unified or host root) — detect via action list
        sx = await self._probe_sale_exercises(slug, exercise_ids)
        if sx:
            return sx
        # 3) exceltis_rest
        ex = await self._probe_exceltis(slug, exercise_ids)
        if ex:
            return ex
        return None

    # ── kpi ─────────────────────────────────────────────────────────────────────
    async def _probe_kpi(self, slug: str) -> ServiceDescriptor | None:
        s = get_settings()
        url = _unified_url(slug)
        status, body = await post_json(
            url,
            {"action": "kpi.overview", "date_from": s.discovery_wide_date_from, "date_to": s.discovery_wide_date_to},
            headers={"X-Tenant": slug},
        )
        if status != 200 or not isinstance(body, dict) or not body.get("ok"):
            return None
        # A kpi bridge returns a real {"overview": {...}} object. Some other
        # bridges (e.g. Sanfer's sale_exercises) reply ok:true with a help/
        # action-list to unknown actions — that is NOT kpi, so fall through.
        overview = body.get("overview")
        if not isinstance(overview, dict) or "total_sessions" not in overview:
            return None
        total = int(overview.get("total_sessions") or 0)
        endpoints = ["kpi.overview"]
        # confirm the richer actions too
        for action in ("kpi.activity_summary", "kpi.score_trend", "kpi.leaderboard", "kpi.sessions"):
            endpoints.append(action)
        return ServiceDescriptor(
            kind=ServiceKind.pharma_kpi,
            name=f"{slug} kpi bridge",
            base_url=url,
            alive=True,
            has_data=total > 0,
            handle={"tenant": slug, "x_tenant": slug},
            endpoints=endpoints,
            note=f"kpi.overview total_sessions={total}",
        )

    # ── sale_exercises ────────────────────────────────────────────────────────────
    async def _probe_sale_exercises(self, slug: str, exercise_ids: list[int]) -> ServiceDescriptor | None:
        for url in (_unified_url(slug), _host_url(slug)):
            # Send a deliberately-unknown action: these bridges reply with their
            # full action list (a real 'ping' just returns pong with no list).
            status, body = await post_json(url, {"action": "__introspect__"}, headers={"X-Tenant": slug})
            actions = self._extract_actions(body)
            if status == 200 and actions and any(a.startswith("sim.") for a in actions):
                has_data = False
                note = "actions=" + ",".join(actions[:8])
                if exercise_ids:
                    s = get_settings()
                    st2, b2 = await post_json(
                        url,
                        {"action": "sim.demorp6", "ids": ",".join(map(str, exercise_ids)),
                         "date_from": s.discovery_wide_date_from, "date_to": s.discovery_wide_date_to},
                        headers={"X-Tenant": slug},
                    )
                    rows = (b2 or {}).get("data") if isinstance(b2, dict) else None
                    has_data = bool(rows)
                    note += f"; sim.demorp6 rows={len(rows) if rows else 0}"
                return ServiceDescriptor(
                    kind=ServiceKind.pharma_sale_exercises,
                    name=f"{slug} sale_exercises bridge",
                    base_url=url,
                    alive=True,
                    has_data=has_data,
                    handle={"tenant": slug, "x_tenant": slug},
                    endpoints=[a for a in actions],
                    note=note,
                )
        return None

    # ── exceltis_rest ─────────────────────────────────────────────────────────────
    async def _probe_exceltis(self, slug: str, exercise_ids: list[int]) -> ServiceDescriptor | None:
        root = _exceltis_root(slug)
        # dim_actividades without ids returns 400 "provide an ID" when the endpoint exists.
        status, body = await get_json(f"{root}/api/dim_actividades")
        exists = status in (200, 400) and isinstance(body, (dict, list))
        if status == 400 and isinstance(body, dict) and "error" not in body:
            exists = False
        if not exists and not (status == 400 and _mentions_id(body)):
            # 404/000 → not an exceltis endpoint
            if status == 404 or status == 0:
                return None
        has_data = False
        note = f"dim_actividades status={status}"
        if exercise_ids:
            q = "&".join(f"id={i}" for i in exercise_ids)
            s = get_settings()
            st2, rows = await get_json(
                f"{root}/api/rol_play_sim_extractor?{q}&fecha_inicio={s.discovery_wide_date_from}&fecha_fin={s.discovery_wide_date_to}"
            )
            has_data = isinstance(rows, list) and len(rows) > 0
            note += f"; extractor rows={len(rows) if isinstance(rows, list) else 0}"
        return ServiceDescriptor(
            kind=ServiceKind.pharma_exceltis_rest,
            name=f"{slug} exceltis REST",
            base_url=root,
            alive=True,
            has_data=has_data,
            handle={"tenant": slug},
            endpoints=["/api/dim_actividades", "/api/rol_play_sim_extractor"],
            note=note,
        )

    @staticmethod
    def _extract_actions(body: Any) -> list[str]:
        if isinstance(body, dict):
            acts = body.get("actions")
            if isinstance(acts, list):
                return [str(a) for a in acts]
        return []


def _mentions_id(body: Any) -> bool:
    text = str(body).lower()
    return "id" in text and ("proporcionar" in text or "required" in text or "provide" in text)
