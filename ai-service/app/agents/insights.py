"""Agent — AI Insights.

Evidence-backed narrative sentences, generated from the ACTUAL fetched
preview values (not the schema, not the plan) — distinct from
dashboard_planning.py's `recommendations`, which are short actionable
suggestions derived before any real value is fetched. This runs LAST, after
preview.run() has real numbers in hand, so every sentence can be grounded in
something that actually happened, not what the schema merely promised.

Confidence-gated: with fewer than MIN_GROUNDED_WIDGETS real (ok=True,
non-null) data points, there isn't enough evidence to say anything
meaningful — this returns [] rather than asking an LLM to pad the gap with
plausible-sounding filler. Scoped to rolplay_app_sql only for this pass
(see models.py's DashboardConfig.insights docstring); every other connector
gets an empty insights list, unchanged from before this agent existed.
"""
from __future__ import annotations

import json

from ..llm import gemini_json, llm_available
from ..models import DashboardConfig, DashboardPreview, ServiceKind, WidgetPreview
from .base import LogFn

MIN_GROUNDED_WIDGETS = 2
MAX_INSIGHTS = 4


def _grounded_facts(cfg: DashboardConfig, preview: DashboardPreview) -> list[dict]:
    """One real fact per widget with an actual value/short row summary —
    never a raw dump of full row data (keeps the prompt small and every
    fact independently checkable against what's on screen)."""
    widget_titles = {w.id: w.title for p in cfg.pages for r in p.rows for w in r.widgets}
    by_id = {w.widget_id: w for w in preview.widgets}
    facts: list[dict] = []
    for widget_id, title in widget_titles.items():
        wp: WidgetPreview | None = by_id.get(widget_id)
        if not wp or not wp.ok:
            continue
        if wp.value is not None:
            facts.append({"metric": title, "value": wp.value})
        elif wp.rows:
            facts.append({"metric": title, "row_count": len(wp.rows)})
    return facts


async def run(cfg: DashboardConfig, preview: DashboardPreview, log: LogFn) -> list[str]:
    if cfg.connector != ServiceKind.rolplay_app_sql:
        return []  # scoped to this pass only -- every other connector unchanged

    facts = _grounded_facts(cfg, preview)
    if len(facts) < MIN_GROUNDED_WIDGETS:
        await log("insights", "info",
                  f"Only {len(facts)} real data point(s) — not enough evidence for a grounded insight, skipping.")
        return []

    if not llm_available():
        await log("insights", "info", "LLM unavailable — no insights generated (never fabricated without it).")
        return []

    system = (
        "You write short, factual analytics insights for a sales-enablement "
        "dashboard. HARD RULES: use ONLY the numbers given below — never "
        "invent a figure, trend, or comparison not present in the data. If "
        "the data doesn't support a clear statement, write a more modest one "
        "rather than overreaching. Each sentence must cite at least one real "
        "number from the input. Return STRICT JSON: a list of 2-4 short "
        "sentences (strings), most useful first."
    )
    user = f"Company: {cfg.company}\nReal data points:\n{json.dumps(facts)}"
    result = await gemini_json(system, user)
    if not isinstance(result, list):
        await log("insights", "warn", "LLM returned nothing usable — no insights generated.")
        return []

    insights = [str(s).strip() for s in result if isinstance(s, str) and s.strip()][:MAX_INSIGHTS]
    if insights:
        await log("insights", "success", f"{len(insights)} evidence-backed insight(s) generated.")
    return insights
