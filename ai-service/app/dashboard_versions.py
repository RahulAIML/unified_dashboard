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

from .agents.dashboard_planning import mandatory_empty_page
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
    # ORDER BY + LIMIT for determinism: publish.py had a bug (fixed
    # alongside this) where every publish before 2026-07-31 stored the SAME
    # hardcoded version=1, so some existing slugs have several DIFFERENT
    # real configs all sharing that version number. Without an explicit
    # order, which one this returns is whatever Postgres happens to pick --
    # picking the most recent keeps behaviour predictable for that
    # already-ambiguous historical data; every publish going forward has a
    # correctly unique version and this ORDER BY is a no-op for those.
    row = await pool.fetchrow(
        "SELECT config FROM dashboard_versions WHERE slug=$1 AND version=$2 ORDER BY created_at DESC LIMIT 1",
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


async def set_required_sections(slug: str, sections: list[str]) -> DashboardConfig | None:
    """Update which services are contracted (DashboardConfig.required_sections)
    WITHOUT a full regenerate -- no schema re-discovery, no re-planning, no
    new LLM call. A newly-required service with no matching page gets a
    mandatory empty-state page appended directly (mandatory_empty_page);
    dropping a service from the list removes its stand-in page again, but
    only if that page never picked up any real data in the meantime (a page
    that now has real widgets stays, regardless of the flag).

    This intentionally does NOT go through publish.py's freeze gate or bump
    `version` / write a dashboard_versions snapshot -- it's a metadata-only
    patch to the live config, and it IS the explicit human action the
    post-launch freeze exists to still allow.
    """
    pool = await get_pool()
    if not pool:
        return None
    row = await pool.fetchrow("SELECT config FROM dashboard_metadata WHERE slug=$1", slug)
    if not row:
        return None
    cfg = DashboardConfig.model_validate(json.loads(row["config"]))

    required = sorted(set(sections))
    cfg.required_sections = required
    existing_ids = {p.id for p in cfg.pages}
    for service in required:
        if service in existing_ids:
            continue
        page = mandatory_empty_page(service)
        if page:
            cfg.pages.append(page)

    still_wanted = set(required)
    cfg.pages = [
        p for p in cfg.pages
        if not p.mandatory or any(r.widgets for r in p.rows) or p.id in still_wanted
    ]
    cfg.rows = cfg.pages[0].rows if cfg.pages else []

    await pool.execute(
        "UPDATE dashboard_metadata SET config=$2::jsonb, updated_at=NOW() WHERE slug=$1",
        slug, cfg.model_dump_json(),
    )
    return cfg


async def set_pass_threshold(slug: str, pass_threshold: int, has_no_passing_criteria: bool) -> DashboardConfig | None:
    """Update the pass/fail bar (DashboardConfig.pass_threshold /
    has_no_passing_criteria) WITHOUT a full regenerate -- no schema
    re-discovery, no re-planning, no new LLM call, and the page/widget
    LAYOUT is left completely untouched (same pages, same widgets, same
    order). /ai/render/{slug} re-fetches every widget's live data on every
    call (30s cache, see routes/ai.py), so the very next view reflects the
    new threshold on every affected KPI/chart automatically -- nothing here
    needs to re-fetch or re-bake data itself.

    Same sanctioned exception to the post-launch freeze as
    set_required_sections above: no version bump, no dashboard_versions
    snapshot, because this is a metadata-only patch to the live config, not
    a content/layout change.
    """
    pool = await get_pool()
    if not pool:
        return None
    row = await pool.fetchrow("SELECT config FROM dashboard_metadata WHERE slug=$1", slug)
    if not row:
        return None
    cfg = DashboardConfig.model_validate(json.loads(row["config"]))

    cfg.pass_threshold = pass_threshold
    cfg.has_no_passing_criteria = has_no_passing_criteria

    await pool.execute(
        "UPDATE dashboard_metadata SET config=$2::jsonb, updated_at=NOW() WHERE slug=$1",
        slug, cfg.model_dump_json(),
    )
    return cfg
