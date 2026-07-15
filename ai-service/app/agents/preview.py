"""Agent 8 — Preview. Calls the real backend and returns live widget values."""
from __future__ import annotations

import asyncio

from ..models import DashboardConfig, DashboardPreview, WidgetPreview
from ..preview_fetch import fetch_widget
from .base import LogFn


async def run(cfg: DashboardConfig, log: LogFn) -> DashboardPreview:
    widgets = [w for r in cfg.rows for w in r.widgets]
    await log("preview", "info", f"Fetching live data for {len(widgets)} widget(s)…")
    results: list[WidgetPreview] = await asyncio.gather(*(fetch_widget(cfg, w) for w in widgets))
    ok = sum(1 for r in results if r.ok)
    empties = [r.widget_id for r in results if not r.ok]
    lvl = "success" if ok == len(results) else ("warn" if ok else "error")
    await log("preview", lvl,
              f"{ok}/{len(results)} widget(s) returned real data" + (f"; empty: {', '.join(empties)}" if empties else ""))
    return DashboardPreview(slug=cfg.slug, widgets=results)
