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
    return bool((get_settings().gemini_api_key or "").strip())


def _extract_response_text(payload: Any) -> str:
    if not isinstance(payload, dict):
        return ""
    candidates = payload.get("candidates") or []
    if not isinstance(candidates, list) or not candidates:
        return ""
    first = candidates[0]
    if not isinstance(first, dict):
        return ""
    content = first.get("content") or {}
    parts = content.get("parts") or []
    if not isinstance(parts, list):
        return ""

    chunks: list[str] = []
    for part in parts:
        if not isinstance(part, dict):
            continue
        text = part.get("text")
        if isinstance(text, str) and text.strip():
            chunks.append(text)
    return "".join(chunks).strip()


async def gemini_json(system: str, user: str) -> Any | None:
    """Call Gemini and parse a JSON object/array from the response, or None."""
    s = get_settings()
    api_key = (s.gemini_api_key or "").strip()
    if not api_key:
        return None

    base_url = (s.gemini_base_url or "").rstrip("/")
    model = (s.llm_model or "").strip()
    if not base_url or not model:
        return None

    url = f"{base_url}/models/{model}:generateContent"
    body: dict[str, Any] = {
        "contents": [{"role": "user", "parts": [{"text": user}]}],
        "generationConfig": {
            "responseMimeType": "application/json",
            "temperature": 0.2,
        },
    }
    if system and system.strip():
        body["systemInstruction"] = {"parts": [{"text": system.strip()}]}
    if s.llm_thinking_level:
        body["generationConfig"]["thinkingConfig"] = {"thinkingLevel": s.llm_thinking_level}

    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(float(getattr(s, "http_timeout_seconds", 45.0) or 45.0)), follow_redirects=True) as client:
            resp = await client.post(url, params={"key": api_key}, json=body)
            if resp.status_code != 200:
                # Retry once without thinkingConfig because some older/alternate
                # Gemini variants reject the field even though the config is valid.
                body["generationConfig"].pop("thinkingConfig", None)
                resp = await client.post(url, params={"key": api_key}, json=body)
                if resp.status_code != 200:
                    return None
            data = resp.json()
            text = _extract_response_text(data)
            if not text:
                return None
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
