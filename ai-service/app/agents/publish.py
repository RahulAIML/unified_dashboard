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
    elif cfg.connector == ServiceKind.rolplay_app_sql:
        # BUG FIXED: only pharma connectors were ever registered above, so
        # publishing a query-endpoint client (Siigo, Rowe, M8, Takeda…) stored
        # the config, reported success, and left its users at "You're not linked
        # to any organization" — nothing mapped their login to the client_id.
        # Write the domain → client_id mapping the runtime reads
        # (lib/bridge-rolplay-app.ts dbDomainMap), so the dashboard goes live for
        # real logins immediately, no deploy.
        client_id = cfg.connector_handle.get("client_id")
        domain = (domains or [None])[0]
        # Zero-config: if no domain was supplied, derive it from the client's own
        # users (the most common non-shared email domain in r_user). This is what
        # makes publishing work for a BRAND-NEW client without anyone typing a
        # domain — the data itself tells us how their people log in.
        if client_id and not domain:
            domain = await _derive_domain(int(client_id))
            if domain:
                await log("publish", "info", f"Domain not provided — derived '{domain}' from the client's users")
        if not client_id:
            await log("publish", "warn", "Config stored, but no client_id on the connector — logins cannot be routed")
        elif not domain:
            await log("publish", "warn",
                      f"Config stored for client_id={client_id}, but no company domain could be determined "
                      "(client has no users with a company email yet) — logins cannot be routed.")
        else:
            try:
                # Idempotent so publishing works even if migration 005 hasn't been
                # run — a new client must never fail to go live for that reason.
                await pool.execute(
                    """CREATE TABLE IF NOT EXISTS rolplay_app_domains (
                         domain TEXT PRIMARY KEY,
                         client_id INTEGER NOT NULL,
                         display_name TEXT,
                         is_active BOOLEAN NOT NULL DEFAULT TRUE,
                         created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
                         updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())"""
                )
                await pool.execute(
                    """INSERT INTO rolplay_app_domains (domain, client_id, display_name, is_active, updated_at)
                       VALUES ($1,$2,$3,TRUE,NOW())
                       ON CONFLICT (domain) DO UPDATE SET client_id=EXCLUDED.client_id,
                         display_name=EXCLUDED.display_name, is_active=TRUE, updated_at=NOW()""",
                    str(domain).lower().strip(), int(client_id), cfg.company,
                )
                await log("publish", "success",
                          f"Live: '{cfg.company}' (client_id={client_id}) + domain '{domain}' — "
                          "logins route to this dashboard within ~60s")
            except Exception as exc:
                await log("publish", "warn",
                          f"Config stored; login routing NOT registered: {str(exc)[:120]} "
                          "(run migration 005_rolplay_app_domains.sql)")
    else:
        await log("publish", "success", f"Config published for '{cfg.slug}' (rendered from metadata)")
    return True


# Shared/staff and generic domains can belong to several clients, so they must
# never be used to route a client's logins.
_NON_ROUTABLE_DOMAINS = {
    "audioweb.com.mx",  # shared staff domain (spans Takeda/M8/Rowe)
    "gmail.com", "hotmail.com", "outlook.com", "yahoo.com", "icloud.com",
    "protonmail.com", "live.com", "aol.com", "example.com", "test.com", "mail.com",
}


async def _derive_domain(client_id: int) -> str | None:
    """Most common company email domain among the client's real users, so a new
    client can be published without anyone typing a domain."""
    from ..config import get_settings
    from ..http import post_json

    sql = (
        "SELECT SUBSTRING_INDEX(email,'@',-1) AS domain, COUNT(*) AS n "
        "FROM r_user "
        f"WHERE client_id={int(client_id)} AND email LIKE '%@%' "
        "GROUP BY domain ORDER BY n DESC LIMIT 10"
    )
    try:
        _, body = await post_json(get_settings().rolplay_app_sql_url, {"sql": sql})
        rows = (body or {}).get("data", []) if isinstance(body, dict) else []
    except Exception:
        return None
    for r in rows:
        d = str(r.get("domain") or "").lower().strip()
        if d and d not in _NON_ROUTABLE_DOMAINS:
            return d
    return None


def _bridge_url(cfg: DashboardConfig) -> str:
    # base_url captured at discovery; fall back to standard unified path
    return cfg.connector_handle.get("base_url") or f"https://serv.aux-rolplay.com/unified/{cfg.slug}/bridge/"


def _modules(cfg: DashboardConfig) -> list[str]:
    return cfg.recommendations  # modules surfaced via recommendations; certification also flagged in filters
