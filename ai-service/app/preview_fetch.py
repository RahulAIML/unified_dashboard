"""Runtime query layer for live preview.

Given a DashboardConfig + widget, fetch the REAL value/series/rows from the
connector. This is what makes the preview show live data before publishing.
Mirrors how the Next.js dashboard queries each pipeline.
"""
from __future__ import annotations

from typing import Any

from .config import get_settings
from .http import get_json, post_json
from .rolplay_score import SCORE_SQL
from .models import DashboardConfig, ServiceKind, WidgetConfig, WidgetPreview, WidgetType

PASS_THRESHOLD = 70


def _norm_score(row: dict) -> float | None:
    """Normalize a sim.demorp6 row's score to a 0-100 percentage.

    The "Calificacion" field is 0-100 for some clients (Sanfer: 90/95/100) but
    a raw points scale for others (Weser: 1600/1000, whose 0-100 percentage is
    in "Puntos_Totales"=80). Averaging Calificacion blindly gave Weser an
    "avg score" of 1400. Trust Calificacion when it's already <=100; otherwise
    fall back to Puntos_Totales when that's a valid percentage. Leaves Sanfer
    unchanged; fixes Weser/Adium; works for a new client on either scale with
    no config. Mirrors normalizeSimScore() in lib/bridge-pharma-analytics.ts.
    """
    cal = row.get("Calificacion")
    if _num(cal) and float(cal) <= 100:
        return float(cal)
    pts = row.get("Puntos_Totales")
    if _num(pts) and float(pts) <= 100:
        return float(pts)
    return float(cal) if _num(cal) else None


def _date_range(cfg: DashboardConfig) -> tuple[str, str]:
    dr = cfg.connector_handle.get("date_range")
    if isinstance(dr, list) and len(dr) == 2:
        return dr[0], dr[1]
    s = get_settings()
    return s.discovery_wide_date_from, s.discovery_wide_date_to


async def fetch_widget(cfg: DashboardConfig, w: WidgetConfig) -> WidgetPreview:
    try:
        # raw_field is only ever set for auto-discovered metrics (see
        # agents/auto_discovery.py) — route those through the generic
        # action-dispatch fetcher regardless of connector kind, since the
        # dedicated per-kind functions below only know their own hardcoded
        # action set.
        if w.raw_field is not None and cfg.connector in (ServiceKind.pharma_kpi, ServiceKind.pharma_sale_exercises):
            return await _generic_pharma_action(cfg, w)
        if cfg.connector == ServiceKind.pharma_kpi:
            return await _kpi(cfg, w)
        if cfg.connector == ServiceKind.pharma_exceltis_rest:
            return await _exceltis(cfg, w)
        if cfg.connector == ServiceKind.pharma_sale_exercises:
            return await _sale_exercises(cfg, w)
        if cfg.connector == ServiceKind.rolplay_app_sql:
            return await _rolplay_app(cfg, w)
        if cfg.connector == ServiceKind.second_brain:
            return await _second_brain(cfg, w)
        return WidgetPreview(widget_id=w.id, ok=False, error=f"no preview for {cfg.connector}")
    except Exception as exc:
        return WidgetPreview(widget_id=w.id, ok=False, error=str(exc)[:200])


# ── generic action-dispatch (auto-discovered metrics) ────────────────────────────
async def _generic_pharma_action(cfg: DashboardConfig, w: WidgetConfig) -> WidgetPreview:
    """Re-calls the exact action auto_discovery already verified returns real
    data, and pulls w.raw_field (a dotted path, e.g. "certified" or
    "stats.avg_best_score") out of the response. Works for any action name —
    nothing here is specific to one company or one bridge's vocabulary."""
    slug = cfg.connector_handle.get("tenant", cfg.slug)
    frm, to = _date_range(cfg)
    ids = cfg.connector_handle.get("exercise_ids", [])
    base = cfg.connector_handle.get("base_url") or f"{get_settings().pharma_bridge_base_url.rstrip('/')}/{slug}/bridge/"
    params: dict[str, Any] = {"action": w.source_action, "date_from": frm, "date_to": to}
    if ids:
        params["ids"] = ",".join(map(str, ids))
    _, body = await post_json(base, params, {"X-Tenant": slug})
    if not isinstance(body, dict) or body.get("ok") is False:
        return WidgetPreview(widget_id=w.id, ok=False, error="action no longer returns real data")

    node: Any = body
    for part in (w.raw_field or "").split("."):
        node = node.get(part) if isinstance(node, dict) else None
        if node is None:
            break

    if w.type == WidgetType.table:
        rows = node if isinstance(node, list) else None
        return WidgetPreview(widget_id=w.id, ok=bool(rows), rows=rows)
    val = node if isinstance(node, (int, float)) and not isinstance(node, bool) else None
    return WidgetPreview(widget_id=w.id, ok=val is not None, value=val)


# ── pharma kpi ──────────────────────────────────────────────────────────────────
async def _kpi(cfg: DashboardConfig, w: WidgetConfig) -> WidgetPreview:
    slug = cfg.connector_handle.get("tenant", cfg.slug)
    frm, to = _date_range(cfg)
    hdr = {"X-Tenant": slug}
    # Always prefer the exact URL discovery already verified works — never
    # reconstruct from slug, which silently breaks for tenants whose bridge
    # doesn't live at the "obvious" path (see _sale_exercises below).
    base = cfg.connector_handle.get("base_url") or f"{get_settings().pharma_bridge_base_url.rstrip('/')}/{slug}/bridge/"
    if w.type == WidgetType.kpi_tile:
        _, body = await post_json(base, {"action": "kpi.overview", "date_from": frm, "date_to": to}, hdr)
        ov = (body or {}).get("overview", {}) if isinstance(body, dict) else {}
        val = {"total_sessions": ov.get("total_sessions"), "avg_score": ov.get("avg_score"),
               "pass_rate": ov.get("pass_rate_pct")}.get(w.metric_key)
        return WidgetPreview(widget_id=w.id, ok=val is not None, value=val)
    if w.type == WidgetType.line_chart:
        _, body = await post_json(base, {"action": "kpi.score_trend", "date_from": frm, "date_to": to, "granularity": "month"}, hdr)
        trend = (body or {}).get("trend", []) if isinstance(body, dict) else []
        series = [{"date": t["period"], "value": t.get("avg_score"), "sessions": t.get("sessions")} for t in trend]
        return WidgetPreview(widget_id=w.id, ok=bool(series), series=series)
    # bar/table → activity_summary
    _, body = await post_json(base, {"action": "kpi.activity_summary", "date_from": frm, "date_to": to}, hdr)
    acts = [a for a in ((body or {}).get("activities", []) if isinstance(body, dict) else []) if int(a.get("sessions") or 0) > 0]
    rows = [{"activity": a.get("activity_name"), "total_sessions": a.get("sessions"),
             "avg_score": a.get("avg_score"), "pass_rate": a.get("pass_rate_pct")} for a in acts]
    return WidgetPreview(widget_id=w.id, ok=bool(rows), rows=rows)


# ── exceltis_rest ─────────────────────────────────────────────────────────────────
async def _exceltis_rows(cfg: DashboardConfig) -> list[dict]:
    ids = cfg.connector_handle.get("exercise_ids", [])
    if not ids:
        return []
    frm, to = _date_range(cfg)
    q = "&".join(f"id={i}" for i in ids)
    base = f"{get_settings().pharma_host_root.rstrip('/')}/{cfg.slug}"
    _, rows = await get_json(f"{base}/api/rol_play_sim_extractor?{q}&fecha_inicio={frm}&fecha_fin={to}")
    return rows if isinstance(rows, list) else []


async def _exceltis(cfg: DashboardConfig, w: WidgetConfig) -> WidgetPreview:
    rows = await _exceltis_rows(cfg)
    scored = [s for s in (_norm_score(r) for r in rows) if s is not None]
    if w.type == WidgetType.kpi_tile:
        if w.metric_key == "total_sessions":
            return WidgetPreview(widget_id=w.id, ok=True, value=len(rows))
        if w.metric_key == "avg_score":
            v = round(sum(scored) / len(scored), 2) if scored else None
            return WidgetPreview(widget_id=w.id, ok=v is not None, value=v)
        if w.metric_key == "pass_rate":
            v = round(100 * sum(1 for s in scored if s >= PASS_THRESHOLD) / len(scored), 1) if scored else None
            return WidgetPreview(widget_id=w.id, ok=v is not None, value=v)
    # breakdown by usecase
    by: dict[Any, int] = {}
    for r in rows:
        by[r.get("Caso_de_Uso_Nombre") or r.get("ID_Caso_de_Uso")] = by.get(r.get("Caso_de_Uso_Nombre") or r.get("ID_Caso_de_Uso"), 0) + 1
    out = [{"usecase": k, "total_sessions": v} for k, v in sorted(by.items(), key=lambda x: -x[1])]
    return WidgetPreview(widget_id=w.id, ok=bool(out), rows=out)


# ── sale_exercises ─────────────────────────────────────────────────────────────────
async def _sale_exercises(cfg: DashboardConfig, w: WidgetConfig) -> WidgetPreview:
    ids = cfg.connector_handle.get("exercise_ids", [])
    if not ids:
        return WidgetPreview(widget_id=w.id, ok=False, error="no exercise ids")
    slug = cfg.connector_handle.get("tenant", cfg.slug)
    frm, to = _date_range(cfg)
    # BUG FIXED: two sale_exercises tenants (Adium, Weser) live at the bridge
    # HOST ROOT (serv.aux-rolplay.com/{slug}/bridge/), not under /unified/ like
    # Sanfer — reconstructing the URL from the unified base always 404'd for
    # them, silently returning 0 sessions. Discovery already found and
    # verified the real URL; always reuse it instead of guessing again.
    base = cfg.connector_handle.get("base_url") or f"{get_settings().pharma_bridge_base_url.rstrip('/')}/{slug}/bridge/"
    # cert.stats is real and working for tenants that have it (verified on
    # Sanfer's live bridge) but isn't advertised in the bridge's own
    # introspection action list — schema_discovery still detects it via the
    # cert.count/cert.sessions actions that ARE advertised. Fetch it
    # separately; it's a distinct source, not derived from sim.demorp6 rows.
    if w.metric_key == "certified":
        _, cert_body = await post_json(base, {"action": "cert.stats"}, {"X-Tenant": slug})
        v = (cert_body or {}).get("certified") if isinstance(cert_body, dict) else None
        return WidgetPreview(widget_id=w.id, ok=v is not None, value=v)
    _, body = await post_json(base, {"action": "sim.demorp6", "ids": ",".join(map(str, ids)), "date_from": frm, "date_to": to}, {"X-Tenant": slug})
    rows = (body or {}).get("data", []) if isinstance(body, dict) else []
    scores = [s for s in (_norm_score(r) for r in rows) if s is not None]
    if w.metric_key == "total_sessions":
        return WidgetPreview(widget_id=w.id, ok=True, value=len(rows))
    if w.metric_key == "avg_score":
        v = round(sum(scores) / len(scores), 2) if scores else None
        return WidgetPreview(widget_id=w.id, ok=v is not None, value=v)
    if w.metric_key == "pass_rate":
        v = round(100 * sum(1 for s in scores if s >= PASS_THRESHOLD) / len(scores), 1) if scores else None
        return WidgetPreview(widget_id=w.id, ok=v is not None, value=v)
    return WidgetPreview(widget_id=w.id, ok=bool(rows), value=len(rows))


# ── rolplay-app (query endpoint; scores from raw_closing_data/closing_analysis) ──────
async def _rolplay_app(cfg: DashboardConfig, w: WidgetConfig) -> WidgetPreview:
    client_id = int(cfg.connector_handle.get("client_id"))
    # One round-trip: counts + score aggregates (SCORE_SQL extracts the 0-100
    # overall score per session — JSON first, HTML fallback).
    sql = (
        "SELECT COUNT(s.ID) AS sessions, COUNT(DISTINCT u.ID) AS users, "
        f"ROUND(AVG({SCORE_SQL}),2) AS avg_score, "
        f"SUM(CASE WHEN ({SCORE_SQL})>={PASS_THRESHOLD} THEN 1 ELSE 0 END) AS passed, "
        f"SUM(CASE WHEN ({SCORE_SQL}) IS NOT NULL THEN 1 ELSE 0 END) AS scored "
        "FROM r_user u LEFT JOIN r_user_session s ON s.user_id=u.ID "
        f"WHERE u.client_id={client_id}"
    )
    _, body = await post_json(get_settings().rolplay_app_sql_url, {"sql": sql})
    data = (body or {}).get("data", [{}]) if isinstance(body, dict) else [{}]
    row = data[0] if data else {}

    sessions = int(row.get("sessions") or 0)
    passed = int(row.get("passed") or 0)
    avg = float(row["avg_score"]) if row.get("avg_score") is not None else None
    pass_rate = round(100 * passed / sessions, 1) if sessions else None

    metrics = {
        "total_sessions": sessions,
        "total_users": int(row.get("users") or 0),
        "avg_score": avg,
        "pass_rate": pass_rate,
        "passed": passed,
    }
    val = metrics.get(w.metric_key, sessions)
    return WidgetPreview(widget_id=w.id, ok=val is not None, value=val)


# ── second brain ────────────────────────────────────────────────────────────────
async def _second_brain(cfg: DashboardConfig, w: WidgetConfig) -> WidgetPreview:
    s = get_settings()
    email = cfg.connector_handle.get("admin_email")
    hdr = {"Accept": "application/json"}
    if s.second_brain_api_token:
        hdr["Authorization"] = f"Bearer {s.second_brain_api_token}"
    _, body = await get_json(f"{s.second_brain_api_url}/organizations/full-profile?admin_email={email}", hdr)
    stats = (body or {}).get("stats", {}) if isinstance(body, dict) else {}
    m = {"coaching_sessions": stats.get("total_coaching_sessions"), "total_members": stats.get("total_members"),
         "message_logs": stats.get("total_message_logs"),
         "engagement": round(100 * (stats.get("active_members") or 0) / (stats.get("total_members") or 1), 1)}
    return WidgetPreview(widget_id=w.id, ok=w.metric_key in m, value=m.get(w.metric_key))


def _num(v) -> bool:
    try:
        float(v)
        return True
    except (TypeError, ValueError):
        return False
