"""Optional Postgres pool (reuses the Next.js auth DB; adds new tables only).

If AUTH_DATABASE_URL is unset the service runs fully in-memory — discovery,
generation and preview all work; only cross-restart persistence is skipped.
"""
from __future__ import annotations

import asyncpg

from .config import get_settings

_pool: asyncpg.Pool | None = None
_tried = False


async def get_pool() -> asyncpg.Pool | None:
    global _pool, _tried
    if _pool is not None:
        return _pool
    if _tried:
        return None
    _tried = True
    url = get_settings().auth_database_url
    if not url:
        return None
    try:
        _pool = await asyncpg.create_pool(dsn=url, min_size=1, max_size=4, ssl="require")
        await _ensure_schema(_pool)
        return _pool
    except Exception:
        _pool = None
        return None


async def _ensure_schema(pool: asyncpg.Pool) -> None:
    await pool.execute(
        """
        CREATE TABLE IF NOT EXISTS agent_memory (
          slug        TEXT PRIMARY KEY,
          company     TEXT NOT NULL,
          payload     JSONB NOT NULL,
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS dashboard_metadata (
          slug        TEXT PRIMARY KEY,
          company     TEXT NOT NULL,
          config      JSONB NOT NULL,
          version     INT NOT NULL DEFAULT 1,
          published   BOOLEAN NOT NULL DEFAULT FALSE,
          updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS dashboard_versions (
          id          SERIAL PRIMARY KEY,
          slug        TEXT NOT NULL,
          version     INT NOT NULL,
          config      JSONB NOT NULL,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS discovery_logs (
          id          SERIAL PRIMARY KEY,
          slug        TEXT NOT NULL,
          job_id      TEXT,
          payload     JSONB NOT NULL,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        CREATE TABLE IF NOT EXISTS validation_reports (
          id          SERIAL PRIMARY KEY,
          slug        TEXT NOT NULL,
          job_id      TEXT,
          report      JSONB NOT NULL,
          created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        """
    )
