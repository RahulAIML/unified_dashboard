"""Runtime query layer for live preview.

Given a DashboardConfig + widget, fetch the REAL value/series/rows from the
connector. This is what makes the preview show live data before publishing.
Mirrors how the Next.js dashboard queries each pipeline.
"""
from __future__ import annotations

from typing import Any

from .config import get_settings
from .http import get_json, post_json
from .models import DashboardConfig, ServiceKind, WidgetConfig, WidgetPreview, WidgetType

PASS_THRESHOLD = 70


def _date_range(cfg: DashboardConfig) -> tuple[str, str]:
    dr = cfg.connector_handle.get("date_range")
    if isinstance(dr, list) and len(dr) == 2:
        return dr[0], dr[1]
    s = get_settings()
    return s.discovery_wide_date_from, s.discovery_wide_date_to


async def fetch_widget(cfg: DashboardConfig, w: WidgetConfig) -> WidgetPreview:
    try:
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


# ── pharma kpi ──────────────────────────────────────────────────────────────────
async def _kpi(cfg: DashboardConfig, w: WidgetConfig) -> WidgetPreview:
    slug = cfg.connector_handle.get("tenant", cfg.slug)
    frm, to = _date_range(cfg)
    hdr = {"X-Tenant": slug}
    base = f"{get_settings().pharma_bridge_base_url.rstrip('/')}/{slug}/bridge/"
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
    scored = [float(r["Calificacion"]) for r in rows if _num(r.get("Calificacion"))]
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
    base = f"{get_settings().pharma_bridge_base_url.rstrip('/')}/{slug}/bridge/"
    _, body = await post_json(base, {"action": "sim.demorp6", "ids": ",".join(map(str, ids)), "date_from": frm, "date_to": to}, {"X-Tenant": slug})
    rows = (body or {}).get("data", []) if isinstance(body, dict) else []
    scores = [float(r["Calificacion"]) for r in rows if _num(r.get("Calificacion"))]
    if w.metric_key == "total_sessions":
        return WidgetPreview(widget_id=w.id, ok=True, value=len(rows))
    if w.metric_key == "avg_score":
        v = round(sum(scores) / len(scores), 2) if scores else None
        return WidgetPreview(widget_id=w.id, ok=v is not None, value=v)
    if w.metric_key == "pass_rate":
        v = round(100 * sum(1 for s in scores if s >= PASS_THRESHOLD) / len(scores), 1) if scores else None
        return WidgetPreview(widget_id=w.id, ok=v is not None, value=v)
    return WidgetPreview(widget_id=w.id, ok=bool(rows), value=len(rows))


# ── rolplay-app (counts-only) ──────────────────────────────────────────────────────
async def _rolplay_app(cfg: DashboardConfig, w: WidgetConfig) -> WidgetPreview:
    client_id = cfg.connector_handle.get("client_id")
    sql = ("SELECT COUNT(s.ID) AS sessions, COUNT(DISTINCT u.ID) AS users "
           "FROM r_user u LEFT JOIN r_user_session s ON s.user_id=u.ID "
           f"WHERE u.client_id={int(client_id)}")
    _, body = await post_json(get_settings().rolplay_app_sql_url, {"sql": sql})
    data = (body or {}).get("data", [{}]) if isinstance(body, dict) else [{}]
    row = data[0] if data else {}
    val = {"total_sessions": row.get("sessions"), "total_users": row.get("users")}.get(w.metric_key, row.get("sessions"))
    return WidgetPreview(widget_id=w.id, ok=val is not None, value=int(val) if val is not None else None)


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
