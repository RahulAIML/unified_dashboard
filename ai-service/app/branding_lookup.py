"""Read-only lookup into the Next.js app's branding_settings table (same
shared Postgres auth DB tenant_credentials.py already reads) so a generated
dashboard can use a tenant's REAL saved colors instead of one hardcoded
default for every company.

Write side lives in Next.js: PUT /api/admin/tenant-branding upserts a row
keyed exactly like this reads it (`domain:<domain>`) — the same key scheme
lib/db-branding.ts's org-wide fallback already uses for signed-in users at
that domain, so one saved value serves both surfaces consistently.

No row for a domain (the common case today -- almost nothing writes here
yet) is not an error: this returns None and the caller keeps its default.
"""
from __future__ import annotations


async def lookup_tenant_branding(domains: list[str]) -> dict[str, str] | None:
    from .db import get_pool

    pool = await get_pool()
    if not pool or not domains:
        return None

    for domain in domains:
        d = (domain or "").strip().lower()
        if not d:
            continue
        try:
            row = await pool.fetchrow(
                """SELECT logo_url, primary_color, secondary_color, accent_color
                     FROM branding_settings WHERE tenant_key = $1 LIMIT 1""",
                f"domain:{d}",
            )
        except Exception:
            # No table yet (fresh/unmigrated DB) or a transient outage —
            # branding is cosmetic, never worth failing dashboard generation
            # over. Matches tenant_credentials.py's identical rationale.
            return None
        if row:
            return {
                "logo_url": row["logo_url"],
                "primary_color": row["primary_color"],
                "secondary_color": row["secondary_color"],
                "accent_color": row["accent_color"],
            }
    return None
