"""Rolplay-app raw-SQL connector (SELECT-only endpoint). Sessions + scores."""
from __future__ import annotations

from typing import Any

from ..config import get_settings
from ..http import post_json
from ..models import ServiceDescriptor, ServiceKind
from ..rolplay_score import score_stats_sql


class RolplayAppConnector:
    async def _sql(self, sql: str) -> Any:
        url = get_settings().rolplay_app_sql_url
        status, body = await post_json(url, {"sql": sql})
        if status == 200 and isinstance(body, dict) and body.get("result") == "success":
            return body.get("data")
        return None

    async def probe(self, company: str) -> ServiceDescriptor | None:
        safe = company.replace("'", "''")
        rows = await self._sql(
            f"SELECT ID, name FROM r_client WHERE name LIKE '%{safe}%' ORDER BY ID LIMIT 1"
        )
        if not rows:
            return None
        client_id = int(rows[0]["ID"])
        counts = await self._sql(
            "SELECT COUNT(s.ID) AS sessions, COUNT(DISTINCT u.ID) AS users "
            "FROM r_user u LEFT JOIN r_user_session s ON s.user_id=u.ID "
            f"WHERE u.client_id={client_id}"
        )
        sessions = int((counts or [{}])[0].get("sessions") or 0)
        users = int((counts or [{}])[0].get("users") or 0)

        # Real score coverage: how many sessions yield a 0-100 score from
        # raw_closing_data / closing_analysis (not the empty legacy column).
        stats = await self._sql(score_stats_sql(client_id))
        srow = (stats or [{}])[0] if stats else {}
        scored = int(srow.get("scored") or 0)
        avg = srow.get("avg_score")
        score_note = (
            f"avg={avg} ({scored}/{sessions} scored)" if scored > 0 else "no scores → counts-only"
        )

        return ServiceDescriptor(
            kind=ServiceKind.rolplay_app_sql,
            name=f"{rows[0]['name']} (rolplay-app)",
            base_url=get_settings().rolplay_app_sql_url,
            alive=True,
            has_data=sessions > 0,
            handle={"client_id": client_id, "display_name": rows[0]["name"]},
            endpoints=["r_user_session", "r_user", "r_simulator"],
            note=f"client_id={client_id} sessions={sessions} users={users} {score_note}",
        )
