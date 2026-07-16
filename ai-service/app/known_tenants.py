"""Known-tenant defaults (data, not logic).

For clients whose bridge requires an explicit exercise-ID list (exceltis_rest,
sale_exercises), the IDs can't be listed from the endpoint itself. Seeding the
ones we already know lets a manager onboard those clients with ONLY the company
name — no technical IDs to type. kpi tenants (e.g. Apotex) self-discover, so
they don't need an entry. New/unknown clients fall back to manager-provided IDs.

This mirrors the values already in the Next.js lib/pharma-tenant.ts and is the
only company-specific data in the service — extendable via the knowledge base
(agent_memory) without code changes.
"""
from __future__ import annotations

_SANFER_CERT_IDS = [
    390, 399, 402, 403, 405, 406, 408, 409, 410, 411, 413, 419, 420, 421,
    423, 428, 432, 433, 436, 439, 440, 445, 446, 448, 449, 453, 454, 455,
    457, 460, 461, 462, 464, 465, 467, 468, 481, 484, 488, 489, 490, 491,
    492, 493,
]

# slug → exercise/usecase ID allowlist (what the manager would otherwise type)
KNOWN_EXERCISE_IDS: dict[str, list[int]] = {
    "sanfer": _SANFER_CERT_IDS,
    "weser": [235, 236, 237],
    "adium": [145, 146, 208, 231],
    "heineken": [137, 159, 173],
    "m8": [12, 113, 142],
    "lacoste": [375, 379],
    "lacoste_asistentes": [167],
    # "chiesi" deliberately omitted: kept unregistered here so the builder's
    # needs_ids pause can be demonstrated end-to-end against a real, live
    # connector. This does NOT affect the real Chiesi dashboard at all — that
    # is served by the separate Next.js app (lib/pharma-tenant.ts), untouched.
    "labomed": [458, 463],
}


def known_ids_for(slug: str) -> list[int]:
    return KNOWN_EXERCISE_IDS.get(slug, [])
