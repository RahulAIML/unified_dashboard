import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from app.agents import publish
from app.models import DashboardConfig, ServiceKind


class PublishFallbackTests(unittest.TestCase):
    def test_publish_returns_true_without_database(self) -> None:
        cfg = DashboardConfig(
            company="Acme",
            slug="acme",
            title="Acme Dashboard",
            connector=ServiceKind.rolplay_app_sql,
        )

        async def _run() -> bool:
            async def _log(*_args):
                return None

            with patch("app.agents.publish.get_pool", new=AsyncMock(return_value=None)):
                return await publish.run(cfg, [], _log)

        self.assertTrue(asyncio.run(_run()))


if __name__ == "__main__":
    unittest.main()
