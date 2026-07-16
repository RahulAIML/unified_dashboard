"""Company knowledge base.

In-memory for fast local dev; persisted to Postgres (agent_memory table) when a
DB is configured. The AI gets smarter over time because a company's discovered
services/schema/ids are stored and reused instead of rediscovered every run.
"""
from __future__ import annotations

import json

from .db import get_pool
from .models import CompanyKnowledge

_MEM: dict[str, CompanyKnowledge] = {}


async def get_knowledge(slug: str) -> CompanyKnowledge | None:
    if slug in _MEM:
        return _MEM[slug].model_copy(deep=True)
    pool = await get_pool()
    if pool:
        row = await pool.fetchrow("SELECT payload FROM agent_memory WHERE slug = $1", slug)
        if row:
            k = CompanyKnowledge.model_validate(json.loads(row["payload"]))
            _MEM[slug] = k
            return k.model_copy(deep=True)
    return None


async def put_knowledge(k: CompanyKnowledge) -> None:
    _MEM[k.slug] = k.model_copy(deep=True)
    pool = await get_pool()
    if pool:
        await pool.execute(
            """INSERT INTO agent_memory (slug, company, payload, updated_at)
               VALUES ($1, $2, $3::jsonb, NOW())
               ON CONFLICT (slug) DO UPDATE SET company=EXCLUDED.company,
                 payload=EXCLUDED.payload, updated_at=NOW()""",
            k.slug, k.company, k.model_dump_json(),
        )


async def delete_knowledge(slug: str) -> None:
    """Drop a company's cached discovery (memory + DB) so the next run re-probes
    everything from scratch — for correcting a stale/wrong cached entry."""
    _MEM.pop(slug, None)
    pool = await get_pool()
    if pool:
        await pool.execute("DELETE FROM agent_memory WHERE slug = $1", slug)
