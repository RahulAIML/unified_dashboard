"""ai-service/app/branding_lookup.py -- read-only side of wiring AI-generated
dashboard branding to a tenant's real saved colors instead of one hardcoded
default for every company (dashboard_config.py previously always set
branding={"primary_color": "#DC2626"}). Reads the SAME branding_settings
table/key-scheme (domain:<domain>) the Next.js app's PUT /api/admin/tenant-branding
writes and its own per-user fallback already reads.
"""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.branding_lookup import lookup_tenant_branding


def _run(coro):
    return asyncio.run(coro)


class _FakePool:
    def __init__(self, rows: dict[str, dict]):
        self._rows = rows

    async def fetchrow(self, sql, key):
        return self._rows.get(key)


class BrandingLookupTests(unittest.TestCase):
    def test_returns_none_when_no_pool(self):
        with patch("app.db.get_pool", new=AsyncMock(return_value=None)):
            self.assertIsNone(_run(lookup_tenant_branding(["apotex.com"])))

    def test_returns_none_when_no_domains_given(self):
        pool = _FakePool({})
        with patch("app.db.get_pool", new=AsyncMock(return_value=pool)):
            self.assertIsNone(_run(lookup_tenant_branding([])))

    def test_returns_the_saved_row_for_a_matching_domain(self):
        pool = _FakePool({"domain:apotex.com": {
            "logo_url": "/apotex-logo.png", "primary_color": "#123456",
            "secondary_color": "#000000", "accent_color": "#ffffff",
        }})
        with patch("app.db.get_pool", new=AsyncMock(return_value=pool)):
            result = _run(lookup_tenant_branding(["apotex.com"]))
        self.assertEqual(result["primary_color"], "#123456")

    def test_domain_lookup_is_case_insensitive(self):
        pool = _FakePool({"domain:apotex.com": {
            "logo_url": None, "primary_color": "#123456",
            "secondary_color": None, "accent_color": None,
        }})
        with patch("app.db.get_pool", new=AsyncMock(return_value=pool)):
            result = _run(lookup_tenant_branding(["Apotex.COM"]))
        self.assertEqual(result["primary_color"], "#123456")

    def test_none_when_no_row_for_any_domain(self):
        pool = _FakePool({})
        with patch("app.db.get_pool", new=AsyncMock(return_value=pool)):
            self.assertIsNone(_run(lookup_tenant_branding(["nobody.test"])))

    def test_falls_back_to_the_next_domain_when_the_first_has_no_row(self):
        pool = _FakePool({"domain:secondary.test": {
            "logo_url": None, "primary_color": "#abcdef",
            "secondary_color": None, "accent_color": None,
        }})
        with patch("app.db.get_pool", new=AsyncMock(return_value=pool)):
            result = _run(lookup_tenant_branding(["primary.test", "secondary.test"]))
        self.assertEqual(result["primary_color"], "#abcdef")

    def test_a_db_error_is_swallowed_not_raised(self):
        class ExplodingPool:
            async def fetchrow(self, sql, key):
                raise RuntimeError("relation branding_settings does not exist")

        with patch("app.db.get_pool", new=AsyncMock(return_value=ExplodingPool())):
            self.assertIsNone(_run(lookup_tenant_branding(["apotex.com"])))


if __name__ == "__main__":
    unittest.main()
