"""Runtime query layer for live preview.

Given a DashboardConfig + widget, fetch the REAL value/series/rows from the
connector. This is what makes the preview show live data before publishing.
Mirrors how the Next.js dashboard queries each pipeline.
"""
from __future__ import annotations

from typing import Any

from . import journey as journey_lib
from . import lms as lms_client
from .config import get_settings
from .http import get_json, post_json
from .rolplay_score import SCORE_SQL
from .models import DashboardConfig, ServiceKind, WidgetConfig, WidgetPreview, WidgetType

PASS_THRESHOLD = 70

# Must match dashboard_planning.py's _auto_donut_widgets id for the pass/fail
# donut — routed by id, not metric_key, since metric_key is validation.py's
# "must be a real schema_discovery-verified metric" contract, and this donut
# is an aggregation of already-real per-category rows rather than a
# standalone discovered metric.
APPROVAL_DONUT_ID = "donut_approval"

# Must match dashboard_planning.py's _auto_drilldown_table id — same reason
# as APPROVAL_DONUT_ID: this table's rows are individual real sessions, not
# a standalone discovered metric, so it's routed by widget id.
DRILLDOWN_TABLE_ID = "table_recent_sessions"


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


def _date_range(cfg: DashboardConfig, w: WidgetConfig | None = None) -> tuple[str, str]:
    """cfg.connector_handle["date_range"] is the PRIMARY connector's own
    discovered window (dashboard_config.py sets it from the primary's
    schema) -- narrow and correct for the primary's widgets, but found live
    to silently starve a SECONDARY page's widgets: Besins' rolplay_app_sql
    window is a 4-day slice, and applying that same slice to its
    coach_app_sql page (an unrelated data source with its own timeline)
    made 17 real sessions read as "no data" for a query that was actually
    just scoped to the wrong 4 days. Skip the primary's window for any
    widget whose OWN source differs from the primary connector.
    """
    if w is not None and w.source_kind != cfg.connector:
        s = get_settings()
        return s.discovery_wide_date_from, s.discovery_wide_date_to
    dr = cfg.connector_handle.get("date_range")
    if isinstance(dr, list) and len(dr) == 2:
        return dr[0], dr[1]
    s = get_settings()
    return s.discovery_wide_date_from, s.discovery_wide_date_to


async def fetch_widget(cfg: DashboardConfig, w: WidgetConfig) -> WidgetPreview:
    try:
        # LMS widgets are discovered independently of the dashboard's PRIMARY
        # connector (see agents/lms_discovery.py) — w.source_kind, not
        # cfg.connector, says how to fetch them. A pharma_kpi-primary
        # dashboard can still carry lms-sourced widgets, so this check must
        # come before the cfg.connector dispatch below, not fall through to it.
        if w.source_kind == ServiceKind.lms:
            return await _lms(cfg, w)
        # raw_field is only ever set for auto-discovered metrics (see
        # agents/auto_discovery.py) — route those through the generic
        # action-dispatch fetcher regardless of connector kind, since the
        # dedicated per-kind functions below only know their own hardcoded
        # action set.
        if w.raw_field is not None and w.source_kind in (ServiceKind.pharma_kpi, ServiceKind.pharma_sale_exercises):
            return await _generic_pharma_action(cfg, w)
        # Dispatch by the WIDGET's own source_kind, not cfg.connector (the
        # dashboard's primary). For every widget on the primary's own pages
        # these are identical, so this changes nothing for them — but a
        # secondary-connector page's widgets (dashboard_planning.py's
        # _secondary_page, e.g. Besins' coach_app_sql page on a
        # rolplay_app_sql-primary dashboard) carry the SECONDARY's kind, and
        # must be fetched from there, not force-routed through the primary's
        # fetcher (which would query the wrong tables entirely).
        if w.source_kind == ServiceKind.pharma_kpi:
            return await _kpi(cfg, w)
        if w.source_kind == ServiceKind.pharma_exceltis_rest:
            return await _exceltis(cfg, w)
        if w.source_kind == ServiceKind.pharma_sale_exercises:
            return await _sale_exercises(cfg, w)
        if w.source_kind == ServiceKind.rolplay_app_sql:
            return await _rolplay_app(cfg, w)
        if w.source_kind == ServiceKind.coach_app_sql:
            return await _coach_app(cfg, w)
        if w.source_kind == ServiceKind.second_brain:
            return await _second_brain(cfg, w)
        return WidgetPreview(widget_id=w.id, ok=False, error=f"no preview for {w.source_kind}")
    except Exception as exc:
        return WidgetPreview(widget_id=w.id, ok=False, error=str(exc)[:200])


# ── generic action-dispatch (auto-discovered metrics) ────────────────────────────
async def _generic_pharma_action(cfg: DashboardConfig, w: WidgetConfig) -> WidgetPreview:
    """Re-calls the exact action auto_discovery already verified returns real
    data, and pulls w.raw_field (a dotted path, e.g. "certified" or
    "stats.avg_best_score") out of the response. Works for any action name —
    nothing here is specific to one company or one bridge's vocabulary."""
    slug = cfg.connector_handle.get("tenant", cfg.slug)
    frm, to = _date_range(cfg, w)
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


# ── LMS (LearnWorlds; independent of the primary connector) ─────────────────────
async def _lms(cfg: DashboardConfig, w: WidgetConfig) -> WidgetPreview:
    frm, to = _date_range(cfg, w)
    data = await lms_client.lms_dashboard(cfg.slug, frm, to)
    if not data.get("configured"):
        return WidgetPreview(widget_id=w.id, ok=False, error="LMS not configured for this tenant")

    if w.type == WidgetType.kpi_tile:
        val = {
            "lms_enrolled_users": data["enrolledUsers"],
            "lms_completion_rate": data["completionRate"],
            # Null, not zero, when nothing is graded — matches lms.py's
            # hasScoreData flag exactly (a flat 0 would read as catastrophic
            # performance when nothing was ever graded).
            "lms_avg_quiz_score": data["avgQuizScore"] if data["hasScoreData"] else None,
            "lms_modules_completed": data["modulesCompleted"],
        }.get(w.metric_key)
        return WidgetPreview(widget_id=w.id, ok=val is not None, value=val)
    if w.type == WidgetType.line_chart:
        series = data["completionTrend"]
        return WidgetPreview(widget_id=w.id, ok=bool(series), series=series)
    if w.type == WidgetType.table:
        rows = data["courses"]
        return WidgetPreview(widget_id=w.id, ok=bool(rows), rows=rows)
    return WidgetPreview(widget_id=w.id, ok=False, error=f"unsupported LMS widget type '{w.type}'")


# ── pharma kpi ──────────────────────────────────────────────────────────────────
async def _kpi(cfg: DashboardConfig, w: WidgetConfig) -> WidgetPreview:
    slug = cfg.connector_handle.get("tenant", cfg.slug)
    frm, to = _date_range(cfg, w)
    hdr = {"X-Tenant": slug}
    # Always prefer the exact URL discovery already verified works — never
    # reconstruct from slug, which silently breaks for tenants whose bridge
    # doesn't live at the "obvious" path (see _sale_exercises below).
    base = cfg.connector_handle.get("base_url") or f"{get_settings().pharma_bridge_base_url.rstrip('/')}/{slug}/bridge/"
    if w.type == WidgetType.journey:
        # pharma_kpi's discovered "modules" are raw activity_type strings
        # (e.g. "Coach evaluador"), never the canonical LMS/Coach/Simulator/
        # Certification/Second-Brain set — dashboard_planning.py's
        # _auto_journey_widget never creates a journey widget for this
        # connector precisely because forcing them into that ontology would
        # be an unverified guess. If one somehow reaches here, say so plainly
        # rather than silently returning mismatched activity_summary rows.
        return WidgetPreview(widget_id=w.id, ok=False, error="journey requires canonical modules; not available for pharma_kpi")
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
    # bar/donut/table/approval-donut → activity_summary
    _, body = await post_json(base, {"action": "kpi.activity_summary", "date_from": frm, "date_to": to}, hdr)
    acts = [a for a in ((body or {}).get("activities", []) if isinstance(body, dict) else []) if int(a.get("sessions") or 0) > 0]
    if w.id.endswith(APPROVAL_DONUT_ID):
        return _approval_donut((int(a.get("sessions") or 0) for a in acts),
                                (int(a.get("sessions_pass") or 0) for a in acts), w.id)
    rows = [{"activity": a.get("activity_name"), "total_sessions": a.get("sessions"),
             "passed_sessions": a.get("sessions_pass"),
             "avg_score": a.get("avg_score"), "pass_rate": a.get("pass_rate_pct")} for a in acts]
    return WidgetPreview(widget_id=w.id, ok=bool(rows), rows=rows)


def _approval_donut(totals, passeds, widget_id: str) -> WidgetPreview:
    """Two-slice Approved/Disapproved donut, summed from the SAME per-category
    rows already fetched for the bar_chart/table breakdown — no extra query.
    Generic over any connector's (total, passed) pairs per category."""
    total = sum(totals)
    passed = sum(passeds)
    if not total:
        return WidgetPreview(widget_id=widget_id, ok=False, error="no sessions to break down")
    rows = [{"label": "Passed", "value": passed}, {"label": "Failed", "value": total - passed}]
    return WidgetPreview(widget_id=widget_id, ok=True, rows=rows)


# ── exceltis_rest ─────────────────────────────────────────────────────────────────
async def _exceltis_rows(cfg: DashboardConfig, w: WidgetConfig) -> list[dict]:
    ids = cfg.connector_handle.get("exercise_ids", [])
    if not ids:
        return []
    frm, to = _date_range(cfg, w)
    q = "&".join(f"id={i}" for i in ids)
    base = f"{get_settings().pharma_host_root.rstrip('/')}/{cfg.slug}"
    _, rows = await get_json(f"{base}/api/rol_play_sim_extractor?{q}&fecha_inicio={frm}&fecha_fin={to}")
    return rows if isinstance(rows, list) else []


async def _exceltis(cfg: DashboardConfig, w: WidgetConfig) -> WidgetPreview:
    rows = await _exceltis_rows(cfg, w)
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
    frm, to = _date_range(cfg, w)
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
async def _rolplay_app_sql(sql: str) -> list[dict]:
    _, body = await post_json(get_settings().rolplay_app_sql_url, {"sql": sql})
    return (body or {}).get("data", []) if isinstance(body, dict) else []


def _category_clause(module: str | None) -> str:
    """SQL fragment restricting rolplay_app_sql sessions to one canonical
    module (coach/simulator/certification) — mirrors categoryClause() in
    lib/bridge-rolplay-app.ts exactly, same category mapping. '' (no
    restriction) when module is None, matching every existing unscoped widget."""
    if not module:
        return ""
    cat = journey_lib.MODULE_TO_CATEGORY.get(module)
    if not cat:
        return ""
    return f" AND s.simulator_id IN (SELECT ID FROM r_simulator WHERE category = '{cat}')"


async def _rolplay_app(cfg: DashboardConfig, w: WidgetConfig) -> WidgetPreview:
    cid = int(cfg.connector_handle.get("client_id"))
    base = f"FROM r_user_session s JOIN r_user u ON u.ID=s.user_id WHERE u.client_id={cid}{_category_clause(w.module)}"

    # ── Solution journey: one row per canonical module, in journey order ──
    if w.type == WidgetType.journey:
        rows = await _rolplay_app_sql(
            "SELECT sim.category AS category, COUNT(*) total_sessions, "
            f"SUM(CASE WHEN ({SCORE_SQL})>={PASS_THRESHOLD} THEN 1 ELSE 0 END) passed_sessions, "
            f"ROUND(100*SUM(CASE WHEN ({SCORE_SQL})>={PASS_THRESHOLD} THEN 1 ELSE 0 END)/COUNT(*),1) pass_rate "
            "FROM r_user_session s JOIN r_user u ON u.ID=s.user_id "
            f"JOIN r_simulator sim ON sim.ID=s.simulator_id WHERE u.client_id={cid} "
            "GROUP BY sim.category"
        )
        by_module = {
            journey_lib.CATEGORY_TO_MODULE[str(r["category"]).upper()]: r
            for r in rows if str(r.get("category") or "").upper() in journey_lib.CATEGORY_TO_MODULE
        }
        stages = journey_lib.ordered_stages(list(by_module.keys()))
        out = [{
            "module": m, "label": journey_lib.LABEL[m], "phase": journey_lib.PHASE[m],
            "total_sessions": int(by_module[m].get("total_sessions") or 0),
            "passed_sessions": int(by_module[m].get("passed_sessions") or 0),
            "pass_rate": by_module[m].get("pass_rate"),
        } for m in stages]
        return WidgetPreview(widget_id=w.id, ok=len(out) >= 2, rows=out,
                             error=None if len(out) >= 2 else "fewer than 2 real modules for a journey")

    # ── Trend line: monthly avg score ──
    if w.type == WidgetType.line_chart:
        rows = await _rolplay_app_sql(
            "SELECT period, ROUND(AVG(sc),2) value, COUNT(*) sessions FROM ("
            f"SELECT DATE_FORMAT(s.date_created,'%Y-%m') period, {SCORE_SQL} sc {base}) t "
            "WHERE sc IS NOT NULL GROUP BY period ORDER BY period"
        )
        series = [{"date": r.get("period"), "value": r.get("value"), "sessions": r.get("sessions")} for r in rows]
        return WidgetPreview(widget_id=w.id, ok=bool(series), series=series)

    # ── Score distribution histogram ──
    if w.type == WidgetType.histogram:
        rows = await _rolplay_app_sql(
            "SELECT LEAST(FLOOR(sc/10)*10,90) bucket, COUNT(*) count FROM ("
            f"SELECT {SCORE_SQL} sc {base}) t WHERE sc IS NOT NULL GROUP BY bucket ORDER BY bucket"
        )
        total = sum(int(r.get("count") or 0) for r in rows) or 1
        out = [{"range": f"{int(r['bucket'])}-{int(r['bucket'])+9 if int(r['bucket'])<90 else 100}",
                "count": int(r.get("count") or 0),
                "pct": round(100 * int(r.get("count") or 0) / total, 1)} for r in rows]
        return WidgetPreview(widget_id=w.id, ok=bool(out), rows=out)

    # ── Per-simulator breakdown (bar_chart / donut / table / approval-donut) ──
    if w.type in (WidgetType.bar_chart, WidgetType.donut, WidgetType.table) or w.id.endswith(APPROVAL_DONUT_ID):
        rows = await _rolplay_app_sql(
            "SELECT COALESCE(sim.name, CONCAT('Simulator ', s.simulator_id)) simulator, "
            f"COUNT(*) total_sessions, ROUND(AVG({SCORE_SQL}),2) avg_score, "
            f"SUM(CASE WHEN ({SCORE_SQL})>={PASS_THRESHOLD} THEN 1 ELSE 0 END) passed_sessions, "
            f"ROUND(100*SUM(CASE WHEN ({SCORE_SQL})>={PASS_THRESHOLD} THEN 1 ELSE 0 END)/COUNT(*),1) pass_rate "
            "FROM r_user_session s JOIN r_user u ON u.ID=s.user_id "
            f"LEFT JOIN r_simulator sim ON sim.ID=s.simulator_id WHERE u.client_id={cid}{_category_clause(w.module)} "
            "GROUP BY s.simulator_id, sim.name ORDER BY total_sessions DESC"
        )
        if w.id.endswith(APPROVAL_DONUT_ID):
            return _approval_donut((int(r.get("total_sessions") or 0) for r in rows),
                                    (int(r.get("passed_sessions") or 0) for r in rows), w.id)
        return WidgetPreview(widget_id=w.id, ok=bool(rows), rows=rows)

    # ── KPI tiles (scalar) ──
    data = await _rolplay_app_sql(
        "SELECT COUNT(s.ID) AS sessions, COUNT(DISTINCT u.ID) AS users, "
        f"ROUND(AVG({SCORE_SQL}),2) AS avg_score, "
        f"SUM(CASE WHEN ({SCORE_SQL})>={PASS_THRESHOLD} THEN 1 ELSE 0 END) AS passed "
        f"FROM r_user u LEFT JOIN r_user_session s ON s.user_id=u.ID WHERE u.client_id={cid}{_category_clause(w.module)}"
    )
    row = data[0] if data else {}
    sessions = int(row.get("sessions") or 0)
    passed = int(row.get("passed") or 0)
    metrics = {
        "total_sessions": sessions,
        "total_users": int(row.get("users") or 0),
        "avg_score": float(row["avg_score"]) if row.get("avg_score") is not None else None,
        "pass_rate": round(100 * passed / sessions, 1) if sessions else None,
        "passed": passed,
    }
    val = metrics.get(w.metric_key, sessions)
    return WidgetPreview(widget_id=w.id, ok=val is not None, value=val)


# ── coach_app_sql (customer_id-scoped analytics; Takeda, Besins) ─────────────────
#
# Mirrors lib/bridge-client.ts EXACTLY (bridgeOverviewKpis / bridgeTrends /
# bridgeUsecaseBreakdown) -- same tables, same score normalisation, same
# passed_flag join -- so a dashboard built here shows the same numbers the
# main Next.js app already shows this tenant. This was the missing half of
# the fix: schema_discovery already declared these three metrics for
# coach_app_sql, but fetch_widget had no case for the connector at all, so
# EVERY coach_app_sql client (not just one) rendered every widget as
# "no preview for ServiceKind.coach_app_sql" regardless of whether it had
# real data.
#
# SCORE_CASE: rfc.value_num is on a 0-10 scale for some rows, 0-100 for
# others (same ambiguity lib/bridge-client.ts's SCORE_CASE handles) --
# normalise <=10 by multiplying by 10, else use as-is.
_SCORE_CASE = """
  CASE WHEN rfc.field_key IN ('overall_score','final_score')
       THEN CASE WHEN rfc.value_num <= 10 THEN rfc.value_num * 10 ELSE rfc.value_num END
       ELSE NULL
  END"""


async def _coach_app(cfg: DashboardConfig, w: WidgetConfig) -> WidgetPreview:
    from .connectors.coach_app import CoachAppConnector

    customer_id = int(cfg.connector_handle.get("customer_id") or 0)
    if not customer_id:
        return WidgetPreview(widget_id=w.id, ok=False, error="no customer_id resolved for this tenant")

    conn = CoachAppConnector()
    frm, to = _date_range(cfg, w)

    if w.type == WidgetType.journey:
        # schema_discovery._analytics_schema never sets schema.modules for
        # coach_app_sql at all (no per-module discovery exists for this
        # connector yet) — _auto_journey_widget never creates one here for
        # exactly that reason. Same defensive rejection as pharma_kpi above.
        return WidgetPreview(widget_id=w.id, ok=False, error="journey requires canonical modules; not available for coach_app_sql")

    # ── Trend line: daily session count + avg score ──
    if w.type == WidgetType.line_chart:
        rows = await conn._sql(
            f"SELECT DATE(rfc.report_created_at) AS date, "
            f"ROUND(AVG({_SCORE_CASE}),1) AS avg_score, "
            f"COUNT(DISTINCT rfc.saved_report_id) AS sessions "
            f"FROM rolplay_pro_analytics.report_field_current rfc "
            f"WHERE rfc.customer_id = ? AND rfc.report_created_at BETWEEN ? AND ? "
            f"GROUP BY DATE(rfc.report_created_at) ORDER BY date ASC LIMIT 90",
            [customer_id, frm, to],
        )
        series = [{"date": r.get("date"), "value": r.get("avg_score"), "sessions": r.get("sessions")}
                  for r in (rows or [])]
        return WidgetPreview(widget_id=w.id, ok=bool(series), series=series)

    # ── Recent sessions, individually (drill-through) ──
    # Distinct from the usecase BREAKDOWN below (one row per usecase,
    # aggregated) -- this is one row per real session, each carrying the
    # saved_report_id the existing /drilldown/[id] page already resolves
    # (lib/data-provider.ts's getDrilldown -> lib/bridge-client.ts's
    # bridgeDrilldown, scoped server-side to the viewer's own customer_id --
    # never trusted from the client). See dashboard_planning.py's
    # _auto_drilldown_table for why this only exists for coach_app_sql: it's
    # the one connector kind with a VERIFIED matching drilldown backend.
    if w.id.endswith(DRILLDOWN_TABLE_ID):
        rows = await conn._sql(
            f"SELECT rfc.saved_report_id, DATE(rfc.report_created_at) AS date, "
            f"uc.usecase_name, ROUND(AVG({_SCORE_CASE}),1) AS score, sr.passed_flag "
            f"FROM rolplay_pro_analytics.report_field_current rfc "
            f"JOIN coach_app.saved_reports sr ON sr.id = rfc.saved_report_id "
            f"LEFT JOIN coach_app.usecases uc ON uc.id = rfc.usecase_id "
            f"WHERE rfc.customer_id = ? AND rfc.report_created_at BETWEEN ? AND ? "
            f"GROUP BY rfc.saved_report_id, rfc.report_created_at, uc.usecase_name, sr.passed_flag "
            f"ORDER BY rfc.report_created_at DESC LIMIT 50",
            [customer_id, frm, to],
        )
        out = [{
            "saved_report_id": r.get("saved_report_id"), "date": r.get("date"),
            "usecase": r.get("usecase_name") or "—", "score": r.get("score"),
            "result": "Passed" if r.get("passed_flag") == 1 else ("Failed" if r.get("passed_flag") == 0 else "—"),
        } for r in (rows or [])]
        return WidgetPreview(widget_id=w.id, ok=bool(out), rows=out)

    # ── Per-usecase breakdown (bar_chart / donut / table / approval-donut) ──
    # 'user' is also a declared dimension (schema_discovery._analytics_schema)
    # but no widget requesting it has been observed live yet -- only usecase
    # is implemented here. A 'user'-dimension widget would currently fall
    # through to the tile branch below and report an unsupported metric_key,
    # which is honest (visibly wrong) rather than silently empty.
    if w.type in (WidgetType.bar_chart, WidgetType.donut, WidgetType.table) or w.id.endswith(APPROVAL_DONUT_ID):
        rows = await conn._sql(
            f"SELECT rfc.usecase_id, uc.usecase_name, "
            f"COUNT(DISTINCT rfc.saved_report_id) AS total_sessions, "
            f"ROUND(AVG({_SCORE_CASE}),2) AS avg_score, "
            f"COUNT(DISTINCT CASE WHEN sr.passed_flag = 1 THEN rfc.saved_report_id END) AS passed_sessions, "
            f"ROUND(100.0 * COUNT(DISTINCT CASE WHEN sr.passed_flag = 1 THEN rfc.saved_report_id END) "
            f"  / NULLIF(COUNT(DISTINCT rfc.saved_report_id),0), 1) AS pass_rate "
            f"FROM rolplay_pro_analytics.report_field_current rfc "
            f"JOIN coach_app.saved_reports sr ON sr.id = rfc.saved_report_id "
            f"LEFT JOIN coach_app.usecases uc ON uc.id = rfc.usecase_id "
            f"WHERE rfc.customer_id = ? AND rfc.report_created_at BETWEEN ? AND ? "
            f"GROUP BY rfc.usecase_id, uc.usecase_name ORDER BY total_sessions DESC LIMIT 30",
            [customer_id, frm, to],
        )
        if w.id.endswith(APPROVAL_DONUT_ID):
            return _approval_donut((int(r.get("total_sessions") or 0) for r in (rows or [])),
                                    (int(r.get("passed_sessions") or 0) for r in (rows or [])), w.id)
        out = [{"usecase": (r.get("usecase_name") or f"Usecase {r.get('usecase_id')}"),
                "total_sessions": r.get("total_sessions"), "passed_sessions": r.get("passed_sessions"),
                "avg_score": r.get("avg_score"), "pass_rate": r.get("pass_rate")} for r in (rows or [])]
        return WidgetPreview(widget_id=w.id, ok=bool(out), rows=out)

    # ── KPI tiles (scalar): total_sessions / avg_score / pass_rate ──
    rows = await conn._sql(
        f"SELECT COUNT(DISTINCT rfc.saved_report_id) AS total_sessions, "
        f"ROUND(AVG({_SCORE_CASE}),2) AS avg_score, "
        f"COUNT(DISTINCT CASE WHEN sr.passed_flag = 1 THEN rfc.saved_report_id END) AS passed "
        f"FROM rolplay_pro_analytics.report_field_current rfc "
        f"JOIN coach_app.saved_reports sr ON sr.id = rfc.saved_report_id "
        f"WHERE rfc.customer_id = ? AND rfc.report_created_at BETWEEN ? AND ?",
        [customer_id, frm, to],
    )
    row = (rows or [{}])[0]
    sessions = int(row.get("total_sessions") or 0)
    passed = int(row.get("passed") or 0)
    metrics = {
        "total_sessions": sessions,
        "avg_score": float(row["avg_score"]) if row.get("avg_score") is not None else None,
        "pass_rate": round(100 * passed / sessions, 1) if sessions else None,
    }
    if w.metric_key not in metrics:
        return WidgetPreview(widget_id=w.id, ok=False, error=f"unsupported metric_key '{w.metric_key}' for coach_app_sql")
    val = metrics[w.metric_key]
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
