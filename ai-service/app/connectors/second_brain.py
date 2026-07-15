"""Second Brain connector (conversational/coaching org data by admin_email)."""
from __future__ import annotations

from ..config import get_settings
from ..http import get_json
from ..models import ServiceDescriptor, ServiceKind


class SecondBrainConnector:
    async def probe(self, domains: list[str]) -> ServiceDescriptor | None:
        s = get_settings()
        if not s.second_brain_api_url:
            return None
        candidates: list[str] = []
        for d in domains:
            candidates.append(f"admin@{d}")
        if s.second_brain_admin_email:
            candidates.append(s.second_brain_admin_email)
        headers = {"Accept": "application/json"}
        if s.second_brain_api_token:
            headers["Authorization"] = f"Bearer {s.second_brain_api_token}"
        seen: set[str] = set()
        for email in candidates:
            if email.lower() in seen:
                continue
            seen.add(email.lower())
            status, body = await get_json(
                f"{s.second_brain_api_url}/organizations/full-profile?admin_email={email}", headers=headers
            )
            if status == 200 and isinstance(body, dict):
                org = body.get("organization") or {}
                stats = body.get("stats") or {}
                return ServiceDescriptor(
                    kind=ServiceKind.second_brain,
                    name=f"Second Brain ({org.get('name') or email})",
                    base_url=s.second_brain_api_url,
                    alive=True,
                    has_data=bool(stats.get("total_coaching_sessions") or stats.get("total_message_logs")),
                    handle={"admin_email": email, "org_name": org.get("name")},
                    endpoints=["/organizations/full-profile"],
                    note=f"members={stats.get('total_members')} coaching_sessions={stats.get('total_coaching_sessions')}",
                )
        return None
