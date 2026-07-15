"""Agent 9 — Publish.

Persist the dashboard config (dashboard_metadata + versions) AND make it live in
the current Rolplay architecture by upserting the pharma_tenants row the Next.js
app already renders from — no code change, no redeploy. Reuses existing tables.
"""
from __future__ import annotations

import json

from ..db import get_pool
from ..models import DashboardConfig, ServiceKind
from .base import LogFn

_KIND_MAP = {
    ServiceKind.pharma_kpi: "kpi",
    ServiceKind.pharma_sale_exercises: "sale_exercises",
    ServiceKind.pharma_exceltis_rest: "exceltis_rest",
}


async def run(cfg: DashboardConfig, domains: list[str], log: LogFn) -> bool:
    pool = await get_pool()
    if not pool:
        await log("publish", "warn", "No database configured — config validated but not persisted")
        return False

    # 1) store the metadata-driven config (source of truth for dynamic rendering)
    await pool.execute(
        """INSERT INTO dashboard_metadata (slug, company, config, version, published, updated_at)
           VALUES ($1,$2,$3::jsonb,$4,TRUE,NOW())
           ON CONFLICT (slug) DO UPDATE SET company=EXCLUDED.company, config=EXCLUDED.config,
             version=dashboard_metadata.version+1, published=TRUE, updated_at=NOW()""",
        cfg.slug, cfg.company, cfg.model_dump_json(), cfg.version,
    )
    await pool.execute(
        "INSERT INTO dashboard_versions (slug, version, config) VALUES ($1,$2,$3::jsonb)",
        cfg.slug, cfg.version, cfg.model_dump_json(),
    )

    # 2) make it live via the existing pharma_tenants pipeline (if pharma)
    kind = _KIND_MAP.get(cfg.connector)
    if kind:
        try:
            await pool.execute(
                """INSERT INTO pharma_tenants
                     (tenant_key, display_name, kind, url, x_tenant, ucids,
                      has_certification, has_objections, has_business_lines, has_organization, has_top_stats,
                      coach_activity_ids, auth_header_name, auth_header_value, created_at, updated_at)
                   VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,false,false,false,false,$8::jsonb,NULL,NULL,NOW(),NOW())
                   ON CONFLICT (tenant_key) DO UPDATE SET display_name=EXCLUDED.display_name, kind=EXCLUDED.kind,
                     url=EXCLUDED.url, x_tenant=EXCLUDED.x_tenant, ucids=EXCLUDED.ucids,
                     has_certification=EXCLUDED.has_certification, coach_activity_ids=EXCLUDED.coach_activity_ids,
                     is_active=TRUE, updated_at=NOW()""",
                cfg.slug, cfg.company, kind, cfg.connector_handle.get("bridge_url") or _bridge_url(cfg),
                cfg.connector_handle.get("x_tenant"), json.dumps(cfg.connector_handle.get("exercise_ids", [])),
                "certification" in [m.lower() for m in _modules(cfg)],
                json.dumps(cfg.connector_handle.get("coach_activity_ids") or []) if cfg.connector_handle.get("coach_activity_ids") else None,
            )
            # domain mapping so logins route to this tenant
            domain = (domains or [f"{cfg.slug}.com"])[0]
            await pool.execute(
                """INSERT INTO pharma_tenant_domains (domain, tenant_key, created_at)
                   VALUES ($1,$2,NOW()) ON CONFLICT (domain) DO UPDATE SET tenant_key=EXCLUDED.tenant_key""",
                domain, cfg.slug,
            )
            await log("publish", "success",
                      f"Live: tenant '{cfg.slug}' ({kind}) + domain '{domain}' — dashboard active within ~30s")
        except Exception as exc:
            await log("publish", "warn", f"Metadata stored; pharma_tenants upsert skipped: {str(exc)[:120]}")
    else:
        await log("publish", "success", f"Config published for '{cfg.slug}' (rendered from metadata)")
    return True


def _bridge_url(cfg: DashboardConfig) -> str:
    # base_url captured at discovery; fall back to standard unified path
    return cfg.connector_handle.get("base_url") or f"https://serv.aux-rolplay.com/unified/{cfg.slug}/bridge/"


def _modules(cfg: DashboardConfig) -> list[str]:
    return cfg.recommendations  # modules surfaced via recommendations; certification also flagged in filters
