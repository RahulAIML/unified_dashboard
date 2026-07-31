"""Regression tests for app/tenant_credentials.py — a port of
lib/tenant-credentials.ts's DB-first, env-fallback resolution. The critical
invariant carried over from the TS version: a named tenant NEVER falls back
to a bare shared env var (that would leak one tenant's credential to every
other tenant with no per-tenant configuration) -- only tenantKey=None may use
the shared fallback.
"""
import base64
import os
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

from app import tenant_credentials as tc
from app.config import get_settings


def _run(coro):
    import asyncio
    return asyncio.run(coro)


def _encrypted_row(field: str, value: str, key_b64: str) -> dict:
    raw_key = base64.b64decode(key_b64)
    iv = os.urandom(12)
    ct = AESGCM(raw_key).encrypt(iv, value.encode(), None)
    ciphertext, tag = ct[:-16], ct[-16:]
    payload = ":".join([
        "v1", base64.b64encode(iv).decode(), base64.b64encode(tag).decode(),
        base64.b64encode(ciphertext).decode(),
    ])
    return {"field": field, "value_encrypted": payload}


class EnvOnlyResolutionTests(unittest.TestCase):
    """No DB configured (no pool) -- exercises the env-fallback branch alone."""

    def setUp(self):
        self._patcher = patch("app.db.get_pool", new=AsyncMock(return_value=None))
        self._patcher.start()

    def tearDown(self):
        self._patcher.stop()
        for k in list(os.environ):
            if k.startswith("LMS_"):
                os.environ.pop(k)

    def test_resolves_a_tenant_scoped_env_var(self):
        os.environ["LMS_APOTEX_API_URL"] = "https://academiaapotex.learnworlds.com"
        bundle = _run(tc.resolve_tenant_credentials("apotex", "lms", "LMS", ["api_url", "client_id"]))
        self.assertEqual(bundle["api_url"], "https://academiaapotex.learnworlds.com")
        self.assertNotIn("client_id", bundle)

    def test_sanitizes_non_alphanumeric_tenant_keys_for_the_env_var_name(self):
        os.environ["LMS_APOTEX_MX_API_URL"] = "https://x.learnworlds.com"
        bundle = _run(tc.resolve_tenant_credentials("apotex-mx", "lms", "LMS", ["api_url"]))
        self.assertEqual(bundle["api_url"], "https://x.learnworlds.com")

    def test_never_falls_back_to_a_shared_var_for_a_named_tenant(self):
        # The critical isolation guarantee: a bare LMS_API_URL must NEVER leak
        # to a tenant that has no LMS_<TENANT>_API_URL of its own.
        os.environ["LMS_API_URL"] = "https://shared-school.learnworlds.com"
        bundle = _run(tc.resolve_tenant_credentials("apotex", "lms", "LMS", ["api_url"]))
        self.assertNotIn("api_url", bundle)

    def test_shared_fallback_applies_only_when_tenant_key_is_none(self):
        os.environ["LMS_API_URL"] = "https://shared-school.learnworlds.com"
        bundle = _run(tc.resolve_tenant_credentials(None, "lms", "LMS", ["api_url"]))
        self.assertEqual(bundle["api_url"], "https://shared-school.learnworlds.com")


class DbResolutionTests(unittest.TestCase):
    KEY = "rRaSpWO//YWIb6hvgJEfvHYavL9a45I/sjvYfItJE7w="

    def setUp(self):
        os.environ["SECRET_ENCRYPTION_KEY"] = self.KEY
        get_settings.cache_clear()

    def tearDown(self):
        os.environ.pop("SECRET_ENCRYPTION_KEY", None)
        get_settings.cache_clear()
        for k in list(os.environ):
            if k.startswith("LMS_"):
                os.environ.pop(k)

    def test_reads_and_decrypts_db_rows(self):
        pool = MagicMock()
        pool.fetch = AsyncMock(return_value=[
            _encrypted_row("api_url", "https://academiaapotex.learnworlds.com", self.KEY),
        ])
        with patch("app.db.get_pool", new=AsyncMock(return_value=pool)):
            bundle = _run(tc.resolve_tenant_credentials("apotex", "lms", "LMS", ["api_url", "client_id"]))
        self.assertEqual(bundle["api_url"], "https://academiaapotex.learnworlds.com")

    def test_db_field_wins_over_env_when_both_present(self):
        os.environ["LMS_APOTEX_API_URL"] = "https://env-should-lose.learnworlds.com"
        pool = MagicMock()
        pool.fetch = AsyncMock(return_value=[
            _encrypted_row("api_url", "https://db-should-win.learnworlds.com", self.KEY),
        ])
        with patch("app.db.get_pool", new=AsyncMock(return_value=pool)):
            bundle = _run(tc.resolve_tenant_credentials("apotex", "lms", "LMS", ["api_url"]))
        self.assertEqual(bundle["api_url"], "https://db-should-win.learnworlds.com")

    def test_env_fills_in_a_field_missing_from_the_db(self):
        os.environ["LMS_APOTEX_CLIENT_ID"] = "client-from-env"
        pool = MagicMock()
        pool.fetch = AsyncMock(return_value=[
            _encrypted_row("api_url", "https://db.learnworlds.com", self.KEY),
        ])
        with patch("app.db.get_pool", new=AsyncMock(return_value=pool)):
            bundle = _run(tc.resolve_tenant_credentials("apotex", "lms", "LMS", ["api_url", "client_id"]))
        self.assertEqual(bundle["api_url"], "https://db.learnworlds.com")
        self.assertEqual(bundle["client_id"], "client-from-env")

    def test_a_decryption_failure_warns_and_skips_the_field_rather_than_crashing(self):
        pool = MagicMock()
        pool.fetch = AsyncMock(return_value=[
            {"field": "api_url", "value_encrypted": "v1:Z2FyYmFnZQ==:Z2FyYmFnZWdhcmJhZ2U=:Z2FyYmFnZQ=="},
        ])
        warnings = []

        async def warn(msg):
            warnings.append(msg)

        with patch("app.db.get_pool", new=AsyncMock(return_value=pool)):
            bundle = _run(tc.resolve_tenant_credentials("apotex", "lms", "LMS", ["api_url"], warn=warn))
        self.assertNotIn("api_url", bundle)
        self.assertEqual(len(warnings), 1)
        self.assertIn("DECRYPT FAILED", warnings[0])

    def test_returns_empty_bundle_when_no_encryption_key_configured(self):
        os.environ.pop("SECRET_ENCRYPTION_KEY", None)
        get_settings.cache_clear()
        pool = MagicMock()
        pool.fetch = AsyncMock(return_value=[])
        with patch("app.db.get_pool", new=AsyncMock(return_value=pool)):
            bundle = _run(tc.resolve_tenant_credentials("apotex", "lms", "LMS", ["api_url"]))
        self.assertEqual(bundle, {})
        pool.fetch.assert_not_called()

    def test_returns_empty_bundle_when_table_does_not_exist_yet(self):
        pool = MagicMock()
        pool.fetch = AsyncMock(side_effect=Exception('relation "tenant_credentials" does not exist'))
        with patch("app.db.get_pool", new=AsyncMock(return_value=pool)):
            bundle = _run(tc.resolve_tenant_credentials("apotex", "lms", "LMS", ["api_url"]))
        self.assertEqual(bundle, {})


if __name__ == "__main__":
    unittest.main()
