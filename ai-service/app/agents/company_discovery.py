"""Agent 2 — Company Discovery.

Given only a company name, return what we already know (reusing the knowledge
base so we don't rediscover every time) or a fresh best-guess starting point.
"""
from __future__ import annotations

from ..knowledge import get_knowledge
from ..models import CompanyKnowledge
from ..util import candidate_slugs, guess_domains
from .base import LogFn


def _clean_domains(domains: list[str]) -> list[str]:
    """Normalize manager-typed domains: strip scheme/@, lowercase, dedupe."""
    out: list[str] = []
    for d in domains:
        d = (d or "").strip().lower().lstrip("@")
        d = d.removeprefix("http://").removeprefix("https://").split("/")[0]
        if d and d not in out:
            out.append(d)
    return out


async def run(company: str, exercise_ids: list[int], log: LogFn, domains: list[str] | None = None) -> CompanyKnowledge:
    provided = _clean_domains(domains or [])
    for slug in candidate_slugs(company):
        cached = await get_knowledge(slug)
        if cached and any(s.alive for s in cached.services):
            await log("company_discovery", "success", f"Reusing known company '{cached.company}' ({slug}) from memory")
            cached.source = "cache"
            if exercise_ids:
                cached.exercise_ids = sorted(set(cached.exercise_ids) | set(exercise_ids))
            # A manager-provided domain always wins for login routing, even on a
            # cache hit — put it first, keep the rest as fallbacks.
            if provided:
                cached.domains = provided + [d for d in cached.domains if d not in provided]
            return cached

    slug = candidate_slugs(company)[0]
    # Manager-provided domains take priority over the name-based guess.
    domains_out = provided + [d for d in guess_domains(company, slug) if d not in provided]
    await log("company_discovery", "info", f"New company '{company}' → slug candidates {candidate_slugs(company)}, domains {domains_out[:2]}…")
    return CompanyKnowledge(
        company=company, slug=slug, domains=domains_out,
        exercise_ids=sorted(set(exercise_ids)), source="fresh",
    )
