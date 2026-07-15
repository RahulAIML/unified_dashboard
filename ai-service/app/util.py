"""Small shared helpers."""
from __future__ import annotations

import re


def slugify(name: str) -> str:
    s = name.strip().lower()
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s or "client"


# A few real Rolplay aliases where the display name != bridge slug. This is the
# ONLY place company-specific hints live, and it's data, not logic — extendable
# via the knowledge base without touching agents.
KNOWN_SLUG_ALIASES: dict[str, str] = {
    "m8": "m8",
    "m8-arcera": "m8",
    "lacoste-asistentes": "lacoste_asistentes",
}


def candidate_slugs(company: str) -> list[str]:
    base = slugify(company)
    out = [base]
    if base in KNOWN_SLUG_ALIASES:
        out.insert(0, KNOWN_SLUG_ALIASES[base])
    # first word (e.g. "Acme Pharma" -> "acme")
    first = base.split("-")[0]
    if first and first not in out:
        out.append(first)
    return out


def guess_domains(company: str, slug: str) -> list[str]:
    first = slug.split("-")[0]
    return list(dict.fromkeys([f"{slug}.com", f"{first}.com", f"{slug}.com.mx", f"{first}.com.mx"]))
