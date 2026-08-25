"""Dashboard Builder LLM model/thinking-level configurability.

Reported directly: the manager wants the Gemini model used by the Dashboard
Builder to be a "thinking" tier, chosen via env config, separate from Robin
AI's own fast-tier model (lib/ai.ts's ROBIN_AI_MODEL, a Next.js-side setting
-- these two agents are in different services and were already independent
here; app/config.py's Settings already reads LLM_MODEL/LLM_THINKING_LEVEL
from the environment (pydantic-settings), this locks that in with a test and
confirms gemini_json actually embeds both in the real request it sends.
"""
import asyncio
import unittest
from unittest.mock import AsyncMock, patch

import httpx

from app.config import Settings, get_settings


def _run(coro):
    return asyncio.run(coro)


class LlmConfigEnvTests(unittest.TestCase):
    def test_llm_model_and_thinking_level_are_read_from_the_environment(self):
        s = Settings(llm_model="gemini-3.1-pro-preview", llm_thinking_level="high")
        self.assertEqual(s.llm_model, "gemini-3.1-pro-preview")
        self.assertEqual(s.llm_thinking_level, "high")

    def test_defaults_are_a_real_model_and_a_valid_thinking_level_when_unset(self):
        s = Settings()
        self.assertTrue(s.llm_model)
        self.assertIn(s.llm_thinking_level, {"minimal", "low", "medium", "high"})


class GeminiJsonRequestShapeTests(unittest.TestCase):
    """gemini_json (app/llm.py) must actually SEND the configured model/
    thinking level in the real HTTP request -- a config value that's read but
    never forwarded would be just as broken as a hardcoded one."""

    def setUp(self):
        get_settings.cache_clear()

    def tearDown(self):
        get_settings.cache_clear()

    def test_embeds_the_configured_model_in_the_request_url_and_thinking_level_in_the_body(self):
        from app import llm

        captured = {}

        class FakeResponse:
            status_code = 200
            def json(self):
                return {"candidates": [{"content": {"parts": [{"text": "{}"}]}}]}

        async def fake_post(self, url, params=None, json=None, **kwargs):
            captured["url"] = url
            captured["body"] = json
            return FakeResponse()

        fake_settings = Settings(gemini_api_key="test-key", llm_model="gemini-3.1-pro-preview", llm_thinking_level="high")
        with patch.object(llm, "get_settings", return_value=fake_settings), \
             patch.object(httpx.AsyncClient, "post", new=fake_post):
            result = _run(llm.gemini_json("system", "user"))

        self.assertIsNotNone(result)
        self.assertIn("/models/gemini-3.1-pro-preview:generateContent", captured["url"])
        self.assertEqual(captured["body"]["generationConfig"]["thinkingConfig"]["thinkingLevel"], "high")

    def test_returns_none_without_ever_calling_gemini_when_no_api_key_is_set(self):
        from app import llm

        fake_settings = Settings(gemini_api_key=None)
        with patch.object(llm, "get_settings", return_value=fake_settings), \
             patch.object(httpx.AsyncClient, "post", new=AsyncMock(side_effect=AssertionError("must not call Gemini"))):
            result = _run(llm.gemini_json("system", "user"))
        self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
