"""coach_app SQL-bridge connector (analytics pipeline, customer_id scoped)."""
from __future__ import annotations

from typing import Any

from ..config import get_settings
from ..http import post_json
from ..models import ServiceDescriptor, ServiceKind


class CoachAppConnector:
    async def _sql(self, sql: str, params: list[Any] | None = None) -> Any:
        s = get_settings()
        if not s.bridge_url or not s.bridge_secret:
            return None
        status, body = await post_json(
            s.bridge_url, {"sql": sql, "params": params or []},
            headers={"X-Bridge-Key": s.bridge_secret},
        )
        if status == 200 and isinstance(body, dict) and body.get("success"):
            return body.get("data")
        return None

    async def probe(self, domains: list[str]) -> ServiceDescriptor | None:
        """Resolve a customer_id from a company email domain, then count analytics rows."""
        for domain in domains:
            rows = await self._sql(
                "SELECT customer_id FROM coach_app.coach_users WHERE user_email LIKE ? LIMIT 1",
                [f"%@{domain}"],
            )
            if not rows:
                continue
            cid = int(rows[0]["customer_id"])
            if cid <= 0:
                continue
            counts = await self._sql(
                "SELECT COUNT(DISTINCT saved_report_id) AS sessions "
                "FROM rolplay_pro_analytics.report_field_current WHERE customer_id = ?",
                [cid],
            )
            sessions = int((counts or [{}])[0].get("sessions") or 0)
            return ServiceDescriptor(
                kind=ServiceKind.coach_app_sql,
                name=f"coach_app analytics (customer {cid})",
                base_url=get_settings().bridge_url or "",
                alive=True,
                has_data=sessions > 0,
                handle={"customer_id": cid, "domain": domain},
                endpoints=["report_field_current", "saved_reports", "coach_users", "usecases"],
                note=f"customer_id={cid} sessions={sessions}",
            )
        return None
