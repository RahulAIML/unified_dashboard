"""Second Brain connector (conversational/coaching org data by admin_email).

Each tenant's admin account follows the admin1@{domain} provisioning
convention — there is no shared/global admin email. A candidate must be
derived from the company's OWN domain(s); falling back to a fixed env-var
admin email would leak whichever org that email belongs to (e.g. Coppel's)
into every company that doesn't have its own Second Brain org.
"""
from __future__ import annotations

from ..config import get_settings
from ..http import get_json
from ..models import ServiceDescriptor, ServiceKind

_GENERIC_DOMAINS = {
    "gmail.com", "hotmail.com", "outlook.com", "yahoo.com",
    "icloud.com", "protonmail.com", "live.com", "aol.com",
}


class SecondBrainConnector:
    async def probe(self, domains: list[str]) -> ServiceDescriptor | None:
        s = get_settings()
        if not s.second_brain_api_url:
            return None
        seen: set[str] = set()
        candidates: list[str] = []
        for d in domains:
            domain = d.lower().strip()
            if domain and domain not in _GENERIC_DOMAINS and domain not in seen:
                seen.add(domain)
                candidates.append(f"admin1@{domain}")
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
