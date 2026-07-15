"""Agent 2 — Company Discovery.

Given only a company name, return what we already know (reusing the knowledge
base so we don't rediscover every time) or a fresh best-guess starting point.
"""
from __future__ import annotations

from ..knowledge import get_knowledge
from ..models import CompanyKnowledge
from ..util import candidate_slugs, guess_domains
from .base import LogFn


async def run(company: str, exercise_ids: list[int], log: LogFn) -> CompanyKnowledge:
    for slug in candidate_slugs(company):
        cached = await get_knowledge(slug)
        if cached and any(s.alive for s in cached.services):
            await log("company_discovery", "success", f"Reusing known company '{cached.company}' ({slug}) from memory")
            cached.source = "cache"
            if exercise_ids:
                cached.exercise_ids = sorted(set(cached.exercise_ids) | set(exercise_ids))
            return cached

    slug = candidate_slugs(company)[0]
    domains = guess_domains(company, slug)
    await log("company_discovery", "info", f"New company '{company}' → slug candidates {candidate_slugs(company)}, domains {domains[:2]}…")
    return CompanyKnowledge(
        company=company, slug=slug, domains=domains,
        exercise_ids=sorted(set(exercise_ids)), source="fresh",
    )
