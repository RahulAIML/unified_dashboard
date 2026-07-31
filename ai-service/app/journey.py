"""The Rolplay solution journey — Python port of lib/journey.ts's canonical
ordering, kept deliberately in sync with it (same 5 modules, same order, same
phase groupings). See that file for the full rationale: knowledge is adopted
(LMS), practised (Master Coach, Simulator), validated (Certifier Coach), then
sustained in the field (Second Brain).

A dashboard's `schema.modules` only qualifies as journey-able when every
discovered value is already one of these 5 canonical names — e.g.
rolplay_app_sql's schema_discovery maps r_simulator.category via
_CATEGORY_TO_MODULE before ever reaching here (COACH/SIM/SEGMENT -> the exact
strings below). A connector whose modules are raw, unclassified strings (e.g.
pharma_kpi's activity_type values like "Coach evaluador") is NOT run through
this — that would mean guessing a low-confidence LMS/Coach/Simulator label
with no verified mapping, which is worse than not showing a journey at all.
"""
from __future__ import annotations

CANONICAL_ORDER: list[str] = ["lms", "coach", "simulator", "certification", "second-brain"]

PHASE: dict[str, str] = {
    "lms": "cognitive",
    "coach": "practice",
    "simulator": "practice",
    "certification": "validation",
    "second-brain": "excellence",
}

LABEL: dict[str, str] = {
    "lms": "LMS",
    "coach": "Master Coach",
    "simulator": "Practice Simulator",
    "certification": "Certification",
    "second-brain": "Second Brain",
}

_CANONICAL_SET = set(CANONICAL_ORDER)

# rolplay_app_sql's r_simulator.category -> canonical module. Single source of
# truth for both schema_discovery.py (which modules a tenant has) and
# preview_fetch.py (the journey widget's per-module query) — previously
# duplicated as schema_discovery.py's own private _CATEGORY_TO_MODULE; kept
# here instead so the two can never drift apart. 'SB' (Second Brain) and
# anything else unmapped are deliberately excluded — Second Brain has its own
# dedicated, token-authenticated API and must never be double-counted through
# this one (see lib/bridge-rolplay-app.ts's matching note).
CATEGORY_TO_MODULE: dict[str, str] = {"COACH": "coach", "SIM": "simulator", "SEGMENT": "certification"}

# Reverse of the above — used to scope a per-module page's queries down to
# just that module's sessions (e.g. dashboard_planning.py's per-module pages,
# fetched via preview_fetch.py's _category_clause()).
MODULE_TO_CATEGORY: dict[str, str] = {v: k for k, v in CATEGORY_TO_MODULE.items()}


def is_canonical(modules: list[str]) -> bool:
    """True only if EVERY discovered module is a verified canonical name —
    not a majority, not a guess. One unrecognized string means the source
    isn't classifying modules the same way this ontology does, and forcing
    it in would silently misrepresent that module's real identity."""
    return bool(modules) and all(m in _CANONICAL_SET for m in modules)


def ordered_stages(modules: list[str]) -> list[str]:
    """The tenant's canonical modules, in fixed journey order — mirrors
    lib/journey.ts's journeyStages(): filters CANONICAL_ORDER by what's
    present, never sorts or reorders by the input's own order."""
    have = set(modules)
    return [m for m in CANONICAL_ORDER if m in have]


def has_journey(modules: list[str]) -> bool:
    """A journey needs >=2 stages to show a progression — mirrors
    lib/journey.ts's hasJourney()."""
    return is_canonical(modules) and len(ordered_stages(modules)) >= 2
