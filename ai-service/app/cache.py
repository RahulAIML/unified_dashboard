"""Shared cache layer -- Redis-backed when settings.redis_url is configured,
an in-process dict otherwise, so callers work identically in both
environments and nothing crashes if Redis is unset or briefly unreachable.

Mirrors lib/cache.ts's design exactly (same get-or-set contract, same
graceful-degrade behavior) -- see that file's docstring for the full
rationale: a horizontally-scaled deploy has one cache per instance without
this, so an expensive, repeatedly-hit computation (here: /ai/render/{slug}'s
preview.run(), which re-executes every widget's live query) re-pays its full
cost once per instance instead of once total.
"""
from __future__ import annotations

import json
import time
from typing import Any, Awaitable, Callable, TypeVar

from .config import get_settings

T = TypeVar("T")

# `_redis_client` states: unset (None) = not yet attempted OR attempted and
# unavailable -- `_redis_attempted` distinguishes the two so a failed connect
# is not retried on every single cache call.
_redis_client: Any = None
_redis_attempted = False

_memory_store: dict[str, tuple[float, str]] = {}  # key -> (expires_at_monotonic, json_value)


async def _get_redis() -> Any:
    global _redis_client, _redis_attempted
    if _redis_attempted:
        return _redis_client
    _redis_attempted = True
    url = get_settings().redis_url
    if not url:
        return None
    try:
        import redis.asyncio as redis_asyncio  # optional dependency; see requirements.txt
        client = redis_asyncio.from_url(url, decode_responses=True, socket_connect_timeout=2)
        await client.ping()
        _redis_client = client
    except Exception:
        _redis_client = None
    return _redis_client


def _memory_get(key: str) -> str | None:
    hit = _memory_store.get(key)
    if not hit:
        return None
    expires_at, value = hit
    if expires_at < time.monotonic():
        _memory_store.pop(key, None)
        return None
    return value


def _memory_set(key: str, value: str, ttl_seconds: int) -> None:
    _memory_store[key] = (time.monotonic() + ttl_seconds, value)


async def cache_get(key: str) -> Any | None:
    client = await _get_redis()
    if client is not None:
        try:
            raw = await client.get(key)
            return json.loads(raw) if raw is not None else None
        except Exception:
            pass  # transient Redis failure -- fall through to the memory store
    raw = _memory_get(key)
    return json.loads(raw) if raw is not None else None


async def cache_set(key: str, value: Any, ttl_seconds: int) -> None:
    serialized = json.dumps(value)
    client = await _get_redis()
    if client is not None:
        try:
            await client.set(key, serialized, ex=max(1, int(ttl_seconds)))
            return
        except Exception:
            pass  # fall through to memory
    _memory_set(key, serialized, ttl_seconds)


async def get_or_set(key: str, ttl_seconds: int, fn: Callable[[], Awaitable[T]]) -> T:
    """Returns the cached JSON-serializable value for `key` if fresh,
    otherwise calls fn(), caches the result, and returns it."""
    cached = await cache_get(key)
    if cached is not None:
        return cached
    value = await fn()
    await cache_set(key, value, ttl_seconds)
    return value
