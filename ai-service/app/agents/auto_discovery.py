"""Agent 4b — Auto Discovery.

schema_discovery only ever asks a bridge for the handful of actions it was
coded to expect (sim.demorp6, cert.stats, ...). But a real bridge's own
introspection response often advertises many more real, working actions the
pipeline has never heard of by name — e.g. Sanfer's bridge also has
objections.demorp6, org.certification, cert.bestscores, cert.clients,
sim.topstats. A developer would otherwise have to learn and hardcode each one
per company, which does not scale past a handful of clients.

This agent instead treats every advertised-but-unrecognized action as a
candidate: it actually calls it with the same params already known to work
(exercise ids + wide date range), and only keeps what comes back as real,
non-empty data. Nothing is ever invented — an action that 404s, errors, or
returns nothing is silently dropped, same as every other agent in this
pipeline. This is deliberately generic (keyed on response SHAPE, not on any
company's specific field names) so it applies uniformly to every tenant
using this bridge protocol, not just the one it happened to be built against.
"""
from __future__ import annotations

import json
from typing import Any

from ..config import get_settings
from ..http import post_json
from ..llm import gemini_json, llm_available
from ..models import DiscoveredMetric, MetricType, NormalizedSchema, ServiceDescriptor, ServiceKind
from .base import LogFn

# Actions already understood by dedicated code for each kind — never re-probed
# here (avoids duplicate metrics and wasted calls).
_KNOWN_ACTIONS: dict[ServiceKind, set[str]] = {
    ServiceKind.pharma_kpi: {
        "ping", "kpi.overview", "kpi.activity_summary", "kpi.score_trend", "kpi.leaderboard", "kpi.sessions",
    },
    ServiceKind.pharma_sale_exercises: {
        "ping", "__introspect__", "sim.demorp6", "activities.demorp6", "cert.stats", "cert.count", "cert.sessions",
    },
}

# Action-name conventions this bridge family uses for internal/debug tooling —
# never real business content, so never worth surfacing regardless of shape.
_EXCLUDED_SUFFIXES = (".raw", ".explore", ".lookup", ".tables", ".columns")
_EXCLUDED_EXACT = {"ping", "__introspect__"}

# No silent caps: if a tenant's bridge advertises more than this, we probe the
# first N and log exactly what was skipped rather than pretending it isn't there.
MAX_AUTO_PROBE = 12

_META_KEYS = {"ok", "cached", "_bridge", "error"}


async def run(schema: NormalizedSchema, service: ServiceDescriptor, exercise_ids: list[int], log: LogFn) -> None:
    known = _KNOWN_ACTIONS.get(service.kind)
    if known is None:
        return  # exceltis_rest and others don't self-report an action list to explore

    candidates = [
        a for a in service.endpoints
        if a not in known and a not in _EXCLUDED_EXACT and not a.endswith(_EXCLUDED_SUFFIXES)
    ]
    if not candidates:
        return

    skipped: list[str] = []
    if len(candidates) > MAX_AUTO_PROBE:
        skipped = candidates[MAX_AUTO_PROBE:]
        candidates = candidates[:MAX_AUTO_PROBE]

    await log("auto_discovery", "info",
              f"Probing {len(candidates)} undocumented action(s) this bridge advertises: {', '.join(candidates)}")
    if skipped:
        await log("auto_discovery", "warn",
                  f"{len(skipped)} additional action(s) not probed this run (cap={MAX_AUTO_PROBE}): {', '.join(skipped)}")

    slug = service.handle.get("tenant", schema.slug)
    ids = exercise_ids or []
    s = get_settings()
    params: dict[str, Any] = {"date_from": s.discovery_wide_date_from, "date_to": s.discovery_wide_date_to}
    if ids:
        params["ids"] = ",".join(map(str, ids))

    found_scalars: list[tuple[str, dict[str, float]]] = []
    found_tables: list[tuple[str, str, list[dict]]] = []  # (action, field_path, rows)

    for action in candidates:
        try:
            status, body = await post_json(service.base_url, {"action": action, **params}, {"X-Tenant": slug})
        except Exception:
            continue
        if status != 200 or not isinstance(body, dict) or body.get("ok") is False:
            continue
        scalars, tables = _extract_shapes(body)
        if tables:
            # A table result is the primary signal for this action even if a
            # bookkeeping "count" also happened to be scalar — keep both;
            # a real "Members: 61" tile alongside the member list is useful.
            field_path, rows = next(iter(tables.items()))
            found_tables.append((action, field_path, rows))
        if scalars:
            found_scalars.append((action, scalars))

    if not found_scalars and not found_tables:
        await log("auto_discovery", "info", "None of the undocumented actions returned real data — nothing added")
        return

    labels = await _label_actions(schema.company, found_scalars, found_tables)

    for action, scalars in found_scalars:
        info = labels.get(action, {})
        module = info.get("module") or _humanize(action)
        for field, _value in scalars.items():
            schema.metrics.append(DiscoveredMetric(
                key=f"{action.replace('.', '_')}_{field}",
                label=(info.get("fields") or {}).get(field) or _humanize(field),
                type=MetricType.count,
                source_kind=service.kind, source_action=action, raw_field=field,
            ))
        if module not in schema.modules:
            schema.modules.append(module)
        await log("auto_discovery", "success", f"'{action}' → {len(scalars)} real metric(s) confirmed")

    for action, field_path, rows in found_tables:
        info = labels.get(action, {})
        module = info.get("module") or _humanize(action)
        schema.metrics.append(DiscoveredMetric(
            key=f"{action.replace('.', '_')}_table",
            label=info.get("label") or _humanize(action),
            type=MetricType.table,
            source_kind=service.kind, source_action=action, raw_field=field_path,
        ))
        if module not in schema.modules:
            schema.modules.append(module)
        await log("auto_discovery", "success", f"'{action}' → real table data confirmed ({len(rows)} row(s))")


def _extract_shapes(body: dict) -> tuple[dict[str, float], dict[str, list[dict]]]:
    """Scan up to 2 levels deep for numeric scalars and list-of-dict tables.

    Some actions put their payload at the top level (cert.stats: {certified,
    total, ...}), others nest it one level down (sim.topstats: {stats:{...},
    top_users:[...]}). Both are common in this bridge family, so both are
    checked without assuming either convention.
    """
    scalars: dict[str, float] = {}
    tables: dict[str, list[dict]] = {}

    def scan(obj: dict, prefix: str = "") -> None:
        for k, v in obj.items():
            if k in _META_KEYS:
                continue
            full_key = f"{prefix}.{k}" if prefix else k
            if isinstance(v, bool):
                continue
            if isinstance(v, (int, float)):
                scalars[full_key] = v
            elif isinstance(v, list) and v and isinstance(v[0], dict):
                tables.setdefault(full_key, v)
            elif isinstance(v, dict) and not prefix:  # one level of nesting only
                scan(v, k)

    scan(body)
    return scalars, tables


async def _label_actions(
    company: str,
    scalars: list[tuple[str, dict[str, float]]],
    tables: list[tuple[str, str, list[dict]]],
) -> dict[str, dict]:
    """Ask Gemini for clean human labels from action + field NAMES only (never
    real values — nothing customer-specific needs to reach the model to name
    a field). Falls back to humanizing the raw names if the LLM is unavailable."""
    if not llm_available():
        return {}
    payload = {
        "scalar_actions": [{"action": a, "fields": list(f.keys())} for a, f in scalars],
        "table_actions": [{"action": a, "sample_columns": list(r[0].keys()) if r else []} for a, _fp, r in tables],
    }
    system = (
        "You label analytics dashboard fields for a coaching/training platform. "
        "You are given only ACTION NAMES and FIELD/COLUMN NAMES — never real "
        "values. Propose a short human module name and per-field labels. "
        "Return STRICT JSON: {\"<action>\": {\"module\": \"...\", \"label\": \"...\", "
        "\"fields\": {\"<field>\": \"...\"}}, ...} for every action given."
    )
    user = f"Company: {company}\n" + json.dumps(payload)
    result = await gemini_json(system, user)
    return result if isinstance(result, dict) else {}


def _humanize(name: str) -> str:
    return name.replace(".", " ").replace("_", " ").strip().title()
