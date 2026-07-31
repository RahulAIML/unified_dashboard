"""Read + rollback for dashboard_versions.

publish.py has always appended a snapshot row here on every publish
(dashboard_versions: slug, version, config, created_at) -- but until now
nothing ever read it back. That means every publish was effectively
irreversible: a bad Gemini plan or a wrong manual edit could only be fixed
by generating and republishing from scratch, with the previous good state
gone from view (still in the table, just unreachable).

Rollback here is additive, never destructive: restoring an old version
writes it back as dashboard_metadata's CURRENT config (what /d/[slug] and
the ai-service /ai/render endpoint serve) AND appends its own new row to
dashboard_versions, so rolling back is itself always undoable -- history
only ever grows.

Deliberately does NOT touch pharma_tenants / rolplay_app_domains (publish.py's
connector/login-routing side effects): a content rollback restores WIDGETS
AND LAYOUT, not which data source or which domain routes to this tenant --
those haven't changed just because the dashboard's content is being reverted.
"""
from __future__ import annotations

import json

from .db import get_pool
from .models import DashboardConfig


class VersionSummary(dict):
    """version, created_at -- kept light for a list view (no full config)."""


async def list_versions(slug: str) -> list[dict]:
    pool = await get_pool()
    if not pool:
        return []
    rows = await pool.fetch(
        "SELECT version, created_at FROM dashboard_versions WHERE slug=$1 ORDER BY version DESC",
        slug,
    )
    return [{"version": r["version"], "created_at": r["created_at"].isoformat()} for r in rows]


async def get_version_config(slug: str, version: int) -> DashboardConfig | None:
    pool = await get_pool()
    if not pool:
        return None
    row = await pool.fetchrow(
        "SELECT config FROM dashboard_versions WHERE slug=$1 AND version=$2",
        slug, version,
    )
    if not row:
        return None
    return DashboardConfig.model_validate(json.loads(row["config"]))


async def rollback_to(slug: str, version: int) -> DashboardConfig | None:
    """Restore `version` as the CURRENT published config. Returns the
    restored config, or None if that slug/version doesn't exist."""
    pool = await get_pool()
    if not pool:
        return None

    old = await get_version_config(slug, version)
    if not old:
        return None

    row = await pool.fetchrow(
        """INSERT INTO dashboard_metadata (slug, company, config, version, published, updated_at)
             VALUES ($1,$2,$3::jsonb,$4,TRUE,NOW())
           ON CONFLICT (slug) DO UPDATE SET config=EXCLUDED.config,
             version=dashboard_metadata.version+1, published=TRUE, updated_at=NOW()
           RETURNING version""",
        slug, old.company, old.model_dump_json(), old.version,
    )
    new_version = row["version"] if row else old.version
    restored = old.model_copy(update={"version": new_version})

    await pool.execute(
        "INSERT INTO dashboard_versions (slug, version, config) VALUES ($1,$2,$3::jsonb)",
        slug, new_version, restored.model_dump_json(),
    )
    return restored
