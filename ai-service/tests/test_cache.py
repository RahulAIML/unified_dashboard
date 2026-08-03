"""Tests for app/cache.py — Redis-backed cache with an in-process fallback
(ROADMAP Phase 6's Redis blocker). Exercises the in-process fallback path
(no REDIS_URL configured, matching a real dev/CI environment) -- mirrors
lib/cache.ts's test coverage on the Node side exactly.
"""
import asyncio
import unittest

from app import cache
from app.config import get_settings


def _run(coro):
    return asyncio.run(coro)


class InProcessFallbackTests(unittest.TestCase):
    def setUp(self):
        # cache.py's connection-attempt state is module-global -- reset it
        # per test so one test's monkeypatching never leaks into the next.
        cache._redis_client = None
        cache._redis_attempted = False
        cache._memory_store.clear()
        get_settings.cache_clear()

    def tearDown(self):
        cache._redis_client = None
        cache._redis_attempted = False
        cache._memory_store.clear()
        get_settings.cache_clear()

    def test_returns_none_for_a_key_never_set(self):
        self.assertIsNone(_run(cache.cache_get("nope")))

    def test_returns_the_value_that_was_set(self):
        _run(cache.cache_set("k1", {"a": 1}, 60))
        self.assertEqual(_run(cache.cache_get("k1")), {"a": 1})

    def test_expires_after_its_ttl(self):
        _run(cache.cache_set("k2", "value", 1))
        self.assertEqual(_run(cache.cache_get("k2")), "value")
        # Force the stored entry into the past rather than sleeping or
        # patching the real time.monotonic (asyncio's own internals call it
        # too -- globally patching it destabilizes the event loop).
        expires_at, value = cache._memory_store["k2"]
        cache._memory_store["k2"] = (expires_at - 1000, value)
        self.assertIsNone(_run(cache.cache_get("k2")))

    def test_get_or_set_calls_fn_only_once_for_a_fresh_cache(self):
        calls = {"n": 0}

        async def fn():
            calls["n"] += 1
            return "computed"

        first = _run(cache.get_or_set("k3", 60, fn))
        second = _run(cache.get_or_set("k3", 60, fn))

        self.assertEqual(first, "computed")
        self.assertEqual(second, "computed")
        self.assertEqual(calls["n"], 1)

    def test_different_keys_never_collide(self):
        _run(cache.cache_set("a", 1, 60))
        _run(cache.cache_set("b", 2, 60))
        self.assertEqual(_run(cache.cache_get("a")), 1)
        self.assertEqual(_run(cache.cache_get("b")), 2)

    def test_no_redis_url_never_attempts_a_connection(self):
        """Settings default redis_url to None -- _get_redis must short-circuit
        to the memory store without ever touching the redis package."""
        result = _run(cache._get_redis())
        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
