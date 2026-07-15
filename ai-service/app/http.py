"""Thin async HTTP helpers shared by all connectors."""
from __future__ import annotations

from typing import Any

import httpx

from .config import get_settings


def _timeout() -> httpx.Timeout:
    return httpx.Timeout(get_settings().http_timeout_seconds)


async def post_json(url: str, body: dict[str, Any], headers: dict[str, str] | None = None) -> tuple[int, Any]:
    """POST JSON; returns (status_code, parsed_json_or_text). Never raises on HTTP errors."""
    try:
        async with httpx.AsyncClient(timeout=_timeout()) as client:
            resp = await client.post(url, json=body, headers=headers or {})
            return resp.status_code, _parse(resp)
    except Exception as exc:  # network/timeout — report as status 0
        return 0, {"__error": str(exc)[:200]}


async def get_json(url: str, headers: dict[str, str] | None = None) -> tuple[int, Any]:
    try:
        async with httpx.AsyncClient(timeout=_timeout()) as client:
            resp = await client.get(url, headers=headers or {})
            return resp.status_code, _parse(resp)
    except Exception as exc:
        return 0, {"__error": str(exc)[:200]}


def _parse(resp: httpx.Response) -> Any:
    ctype = resp.headers.get("content-type", "")
    if "json" in ctype:
        try:
            return resp.json()
        except Exception:
            return resp.text
    # Some bridges return JSON with a text/html content-type — try anyway.
    try:
        return resp.json()
    except Exception:
        return resp.text
