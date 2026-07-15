"""Gemini LLM client (async, JSON-first) with a hard safety contract.

Design rules:
  - Provider is Google Gemini (gemini-3-flash-preview by default).
  - Every call returns parsed JSON or **None**. None means "LLM unavailable or
    unsure" → the caller MUST fall back to its deterministic heuristic. The
    pipeline therefore never breaks and never blocks on the model.
  - The LLM only ever *reorganizes/labels* data the deterministic agents already
    discovered. Callers enforce that any metric/dimension the LLM references
    actually exists — so the model can never invent data or endpoints.
"""
from __future__ import annotations

import json
from typing import Any

import httpx

from .config import get_settings


def llm_available() -> bool:
    return bool(get_settings().gemini_api_key)


async def gemini_json(system: str, user: str) -> Any | None:
    """Call Gemini and parse a JSON object/array from the response, or None."""
    s = get_settings()
    if not s.gemini_api_key:
        return None
    url = f"{s.gemini_base_url.rstrip('/')}/models/{s.llm_model}:generateContent"
    body = {
        "systemInstruction": {"parts": [{"text": system}]},
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.2,
            "thinkingConfig": {"thinkingLevel": s.llm_thinking_level},
        },
    }
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(45.0)) as client:
            resp = await client.post(url, params={"key": s.gemini_api_key}, json=body)
            if resp.status_code != 200:
                # Retry once without thinkingConfig (older/other model variants reject it).
                body["generationConfig"].pop("thinkingConfig", None)
                resp = await client.post(url, params={"key": s.gemini_api_key}, json=body)
                if resp.status_code != 200:
                    return None
            data = resp.json()
            parts = data["candidates"][0]["content"]["parts"]
            text = "".join(p.get("text", "") for p in parts).strip()
            return _loads(text)
    except Exception:
        return None


def _loads(text: str) -> Any | None:
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        # tolerate ```json fences or trailing prose
        t = text.strip().removeprefix("```json").removeprefix("```").removesuffix("```").strip()
        start = min((i for i in (t.find("{"), t.find("[")) if i >= 0), default=-1)
        if start < 0:
            return None
        try:
            return json.loads(t[start:])
        except Exception:
            return None
