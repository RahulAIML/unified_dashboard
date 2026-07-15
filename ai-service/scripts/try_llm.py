"""Gemini smoke-test. Run AFTER adding GEMINI_API_KEY to ai-service/.env:
   ./.venv/Scripts/python scripts/try_llm.py
Confirms the key works and JSON parsing is correct — no secret is printed.
"""
import asyncio
import sys

sys.path.insert(0, ".")

from app.config import get_settings
from app.llm import gemini_json, llm_available


async def main():
    s = get_settings()
    print(f"llm_available: {llm_available()}   model: {s.llm_model}   thinking: {s.llm_thinking_level}")
    if not llm_available():
        print("→ No GEMINI_API_KEY in ai-service/.env — add it and re-run.")
        return
    out = await gemini_json(
        system="You return strict JSON only.",
        user='Return {"ok": true, "widgets": ["sessions","score","pass_rate"], "note": "one short sentence"}',
    )
    print("Gemini JSON response:", out)
    print("PASS ✓" if isinstance(out, dict) and out.get("ok") else "FAIL ✗ (check key/model/network)")


if __name__ == "__main__":
    asyncio.run(main())
