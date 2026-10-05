"""Runtime query layer for live preview.

Given a DashboardConfig + widget, fetch the REAL value/series/rows from the
connector. This is what makes the preview show live data before publishing.
Mirrors how the Next.js dashboard queries each pipeline.
"""
from __future__ import annotations

import json
import logging
import re
from datetime import date, datetime, timedelta
from typing import Any

from . import journey as journey_lib
from . import lms as lms_client
from .config import get_settings
from .http import get_json, post_json
from .rolplay_score import SCORE_SQL
from .models import DashboardConfig, ServiceKind, WidgetConfig, WidgetPreview, WidgetType

# Pass/fail bar used to be a flat global constant here (70 for every
# tenant) -- real customers differ (some pass at 70, some 80, some 90, some
# have no score-based criteria at all, e.g. Sanfer certifies by completing
# every assigned simulation). Every call site below now reads cfg.pass_threshold
# (DashboardConfig.pass_threshold, default 80, tenant-configurable at build
# time and editable after publish -- see dashboard_versions.set_pass_threshold)
# instead. "Certified"/"mastery" bar per Cesar's KPI spec (Sugerencia de KPI's
# Cesar.xlsx) -- deliberately separate and still fixed: passing a single
# session is a different bar from being field-ready/certified, and no tenant
# has asked to configure this one.
MASTERY_THRESHOLD = 95

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

# Must match dashboard_planning.py's _reports_page id — a Reports page lists
# individual session rows (not aggregated by simulator, unlike the generic
# bar_chart/donut/table branch below), so it must be routed by id too,
# before that branch claims every `table`-typed widget.
REPORTS_TABLE_ID = "table_reports"
_REPORTS_ROW_LIMIT = 500

# Must match dashboard_planning.py's _auto_best_performers_widget id — a
# leaderboard of top users by avg score, mirroring rolplayAppBestPerformers()
# exactly (GROUP BY user, HAVING at least one real score, ORDER BY avg DESC).
# rolplay_app_sql only, same reason as the ids above: this is the one
# connector with a verified query shape for it.
BEST_PERFORMERS_ID = "table_best_performers"
_BEST_PERFORMERS_LIMIT = 10

# Must match dashboard_planning.py's _auto_daily_passfail_widget id — daily
# session volume + passed count, mirroring rolplayAppTrends' evalCountTrend/
# passFailTrend (the hand-built app returns 3 distinct daily series; this
# preview layer's line_chart branch below only ever computed 1 of them,
# avg score). Rendered as a Total-vs-Passed grouped bar via the SAME
# MiniChart code path the per-simulator breakdown already uses (it already
# draws a second "Passed" bar whenever a row carries `passed`/`passed_sessions`
# alongside a total) -- no new frontend component needed.
DAILY_PASSFAIL_ID = "chart_daily_pass_fail"

# Must match dashboard_planning.py's _auto_registered_users_widget id — the
# full r_user roster (name/email/department/designation/created/last login),
# not aggregated by anything. Distinct from every other table above: those
# all describe SESSIONS; this one describes ACCOUNTS, so it deliberately
# skips the r_user_session join and the date-range/category filters
# entirely (found live on Chinoin: 581 accounts, only 1 with a session --
# a manager asking "who are the other 580 people?" had nowhere to look).
REGISTERED_USERS_TABLE_ID = "table_registered_users"
_REGISTERED_USERS_ROW_LIMIT = 1000


def _pass_rate_legend(cfg: DashboardConfig) -> str:
    return f"Passing threshold: {cfg.pass_threshold} pts"


def _no_passing_criteria_preview(w: WidgetConfig) -> WidgetPreview:
    """Every pass_rate kpi_tile must route through this for a tenant with
    has_no_passing_criteria=True -- an honest 'no data' state, never a
    number computed against a threshold that doesn't apply to this tenant."""
    return WidgetPreview(widget_id=w.id, ok=False, value=None,
                          error="This tenant has no score-based passing criteria configured")

# ── Cesar's KPI suggestions (Sugerencia de KPI's Cesar.xlsx) ─────────────────
# Two groups, by data dependency:
#
# GROUP 1 (universal -- computed from r_user/r_user_session/SCORE_SQL alone,
# same as every existing metric here, works for ANY rolplay_app_sql tenant):
# activation_rate, weekly_practice_frequency, mau_rate, delta_score,
# readiness_index, mastery distribution.
# (Practices to Mastery and Trial-and-Error Index were REMOVED from scope
# per the Aug 6 session with Silverio -- see CESAR_METRIC_KEYS below.)
#
# GROUP 2 (depends on raw_closing_data carrying a rich per-session evaluation
# JSON -- confirmed real and richly structured for Siigo: 5 scored "bloque_*"
# commercial-domain blocks, 24 individually-scored "rubrica_pN_*" checklist
# items, an "intencion_movement" adoption-intent field. Confirmed ABSENT for
# Takeda -- its sessions have raw_closing_data = NULL entirely, scored via
# closing_analysis HTML only). These widgets discover whatever bloque_*/
# rubrica_pN_* keys exist per session dynamically -- never a hardcoded Siigo
# field list -- so they work for any tenant/product whose AI evaluator
# produces this shape, and report "no data" honestly for one that doesn't,
# same anti-fabrication rule as every other widget in this file.
COMMERCIAL_DOMAIN_ID = "table_commercial_domain"
TOP_STRENGTHS_ID = "table_top_strengths"
TOP_OPPORTUNITIES_ID = "table_top_opportunities"
ADOPTION_MOVEMENT_ID = "tile_adoption_movement_rate"
MASTERY_DISTRIBUTION_ID = "donut_mastery_distribution"
_CLOSING_DATA_SAMPLE_LIMIT = 500  # bounded scan, matches REPORTS_TABLE's own cap

# KPI-1.1/1.3/1.4/2.2/2.3/5.3 metric_keys (Group 1 above) — all computed by
# _rolplay_app_cesar_metrics, distinct from the pre-existing
# _rolplay_app_kpi_metrics (total_sessions/avg_score/pass_rate/etc.).
# Public (no leading underscore) so dashboard_planning.py can import it to
# exclude these from the generic Overview tile builder — they already have a
# dedicated home on the KPIs page; duplicating them onto Overview is exactly
# the kind of "not in its proper place" clutter the user flagged.
CESAR_METRIC_KEYS = {
    "activation_rate", "weekly_practice_frequency", "mau_rate",
    "delta_score", "readiness_index",
}


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


def _sql_date_clause(column: str, frm: str, to: str) -> str:
    """Mirrors lib/bridge-rolplay-app.ts's dateClause() exactly (same column,
    same inclusive BETWEEN bound) -- every rolplayApp* adapter there applies
    this to every query; preview_fetch.py's _rolplay_app previously applied
    it to NONE, silently returning all-time totals for any range narrower
    than "everything". frm/to are plain 'YYYY-MM-DD' dates (schema_discovery's
    discovered window or the wide discovery default), so the bound is padded
    to a full day on each end rather than truncating to midnight."""
    if not frm or not to:
        return ""
    return f" AND {column} BETWEEN '{frm} 00:00:00' AND '{to} 23:59:59'"


def _prev_period(frm: str, to: str) -> tuple[str, str] | None:
    """The equal-length window immediately before `frm` -- mirrors
    rolplayAppOverview's prevRange computation exactly (same "period
    immediately preceding the current one" definition), so a period-over-
    period KPI delta compares against the same baseline the hand-built app
    would show for this same range.

    prev_to is `frm` minus one day, NOT `frm` itself: _sql_date_clause pads
    both ends of a date-only bound to a full day (00:00:00..23:59:59), so a
    previous window ending exactly on `frm` would count the ENTIRE calendar
    day `frm` in both the current period (which starts at `frm 00:00:00`)
    and the previous one (which would end at `frm 23:59:59`) -- a real,
    material double-count for any typical 7-30 day dashboard window, not a
    one-instant edge case. Matches the -1 adjustment
    app/api/dashboard/cesar-kpis/route.ts already uses for the same reason.
    """
    try:
        f = datetime.combine(date.fromisoformat(frm), datetime.min.time())
        t = datetime.combine(date.fromisoformat(to), datetime.min.time())
    except ValueError:
        return None
    if t <= f:
        return None
    span = t - f
    prev_to = f - timedelta(days=1)
    prev_from = prev_to - span
    return prev_from.date().isoformat(), prev_to.date().isoformat()


def _calc_delta_pct(current: float | None, prev: float | None) -> float | None:
    """Mirrors lib/kpi-builder.ts's calcDeltaPct() exactly (0 decimals):
    (current-prev)/abs(prev)*100, rounded, or None when there's no real
    baseline to compare against (never a fabricated 0% to imply parity).
    Also None when the swing exceeds 999% -- a prior-period baseline that
    small isn't a real trend to compare against, just a near-empty prior
    window producing a technically-correct but meaningless four-digit
    number (e.g. 514 sessions vs. a 5-session prior window reads as
    "+10180%")."""
    if current is None or prev is None or prev == 0:
        return None
    raw = (current - prev) / abs(prev) * 100
    if abs(raw) > 999:
        return None
    return round(raw)


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
        metrics = {"total_sessions": ov.get("total_sessions"), "avg_score": ov.get("avg_score"),
                   "pass_rate": ov.get("pass_rate_pct")}
        # An unrecognized metric_key must be a loud, diagnosable error, not a
        # silent None -- a stale/mismatched key would otherwise render as a
        # permanently blank tile with no clue anywhere why (see the bare
        # dict.get() this replaced).
        if w.metric_key not in metrics:
            return WidgetPreview(widget_id=w.id, ok=False, error=f"unsupported metric_key '{w.metric_key}' for pharma_kpi")
        val = metrics[w.metric_key]
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
            if cfg.has_no_passing_criteria:
                return _no_passing_criteria_preview(w)
            v = round(100 * sum(1 for s in scored if s >= cfg.pass_threshold) / len(scored), 1) if scored else None
            return WidgetPreview(widget_id=w.id, ok=v is not None, value=v, legend=_pass_rate_legend(cfg))
        # An unrecognized metric_key must return here -- without this, a
        # kpi_tile with a stale/mismatched key fell through to the usecase-
        # breakdown `rows=` return at the bottom of this function, a
        # wrong-shaped WidgetPreview (rows instead of value) that KpiTile
        # renders as a permanently blank tile with no error shown at all.
        return WidgetPreview(widget_id=w.id, ok=False, error=f"unsupported metric_key '{w.metric_key}' for pharma_exceltis_rest")

    # ── Score trend (monthly avg score) ── Found live (Heineken): this
    # connector's rows carry a real 'Fecha_y_Hora' timestamp, but nothing
    # ever built a trend from it -- every line_chart widget silently fell
    # through to the usecase-breakdown branch below and rendered the wrong
    # data under a "Score Trend" title. Checked before that branch now.
    if w.type == WidgetType.line_chart:
        by_month: dict[str, list[float]] = {}
        for r in rows:
            sc = _norm_score(r)
            ts = r.get("Fecha_y_Hora")
            if sc is None or not ts:
                continue
            month = str(ts)[:7]  # 'YYYY-MM-DDTHH:MM:SS' -> 'YYYY-MM'
            by_month.setdefault(month, []).append(sc)
        series = [{"date": m, "value": round(sum(v) / len(v), 2), "sessions": len(v)}
                  for m, v in sorted(by_month.items())]
        return WidgetPreview(widget_id=w.id, ok=bool(series), series=series)

    # ── Best Performers: top users by average score ── Found live
    # (Heineken): rows carry a real 'Usuario_Nombre' identity, but no
    # leaderboard was ever built for this connector. Must be checked before
    # the generic usecase-breakdown branch below claims every table widget.
    if w.id.endswith(BEST_PERFORMERS_ID):
        by_user: dict[str, list[float]] = {}
        for r in rows:
            name = (r.get("Usuario_Nombre") or "").strip()
            sc = _norm_score(r)
            if not name or sc is None:
                continue
            by_user.setdefault(name, []).append(sc)
        ranked = sorted(by_user.items(), key=lambda kv: -(sum(kv[1]) / len(kv[1])))[:_BEST_PERFORMERS_LIMIT]
        out = [{
            "user_email": name, "user_name": name, "sessions": len(scores),
            "avg_score": round(sum(scores) / len(scores), 2),
            "pass_rate": None if cfg.has_no_passing_criteria else
                round(100 * sum(1 for s in scores if s >= cfg.pass_threshold) / len(scores), 1),
        } for name, scores in ranked]
        return WidgetPreview(widget_id=w.id, ok=bool(out), rows=out)

    # ── breakdown by usecase ──
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
        if cfg.has_no_passing_criteria:
            return _no_passing_criteria_preview(w)
        v = round(100 * sum(1 for s in scores if s >= cfg.pass_threshold) / len(scores), 1) if scores else None
        return WidgetPreview(widget_id=w.id, ok=v is not None, value=v, legend=_pass_rate_legend(cfg))
    return WidgetPreview(widget_id=w.id, ok=bool(rows), value=len(rows))


# ── rolplay-app (query endpoint; scores from raw_closing_data/closing_analysis) ──────
_logger = logging.getLogger(__name__)


async def _rolplay_app_sql(sql: str) -> list[dict]:
    """Every caller treats a failed query as an empty result -- see
    lib/bridge-rolplay-app.ts's remoteSelect for the TS mirror of this same
    silent-degradation contract and why it stays unchanged (one bad widget
    must not 500 the whole dashboard). But an httpx/network failure or a
    non-2xx status previously vanished into (body or {}).get("data", [])
    with zero trace anywhere -- post_json swallows the exception into an
    "__error" key (app/http.py) that nothing ever read or logged. Log it here
    so an outage is visible in ai-service logs instead of only as
    suspiciously-flat KPI numbers.
    """
    _, body = await post_json(get_settings().rolplay_app_sql_url, {"sql": sql})
    if isinstance(body, dict) and "__error" in body:
        _logger.error("rolplay-app SQL query failed (treated as empty data): %s", body["__error"])
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


async def _rolplay_app_kpi_metrics(cid: int, module: str | None, dc: str, threshold: int) -> dict[str, Any]:
    """One scalar-KPI query, parameterised by an already-built date clause —
    shared by the current-period fetch and (when a widget supports a
    period-over-period delta) the previous-period fetch, so both windows are
    computed by the exact same aggregation. `threshold` is the tenant's own
    configured pass_threshold (DashboardConfig.pass_threshold), not a fixed
    global -- see preview_fetch.py's module docstring on PASS_THRESHOLD."""
    data = await _rolplay_app_sql(
        "SELECT COUNT(s.ID) AS sessions, COUNT(DISTINCT u.ID) AS users, "
        f"COUNT({SCORE_SQL}) AS scored, "
        f"ROUND(AVG({SCORE_SQL}),2) AS avg_score, "
        f"SUM(CASE WHEN ({SCORE_SQL})>={threshold} THEN 1 ELSE 0 END) AS passed "
        f"FROM r_user u LEFT JOIN r_user_session s ON s.user_id=u.ID "
        f"WHERE u.client_id={cid}{_category_clause(module)}{dc}"
    )
    row = data[0] if data else {}
    sessions = int(row.get("sessions") or 0)
    # pass_rate's denominator must be SCORED sessions (COUNT(SCORE_SQL)), not
    # total sessions -- a session with no matching score-extraction pattern
    # returns NULL, not 0, and must be excluded, never diluting the rate. This
    # previously divided by `sessions`, understating pass_rate versus the
    # TS bridge (lib/bridge-rolplay-app.ts's fetchScoreStats) for any tenant
    # with genuinely unscoreable sessions -- matches lib/bridge-rolplay-app.ts.
    scored = int(row.get("scored") or 0)
    passed = int(row.get("passed") or 0)
    return {
        "total_sessions": sessions,
        "total_users": int(row.get("users") or 0),
        "avg_score": float(row["avg_score"]) if row.get("avg_score") is not None else None,
        "pass_rate": round(100 * passed / scored, 1) if scored else None,
        "passed": passed,
    }


# KPI tile metric_keys that have a real "previous period" comparison in the
# hand-built app (rolplayAppOverview's prevTotalEvaluations/prevAvgScore/
# prevPassRate) -- total_users/passed don't, so those stay delta-less exactly
# as before.
_DELTA_METRIC_KEYS = {"total_sessions", "avg_score", "pass_rate"}


async def _rolplay_app_cesar_metrics(cid: int, module: str | None, frm: str, to: str) -> dict[str, Any]:
    """KPI-1.1/1.3/1.4/2.2/2.3/5.3 from Sugerencia de KPI's Cesar.xlsx --
    every one of these is computed from r_user/r_user_session/SCORE_SQL
    alone (no raw_closing_data JSON needed), so it works for any
    rolplay_app_sql tenant, same as the pre-existing KPI tiles.

    Per-user sequencing (delta_score, readiness_index) is done in PYTHON
    after fetching one bounded (user_id, date, score) row set, rather than
    as nested correlated SQL -- simpler to get right and to test than
    re-deriving SCORE_SQL's alias-dependent CASE expression inside a
    subquery, for a one-time-per-render scalar computation.
    """
    dc = _sql_date_clause("s.date_created", frm, to)
    cat = _category_clause(module)

    enrolled_rows = await _rolplay_app_sql(f"SELECT COUNT(*) n FROM r_user u WHERE u.client_id={cid}")
    enrolled = int((enrolled_rows[0] if enrolled_rows else {}).get("n") or 0)

    active_rows = await _rolplay_app_sql(
        f"SELECT COUNT(DISTINCT s.user_id) n, COUNT(*) sessions, "
        f"COUNT(DISTINCT YEARWEEK(s.date_created)) weeks "
        f"FROM r_user_session s JOIN r_user u ON u.ID=s.user_id "
        f"WHERE u.client_id={cid}{cat}{dc}"
    )
    active_row = active_rows[0] if active_rows else {}
    active_users = int(active_row.get("n") or 0)
    period_sessions = int(active_row.get("sessions") or 0)
    active_weeks = int(active_row.get("weeks") or 0)

    # MAU: a real 30-day recency window, independent of whatever wider range
    # the dashboard's own date filter currently shows -- "monthly active" is
    # a fixed-length concept, not "active in the selected period".
    mau_rows = await _rolplay_app_sql(
        f"SELECT COUNT(DISTINCT s.user_id) n FROM r_user_session s JOIN r_user u ON u.ID=s.user_id "
        f"WHERE u.client_id={cid}{cat} AND s.date_created >= DATE_SUB('{to}', INTERVAL 30 DAY) "
        f"AND s.date_created <= '{to} 23:59:59'"
    )
    mau_users = int((mau_rows[0] if mau_rows else {}).get("n") or 0)

    # mastered_users comes from a DEDICATED, UNBOUNDED DB-side aggregate over
    # every scored session in range -- NOT from the bounded seq_rows scan
    # below. This mirrors a fix already shipped on the TS side
    # (lib/bridge-rolplay-app.ts's rolplayAppCesarGroup1): mastered_users used
    # to be derived from the same LIMIT-500 scan as delta_score, so
    # readiness_index (= mastered_users / enrolled) divided a capped
    # numerator by an uncapped denominator and silently trended toward 0% as
    # a tenant grew. Worse, the scan is ORDER BY user_id, so the 500 rows are
    # always the same lowest-numbered users -- a systematic bias, not a
    # sample. This query has no LIMIT, so it cannot exhibit that bias.
    mastery_rows = await _rolplay_app_sql(
        f"SELECT COUNT(DISTINCT CASE WHEN sc>={MASTERY_THRESHOLD} THEN user_id END) mastered_users "
        f"FROM (SELECT s.user_id user_id, ({SCORE_SQL}) sc "
        f"FROM r_user_session s JOIN r_user u ON u.ID=s.user_id "
        f"WHERE u.client_id={cid}{cat}{dc}) t WHERE sc IS NOT NULL"
    )
    mastered_users = int((mastery_rows[0] if mastery_rows else {}).get("mastered_users") or 0)

    # delta_score genuinely needs per-user chronological ordering, which has
    # no portable single-aggregate form here (no window functions are used
    # anywhere in this connector) -- it keeps the bounded scan, matching
    # Reports' own cap so a very large tenant doesn't pull its entire history
    # into memory every render. Unlike mastered_users, it is honestly flagged
    # as sampled when the cap is actually hit, rather than silently passing a
    # truncated average off as complete.
    seq_rows = await _rolplay_app_sql(
        f"SELECT s.user_id, s.date_created, ({SCORE_SQL}) sc "
        f"FROM r_user_session s JOIN r_user u ON u.ID=s.user_id "
        f"WHERE u.client_id={cid}{cat}{dc} AND ({SCORE_SQL}) IS NOT NULL "
        f"ORDER BY s.user_id, s.date_created ASC LIMIT {_CLOSING_DATA_SAMPLE_LIMIT}"
    )
    by_user: dict[Any, list[float]] = {}
    for r in seq_rows:
        by_user.setdefault(r["user_id"], []).append(float(r["sc"]))

    deltas = [scores[-1] - scores[0] for scores in by_user.values() if len(scores) >= 2]
    delta_score = round(sum(deltas) / len(deltas), 1) if deltas else None
    delta_score_sampled = len(seq_rows) >= _CLOSING_DATA_SAMPLE_LIMIT

    return {
        "activation_rate": round(100 * active_users / enrolled, 1) if enrolled else None,
        "weekly_practice_frequency": round(period_sessions / active_weeks, 1) if active_weeks else None,
        "mau_rate": round(100 * mau_users / enrolled, 1) if enrolled else None,
        "delta_score": delta_score,
        "delta_score_sampled": delta_score_sampled,
        # Both operands now count every scored session/user in range -- no
        # capped-numerator-over-uncapped-denominator mismatch.
        "readiness_index": round(100 * mastered_users / enrolled, 1) if enrolled else None,
    }


def _mastery_distribution_rows(scores: list[float]) -> list[dict]:
    """KPI-3.2: % Basic (<75) / Intermediate (75-94) / Advanced (>=95),
    exactly the buckets Cesar's spec defines."""
    if not scores:
        return []
    basic = sum(1 for s in scores if s < 75)
    intermediate = sum(1 for s in scores if 75 <= s < MASTERY_THRESHOLD)
    advanced = sum(1 for s in scores if s >= MASTERY_THRESHOLD)
    total = len(scores)
    return [
        {"label": "Basic (<75)", "value": basic, "pct": round(100 * basic / total, 1)},
        {"label": "Intermediate (75-94)", "value": intermediate, "pct": round(100 * intermediate / total, 1)},
        {"label": "Advanced (>=95)", "value": advanced, "pct": round(100 * advanced / total, 1)},
    ]


async def _rolplay_app_closing_data_rows(cid: int, module: str | None, dc: str) -> list[dict]:
    """Fetches and parses raw_closing_data JSON for every real session in
    scope -- confirmed a genuinely rich per-session evaluation (5 scored
    commercial-domain blocks, 24 individually-scored checklist items, an
    adoption-intent movement field) for Siigo, and confirmed ENTIRELY ABSENT
    for Takeda (its sessions score via closing_analysis HTML only, no JSON at
    all). Rows with missing/invalid JSON are silently skipped, never treated
    as zeros -- callers that get an empty list report "no data" honestly, the
    same rule every other widget in this file already follows.
    """
    rows = await _rolplay_app_sql(
        "SELECT s.raw_closing_data AS d FROM r_user_session s JOIN r_user u ON u.ID=s.user_id "
        f"WHERE u.client_id={cid}{_category_clause(module)}{dc} AND s.raw_closing_data IS NOT NULL "
        f"ORDER BY s.date_created DESC LIMIT {_CLOSING_DATA_SAMPLE_LIMIT}"
    )
    out: list[dict] = []
    for r in rows:
        raw = r.get("d")
        if not raw:
            continue
        try:
            parsed = json.loads(raw)
        except (TypeError, ValueError):
            continue
        if isinstance(parsed, dict):
            out.append(parsed)
    return out


_BLOQUE_SCORE_RE = re.compile(r"^bloque_(.+)_score$")
_RUBRICA_ITEM_RE = re.compile(r"^rubrica_p(\d+)_nombre$")


def _commercial_domain_rows(parsed: list[dict]) -> list[dict]:
    """KPI-4.1: Score by Commercial Domain -- averages whichever
    'bloque_<name>_score' keys each session's evaluator actually produced
    (Siigo's real 5: crear_conexion/obtener_informacion/crear_emocion/
    obtener_si/romper_no). Discovered per-session via regex, never a
    hardcoded block list or count -- a different product's evaluator with
    different domain names or a different number of stages still works."""
    scores: dict[str, list[float]] = {}
    for d in parsed:
        for k, v in d.items():
            m = _BLOQUE_SCORE_RE.match(k)
            if not m:
                continue
            try:
                scores.setdefault(m.group(1), []).append(float(v))
            except (TypeError, ValueError):
                continue
    out = [
        {"domain": name.replace("_", " ").title(), "avg_score": round(sum(vals) / len(vals), 1), "sessions": len(vals)}
        for name, vals in scores.items()
    ]
    return sorted(out, key=lambda r: -r["avg_score"])


def _rubrica_tag_counts(parsed: list[dict], want_pass: bool) -> list[dict]:
    """KPI-4.2 (Top Strengths, want_pass=True) / KPI-4.3 (Top Areas of
    Opportunity, want_pass=False) -- counts how often each individually-
    scored checklist item ('rubrica_pN_nombre') passed or failed across every
    real session, using whichever numbered items each session's evaluator
    actually produced (Siigo's real rubric has 24). Discovered via regex, so
    a different product's rubric with a different item count still works."""
    counts: dict[str, int] = {}
    for d in parsed:
        for k, v in d.items():
            m = _RUBRICA_ITEM_RE.match(k)
            # A non-string label (e.g. a nested object from a non-conforming
            # evaluator payload) must be skipped, not blindly stringified
            # into a garbage row in Top Strengths/Opportunities.
            if not m or not isinstance(v, str) or not v:
                continue
            cumplido = str(d.get(f"rubrica_p{m.group(1)}_cumplido", "")).strip().lower()
            if cumplido not in ("true", "false"):
                continue
            if (cumplido == "true") == want_pass:
                counts[v] = counts.get(v, 0) + 1
    ranked = sorted(counts.items(), key=lambda kv: -kv[1])[:10]
    return [{"item": name, "count": n} for name, n in ranked]


def _adoption_movement_rate(parsed: list[dict]) -> float | None:
    """KPI-5.1: % of sessions where the evaluator's own 'intencion_movement'
    field records a positive shift (Siigo's real values: 'Subió'/'Bajó' —
    went up/down). Sessions from a tenant/product whose evaluator has no
    such field are simply excluded from the denominator, not counted as a
    fabricated 0% -- returns None (not 0) when nothing in scope has this
    field at all, so the widget reports 'no data' rather than a false zero.
    """
    movements = [str(d.get("intencion_movement", "")).strip() for d in parsed if d.get("intencion_movement")]
    if not movements:
        return None
    positive = sum(1 for m in movements if m.lower().startswith(("sub", "up", "increas", "avanz")))
    return round(100 * positive / len(movements), 1)


async def _rolplay_app(cfg: DashboardConfig, w: WidgetConfig) -> WidgetPreview:
    cid = int(cfg.connector_handle.get("client_id"))
    frm, to = _date_range(cfg, w)
    dc = _sql_date_clause("s.date_created", frm, to)
    base = f"FROM r_user_session s JOIN r_user u ON u.ID=s.user_id WHERE u.client_id={cid}{_category_clause(w.module)}{dc}"

    # ── Solution journey: one row per canonical module, in journey order ──
    # Deliberately spans the tenant's FULL discovered history, not the
    # current date-range window -- a journey shows "which stages this tenant
    # has ever reached", the same all-time shape the hand-built /journey page
    # shows, not a windowed slice that could make a real stage vanish.
    if w.type == WidgetType.journey:
        rows = await _rolplay_app_sql(
            "SELECT sim.category AS category, COUNT(*) total_sessions, "
            f"COUNT({SCORE_SQL}) scored, "
            f"SUM(CASE WHEN ({SCORE_SQL})>={cfg.pass_threshold} THEN 1 ELSE 0 END) passed_sessions "
            "FROM r_user_session s JOIN r_user u ON u.ID=s.user_id "
            f"JOIN r_simulator sim ON sim.ID=s.simulator_id WHERE u.client_id={cid} "
            "GROUP BY sim.category"
        )
        by_module = {
            journey_lib.CATEGORY_TO_MODULE[str(r["category"]).upper()]: r
            for r in rows if str(r.get("category") or "").upper() in journey_lib.CATEGORY_TO_MODULE
        }
        stages = journey_lib.ordered_stages(list(by_module.keys()))
        out = []
        for m in stages:
            r = by_module[m]
            scored = int(r.get("scored") or 0)
            passed_sessions = int(r.get("passed_sessions") or 0)
            out.append({
                "module": m, "label": journey_lib.LABEL[m], "phase": journey_lib.PHASE[m],
                "total_sessions": int(r.get("total_sessions") or 0),
                "passed_sessions": passed_sessions,
                # Denominator is SCORED sessions, not total -- a session with
                # no matching score-extraction pattern is excluded, never
                # counted as failing (matches _rolplay_app_kpi_metrics above).
                # None (not a computed number) for a tenant with no real
                # passing criteria -- never fabricate a rate against a
                # threshold that doesn't apply to it.
                "pass_rate": None if cfg.has_no_passing_criteria else
                    (round(100 * passed_sessions / scored, 1) if scored else None),
            })
        return WidgetPreview(widget_id=w.id, ok=len(out) >= 2, rows=out,
                             error=None if len(out) >= 2 else "fewer than 2 real modules for a journey")

    # ── Daily session volume + passed count (Total vs Passed grouped bar) ──
    # Must be checked before the generic bar_chart branch below claims every
    # bar_chart-typed widget.
    if w.id.endswith(DAILY_PASSFAIL_ID):
        # This chart is fundamentally a Total-vs-Passed comparison -- for a
        # tenant with no real passing criteria there is no "Passed" series to
        # draw at all, not a zero one. Skip it entirely rather than fabricate.
        if cfg.has_no_passing_criteria:
            return WidgetPreview(widget_id=w.id, ok=False,
                                 error="This tenant has no score-based passing criteria configured")
        rows = await _rolplay_app_sql(
            "SELECT day, COUNT(*) sessions, "
            f"SUM(CASE WHEN sc>={cfg.pass_threshold} THEN 1 ELSE 0 END) passed FROM ("
            f"SELECT DATE(s.date_created) day, {SCORE_SQL} sc {base}) t "
            "GROUP BY day ORDER BY day"
        )
        out = [{"date": str(r.get("day"))[:10], "sessions": int(r.get("sessions") or 0),
                "passed": int(r.get("passed") or 0)} for r in rows]
        return WidgetPreview(widget_id=w.id, ok=bool(out), rows=out)

    # ── Best Performers: top users by average score ──
    # Must be checked before the generic table branch below claims every
    # table-typed widget.
    if w.id.endswith(BEST_PERFORMERS_ID):
        rows = await _rolplay_app_sql(
            "SELECT u.email email, u.name name, COUNT(*) sessions, "
            f"COUNT({SCORE_SQL}) scored, "
            f"ROUND(AVG({SCORE_SQL}),2) avg_score, "
            f"SUM(CASE WHEN ({SCORE_SQL})>={cfg.pass_threshold} THEN 1 ELSE 0 END) passed "
            f"{base} GROUP BY u.ID, u.email, u.name "
            f"HAVING COUNT({SCORE_SQL}) > 0 "
            f"ORDER BY avg_score DESC, sessions DESC LIMIT {_BEST_PERFORMERS_LIMIT}"
        )
        # HAVING COUNT(SCORE_SQL) > 0 guarantees scored > 0 for every returned
        # row today, but the pass_rate denominator is scored sessions, not
        # total sessions, matching lib/bridge-rolplay-app.ts's
        # rolplayAppBestPerformers -- never dilute by unscored sessions if
        # that guard is ever relaxed.
        out = [{
            "user_email": r.get("email"), "user_name": (r.get("name") or "").strip() or None,
            "sessions": int(r.get("sessions") or 0),
            "avg_score": float(r["avg_score"]) if r.get("avg_score") is not None else 0.0,
            "pass_rate": None if cfg.has_no_passing_criteria else
                (round(100 * int(r.get("passed") or 0) / int(r["scored"]), 1) if r.get("scored") else 0.0),
        } for r in rows]
        return WidgetPreview(widget_id=w.id, ok=bool(out), rows=out)

    # ── Organization: full registered roster, not aggregated by anything ──
    # Must be checked before the generic table branch below claims every
    # table-typed widget. Deliberately no join to r_user_session and no
    # date-range/category filter -- an account's existence isn't scoped to
    # when it happened to run a session. NEVER select u.password.
    if w.id.endswith(REGISTERED_USERS_TABLE_ID):
        rows = await _rolplay_app_sql(
            "SELECT u.name name, u.email email, u.department department, "
            "u.designation designation, u.created_on created_on, "
            "u.last_loggedin last_loggedin, u.disabled disabled "
            f"FROM r_user u WHERE u.client_id={cid} "
            f"ORDER BY u.created_on DESC LIMIT {_REGISTERED_USERS_ROW_LIMIT}"
        )
        out = [{
            "name": (r.get("name") or "").strip() or None,
            "email": r.get("email"),
            "department": (r.get("department") or "").strip() or None,
            "designation": (r.get("designation") or "").strip() or None,
            "created_on": str(r.get("created_on"))[:10] if r.get("created_on") else None,
            "last_loggedin": str(r.get("last_loggedin"))[:10] if r.get("last_loggedin") else None,
            "status": "Disabled" if int(r.get("disabled") or 0) else "Active",
        } for r in rows]
        return WidgetPreview(widget_id=w.id, ok=bool(out), rows=out)

    # ── Score by Commercial Domain (KPI-4.1) ──
    if w.id.endswith(COMMERCIAL_DOMAIN_ID):
        parsed = await _rolplay_app_closing_data_rows(cid, w.module, dc)
        out = _commercial_domain_rows(parsed)
        return WidgetPreview(widget_id=w.id, ok=bool(out), rows=out,
                             error=None if out else "no raw_closing_data with bloque_* scores in scope")

    # ── Top Strengths / Top Areas of Opportunity (KPI-4.2 / KPI-4.3) ──
    if w.id.endswith(TOP_STRENGTHS_ID) or w.id.endswith(TOP_OPPORTUNITIES_ID):
        parsed = await _rolplay_app_closing_data_rows(cid, w.module, dc)
        out = _rubrica_tag_counts(parsed, want_pass=w.id.endswith(TOP_STRENGTHS_ID))
        return WidgetPreview(widget_id=w.id, ok=bool(out), rows=out,
                             error=None if out else "no raw_closing_data with rubrica_pN items in scope")

    # ── Distribution by Mastery Level (KPI-3.2): Basic / Intermediate / Advanced ──
    if w.id.endswith(MASTERY_DISTRIBUTION_ID):
        score_rows = await _rolplay_app_sql(
            f"SELECT {SCORE_SQL} sc {base}"
        )
        scores = [float(r["sc"]) for r in score_rows if r.get("sc") is not None]
        out = _mastery_distribution_rows(scores)
        return WidgetPreview(widget_id=w.id, ok=bool(out), rows=out)

    # ── Trend line: monthly avg score ──
    if w.type == WidgetType.line_chart:
        # `sessions` must count every real session that period, scored or not
        # -- a WHERE sc IS NOT NULL on the outer query (previous version) also
        # dropped unscored sessions from the session-volume count itself,
        # undercounting relative to lib/bridge-rolplay-app.ts's equivalent
        # trend (which counts all sessions unconditionally). AVG(sc) already
        # ignores NULLs on its own, so `value` doesn't need the filter either.
        rows = await _rolplay_app_sql(
            "SELECT period, ROUND(AVG(sc),2) value, COUNT(*) sessions FROM ("
            f"SELECT DATE_FORMAT(s.date_created,'%Y-%m') period, {SCORE_SQL} sc {base}) t "
            "GROUP BY period ORDER BY period"
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

    # ── Reports: individual sessions, not aggregated by simulator ──
    # Distinct from the per-simulator breakdown just below (one row per
    # simulator) and from the drilldown table (capped at 50, no search) —
    # this is the real Reports-page dataset: every real session as its own
    # row, real rep identity, real date/score/result, up to a bounded cap
    # the frontend paginates/searches over client-side.
    if w.id.endswith(REPORTS_TABLE_ID):
        # NULL (not 'Failed') for a tenant with no real passing criteria at
        # all -- never fabricate a verdict against a threshold that doesn't
        # apply. A literal SQL NULL keeps the column shape identical to the
        # "unscored session" case below, so the frontend needs no new state.
        result_case = (
            "NULL AS result" if cfg.has_no_passing_criteria else
            # NULL >= threshold is NULL (unknown) in SQL, not false, so a plain
            # CASE/ELSE here would fall through to 'Failed' for a session with
            # no extractable score at all -- a fabricated verdict next to a
            # blank score. Emit NULL (unknown), matching
            # lib/bridge-rolplay-app.ts's _rolplayAppResultsImpl
            # (`score != null ? (passed ? 'pass' : 'fail') : null`).
            f"CASE WHEN {SCORE_SQL} IS NULL THEN NULL "
            f"WHEN ({SCORE_SQL})>={cfg.pass_threshold} THEN 'Passed' ELSE 'Failed' END AS result"
        )
        rows = await _rolplay_app_sql(
            # s.ID drives the frontend's /drilldown/[id] link (WidgetConfig.id_field,
            # set on this widget in dashboard_planning.py's _reports_page) -- it
            # matches app/drilldown/[id]/page.tsx's own report-id key exactly, the
            # same session id lib/bridge-rolplay-app.ts's rolplayAppDrilldown scopes
            # its lookup by, so every session row here is now click-through-able.
            "SELECT s.ID AS id, s.date_created AS date, u.email AS rep, "
            "COALESCE(sim.name, CONCAT('Simulator ', s.simulator_id)) AS simulator, "
            f"ROUND({SCORE_SQL},1) AS score, {result_case} "
            "FROM r_user_session s JOIN r_user u ON u.ID=s.user_id "
            f"LEFT JOIN r_simulator sim ON sim.ID=s.simulator_id WHERE u.client_id={cid}{_category_clause(w.module)}{dc} "
            f"ORDER BY s.date_created DESC LIMIT {_REPORTS_ROW_LIMIT}"
        )
        return WidgetPreview(widget_id=w.id, ok=bool(rows), rows=rows)

    # ── Per-simulator breakdown (bar_chart / donut / table / approval-donut) ──
    if w.type in (WidgetType.bar_chart, WidgetType.donut, WidgetType.table) or w.id.endswith(APPROVAL_DONUT_ID):
        # The approval donut is fundamentally an Approved-vs-Not-Approved
        # split -- for a tenant with no real passing criteria there is no
        # such split to draw, not a zero one.
        if w.id.endswith(APPROVAL_DONUT_ID) and cfg.has_no_passing_criteria:
            return WidgetPreview(widget_id=w.id, ok=False,
                                 error="This tenant has no score-based passing criteria configured")
        rows = await _rolplay_app_sql(
            "SELECT COALESCE(sim.name, CONCAT('Simulator ', s.simulator_id)) simulator, "
            f"COUNT(*) total_sessions, COUNT({SCORE_SQL}) scored, ROUND(AVG({SCORE_SQL}),2) avg_score, "
            f"SUM(CASE WHEN ({SCORE_SQL})>={cfg.pass_threshold} THEN 1 ELSE 0 END) passed_sessions "
            "FROM r_user_session s JOIN r_user u ON u.ID=s.user_id "
            f"LEFT JOIN r_simulator sim ON sim.ID=s.simulator_id WHERE u.client_id={cid}{_category_clause(w.module)}{dc} "
            "GROUP BY s.simulator_id, sim.name ORDER BY total_sessions DESC"
        )
        # pass_rate denominator is SCORED sessions, not total_sessions -- an
        # unscoreable session must be excluded, never dilute the rate
        # (matches lib/bridge-rolplay-app.ts's rolplayAppUsecaseBreakdown).
        # None (not a computed number) for a tenant with no real passing
        # criteria -- never fabricate a rate against an inapplicable threshold.
        for r in rows:
            scored = int(r.get("scored") or 0)
            r["pass_rate"] = None if cfg.has_no_passing_criteria else (
                round(100 * int(r.get("passed_sessions") or 0) / scored, 1) if scored else None)
        if w.id.endswith(APPROVAL_DONUT_ID):
            return _approval_donut((int(r.get("total_sessions") or 0) for r in rows),
                                    (int(r.get("passed_sessions") or 0) for r in rows), w.id)
        return WidgetPreview(widget_id=w.id, ok=bool(rows), rows=rows)

    # ── Adoption Movement Rate (KPI-5.1) ──
    if w.id.endswith(ADOPTION_MOVEMENT_ID) or w.metric_key == "adoption_movement_rate":
        parsed = await _rolplay_app_closing_data_rows(cid, w.module, dc)
        val = _adoption_movement_rate(parsed)
        return WidgetPreview(widget_id=w.id, ok=val is not None, value=val,
                             error=None if val is not None else "no raw_closing_data with intencion_movement in scope")

    # ── Registered Users (full roster, distinct from "Active Users" =
    # total_users below which only counts reps who actually have a
    # session) -- a real, dedicated, unfiltered count, never conflated with
    # the date-scoped/session-joined query _rolplay_app_kpi_metrics runs for
    # total_users. Deliberately its own query rather than a metrics dict
    # lookup: the module-category/date-range filters below apply to
    # SESSIONS, not to whether someone merely has an account.
    if w.metric_key == "total_roster":
        rows = await _rolplay_app_sql(f"SELECT COUNT(*) n FROM r_user WHERE client_id={cid}")
        val = int((rows[0] if rows else {}).get("n") or 0)
        return WidgetPreview(widget_id=w.id, ok=val > 0, value=val)

    # ── Cesar's Group-1 KPIs (activation/weekly-frequency/MAU/practices-to-
    # mastery/delta-score/readiness) -- schema-only, no raw_closing_data
    # needed, so these work for any rolplay_app_sql tenant. ──
    if w.metric_key in CESAR_METRIC_KEYS:
        cesar = await _rolplay_app_cesar_metrics(cid, w.module, frm, to)
        val = cesar.get(w.metric_key)
        return WidgetPreview(widget_id=w.id, ok=val is not None, value=val)

    # ── KPI tiles (scalar), with a period-over-period delta for the 3 metrics
    # the hand-built Overview compares (rolplayAppOverview's prevTotal
    # Evaluations/prevAvgScore/prevPassRate) ──
    if w.metric_key == "pass_rate" and cfg.has_no_passing_criteria:
        return _no_passing_criteria_preview(w)

    metrics = await _rolplay_app_kpi_metrics(cid, w.module, dc, cfg.pass_threshold)
    # A stale/mismatched metric_key must error, not silently default to
    # total_sessions's value (the previous `.get(w.metric_key, sessions)`) --
    # that masked the mismatch by showing a real-looking but WRONG number
    # under whatever title the tile has, worse than a blank tile because
    # nothing anywhere would look off.
    if w.metric_key not in metrics:
        return WidgetPreview(widget_id=w.id, ok=False, error=f"unsupported metric_key '{w.metric_key}' for rolplay_app_sql")
    val = metrics[w.metric_key]

    prev_val: float | None = None
    prev_window = _prev_period(frm, to)
    if prev_window and w.metric_key in _DELTA_METRIC_KEYS:
        prev_frm, prev_to = prev_window
        prev_dc = _sql_date_clause("s.date_created", prev_frm, prev_to)
        prev_metrics = await _rolplay_app_kpi_metrics(cid, w.module, prev_dc, cfg.pass_threshold)
        prev_val = prev_metrics.get(w.metric_key)

    return WidgetPreview(
        widget_id=w.id, ok=val is not None, value=val,
        prev_value=prev_val, delta_pct=_calc_delta_pct(val, prev_val) if isinstance(val, (int, float)) else None,
        legend=_pass_rate_legend(cfg) if w.metric_key == "pass_rate" else None,
    )


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
    if w.metric_key not in m:
        return WidgetPreview(widget_id=w.id, ok=False, error=f"unsupported metric_key '{w.metric_key}' for second_brain")
    val = m[w.metric_key]
    # `w.metric_key in m` alone (the previous check) is true for any of the
    # 4 keys above regardless of whether the underlying stat was actually
    # present -- a real organization with e.g. no coaching sessions yet got
    # ok=True, value=None: a blank tile marked SUCCESSFUL, so the frontend
    # never shows the "no data" caption either. Must check the value itself.
    return WidgetPreview(widget_id=w.id, ok=val is not None, value=val)


def _num(v) -> bool:
    try:
        float(v)
        return True
    except (TypeError, ValueError):
        return False
