"""Python port of lib/lms-learnworlds.ts — the LMS connector (LearnWorlds).

WHY THIS EXISTS AS ITS OWN MODULE, INDEPENDENT OF ANY ServiceKind CONNECTOR
An LMS measures *course progress* (enrolled/completed/in-progress, graded
quiz scores) — a completely different data source from a Simulator/Coach
session (a scored practice conversation). The real Next.js app gates LMS
purely on credential presence, NEVER on which analytics connector (pharma_kpi
/ rolplay_app_sql / coach_app_sql) a tenant uses — a pharma tenant and a
rolplay-app tenant can each independently have their own LearnWorlds school.
This module mirrors that: it is called as an ADDITIONAL, independent probe
during discovery, never as part of any connector's own schema.

API SHAPE — verified against the live TypeScript version's own verified shape
(lib/lms-learnworlds.ts's header comment), not re-derived:
  GET /admin/api/v2/courses                 -> { data[{id, title, ...}], meta }
  GET /admin/api/v2/users                    -> { data[{id, ...}], meta }
  GET /admin/api/v2/users/{userId}/progress  -> { data[progress row], meta }
A progress row: { course_id, status, progress_rate, average_score_rate,
completed_units, total_units, completed_at }. status in
{completed, not_started, not_completed}; completed_at is unix SECONDS.

CREDENTIALS: resolved via tenant_credentials.py (DB tenant_credentials table,
provider='lms', env fallback LMS_<TENANT>_*) — the exact same source and
field names (api_url, client_id, client_secret, access_token) as the
Next.js app, so a tenant configured either way resolves identically here.
"""
from __future__ import annotations

import asyncio
import time
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Callable, Awaitable
from urllib.parse import urlparse

import httpx

from .tenant_credentials import resolve_tenant_credentials

_TIMEOUT_SECONDS = 25.0
_CONCURRENCY = 8
_CACHE_TTL_SECONDS = 60
_LMS_FIELDS = ["api_url", "client_id", "client_secret", "access_token"]

WarnFn = Callable[[str], Awaitable[None]] | None


@dataclass
class LmsCredentials:
    origin: str
    client_id: str
    client_secret: str
    access_token: str | None = None


EMPTY_LMS: dict[str, Any] = {
    "configured": False,
    "enrolledUsers": 0,
    "totalUsers": 0,
    "totalEnrollments": 0,
    "totalCourses": 0,
    "modulesCompleted": 0,
    "inProgress": 0,
    "notStarted": 0,
    "completionRate": None,
    "avgQuizScore": None,
    "hasScoreData": False,
    "completionTrend": [],
    "courses": [],
}


def _origin_from(raw_url: str) -> str | None:
    url = raw_url if "://" in raw_url else f"https://{raw_url}"
    try:
        parsed = urlparse(url)
        if not parsed.scheme or not parsed.netloc:
            return None
        return f"{parsed.scheme}://{parsed.netloc}"
    except Exception:
        return None


def _credentials_from_bundle(bundle: dict[str, str]) -> LmsCredentials | None:
    raw_url = bundle.get("api_url")
    client_id = bundle.get("client_id")
    client_secret = bundle.get("client_secret")
    access_token = bundle.get("access_token")
    if not raw_url:
        return None
    if not access_token and not (client_id and client_secret):
        return None
    origin = _origin_from(raw_url)
    if not origin:
        return None
    return LmsCredentials(origin=origin, client_id=client_id or "", client_secret=client_secret or "", access_token=access_token)


async def resolve_lms_credentials(tenant_key: str | None, warn: WarnFn = None) -> LmsCredentials | None:
    bundle = await resolve_tenant_credentials(tenant_key, "lms", "LMS", _LMS_FIELDS, warn=warn)
    return _credentials_from_bundle(bundle)


async def has_lms_credentials(tenant_key: str | None) -> bool:
    return (await resolve_lms_credentials(tenant_key)) is not None


# ── Transport ──────────────────────────────────────────────────────────────

_token_cache: dict[str, tuple[str, float]] = {}


async def _fetch_access_token(creds: LmsCredentials) -> str:
    key = f"{creds.origin}|{creds.client_id}"
    hit = _token_cache.get(key)
    if hit and hit[1] > time.time() + 60:
        return hit[0]

    async with httpx.AsyncClient(timeout=httpx.Timeout(_TIMEOUT_SECONDS)) as client:
        resp = await client.post(
            f"{creds.origin}/oauth2/access_token",
            headers={"Content-Type": "application/x-www-form-urlencoded", "Lw-Client": creds.client_id},
            data={
                "client_id": creds.client_id,
                "client_secret": creds.client_secret,
                "grant_type": "client_credentials",
            },
        )
    if resp.status_code >= 400:
        raise RuntimeError(f"LMS token exchange failed ({resp.status_code}): {resp.text[:200]}")

    body = resp.json()
    token = body.get("access_token") or (body.get("tokenData") or {}).get("access_token")
    if not token:
        raise RuntimeError("LMS token exchange returned no access_token")

    ttl = float(body.get("expires_in") or (body.get("tokenData") or {}).get("expires_in") or 3600)
    _token_cache[key] = (token, time.time() + ttl)
    return token


async def _api_get(creds: LmsCredentials, path: str) -> dict[str, Any]:
    token = creds.access_token or await _fetch_access_token(creds)
    async with httpx.AsyncClient(timeout=httpx.Timeout(_TIMEOUT_SECONDS)) as client:
        resp = await client.get(
            f"{creds.origin}/admin/api/v2{path}",
            headers={"Authorization": f"Bearer {token}", "Lw-Client": creds.client_id, "Accept": "application/json"},
        )
    if resp.status_code >= 400:
        raise RuntimeError(f"LMS GET {path} failed ({resp.status_code}): {resp.text[:160]}")
    return resp.json()


async def _api_get_all(creds: LmsCredentials, path: str, per_page: int = 50, max_pages: int = 40) -> list[dict]:
    """Walk meta.totalPages, with a hard page cap so a bad meta cannot loop forever."""
    out: list[dict] = []
    sep = "&" if "?" in path else "?"
    for page in range(1, max_pages + 1):
        body = await _api_get(creds, f"{path}{sep}items_per_page={per_page}&page={page}")
        rows = body.get("data")
        if not isinstance(rows, list) or not rows:
            break
        out.extend(rows)
        total = (body.get("meta") or {}).get("totalPages")
        if not total or page >= total:
            break
    return out


async def _map_limit(items: list, limit: int, fn: Callable[[Any], Awaitable[Any]]) -> list:
    """Bounded-concurrency map — keeps per-user progress calls civil."""
    results: list = [None] * len(items)
    sem = asyncio.Semaphore(limit)

    async def worker(i: int, item: Any) -> None:
        async with sem:
            results[i] = await fn(item)

    await asyncio.gather(*(worker(i, item) for i, item in enumerate(items)))
    return results


def _to_date_key(v: Any) -> str | None:
    """completed_at is unix SECONDS on this API; tolerate millis and ISO too."""
    if v is None or v == "":
        return None
    try:
        if isinstance(v, (int, float)):
            ts = v / 1000 if v >= 1e12 else v
            dt = datetime.fromtimestamp(ts, tz=timezone.utc)
        else:
            s = str(v)
            if s.isdigit():
                n = float(s)
                ts = n / 1000 if n >= 1e12 else n
                dt = datetime.fromtimestamp(ts, tz=timezone.utc)
            else:
                dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
        return dt.strftime("%Y-%m-%d")
    except Exception:
        return None


_cache: dict[str, tuple[float, dict]] = {}
_inflight: dict[str, asyncio.Future] = {}


async def lms_dashboard(tenant_key: str | None, from_date: str, to_date: str, warn: WarnFn = None) -> dict[str, Any]:
    """Build the LMS payload for a date range. from_date/to_date (YYYY-MM-DD)
    filter the completion trend only -- enrollment/course/status counts are
    current-state figures, matching lib/lms-learnworlds.ts's lmsDashboard()."""
    creds = await resolve_lms_credentials(tenant_key, warn=warn)
    if not creds:
        return dict(EMPTY_LMS)

    cache_key = f"{creds.origin}|{tenant_key or '-'}|{from_date}|{to_date}"
    cached = _cache.get(cache_key)
    if cached and time.time() - cached[0] < _CACHE_TTL_SECONDS:
        return cached[1]
    flying = _inflight.get(cache_key)
    if flying:
        return await flying

    loop = asyncio.get_event_loop()
    fut = loop.create_future()
    _inflight[cache_key] = fut
    try:
        value = await _build_lms_dashboard(creds, from_date, to_date)
        _cache[cache_key] = (time.time(), value)
        fut.set_result(value)
        return value
    except Exception as exc:
        fut.set_exception(exc)
        raise
    finally:
        _inflight.pop(cache_key, None)


async def _build_lms_dashboard(creds: LmsCredentials, from_key: str, to_key: str) -> dict[str, Any]:
    courses, users = await asyncio.gather(
        _api_get_all(creds, "/courses"),
        _api_get_all(creds, "/users"),
    )

    title = {str(c["id"]): str(c.get("title") or c["id"]) for c in courses if c.get("id")}

    async def fetch_progress(uid: str) -> list[dict]:
        try:
            body = await _api_get(creds, f"/users/{uid}/progress")
            rows = body.get("data")
            return rows if isinstance(rows, list) else []
        except Exception:
            # A user with no progress 404s; that is data, not an outage.
            return []

    uids = [str(u.get("id") or "") for u in users if u.get("id")]
    per_user = await _map_limit(uids, _CONCURRENCY, fetch_progress)

    per_course: dict[str, dict[str, float]] = {}
    trend: dict[str, int] = {}
    enrolled_users = 0
    total_enrollments = 0
    completed = 0
    in_progress = 0
    not_started = 0
    score_sum = 0.0
    score_n = 0

    for rows in per_user:
        if rows:
            enrolled_users += 1
        for r in rows:
            total_enrollments += 1
            cid = str(r.get("course_id") or "")
            agg = per_course.setdefault(cid, {"enrolled": 0, "completed": 0, "inProgress": 0, "scoreSum": 0.0, "scoreN": 0})
            agg["enrolled"] += 1

            status = str(r.get("status") or "").lower()
            if status == "completed":
                completed += 1
                agg["completed"] += 1
                key = _to_date_key(r.get("completed_at"))
                if key and from_key <= key <= to_key:
                    trend[key] = trend.get(key, 0) + 1
            elif status == "not_started":
                not_started += 1
            else:
                in_progress += 1
                agg["inProgress"] += 1

            # LearnWorlds reports average_score_rate=0 for ungraded courses,
            # indistinguishable from a genuine zero — only positive values
            # count, matching lib/lms-learnworlds.ts exactly.
            score = float(r.get("average_score_rate") or 0)
            if score > 0:
                score_sum += score
                score_n += 1
                agg["scoreSum"] += score
                agg["scoreN"] += 1

    course_rows = sorted(
        (
            {
                "courseId": cid,
                "name": title.get(cid) or cid or "Unknown course",
                "enrolled": int(a["enrolled"]),
                "completed": int(a["completed"]),
                "inProgress": int(a["inProgress"]),
                "completionRate": round((a["completed"] / a["enrolled"]) * 1000) / 10 if a["enrolled"] > 0 else None,
                "avgScore": round((a["scoreSum"] / a["scoreN"]) * 10) / 10 if a["scoreN"] > 0 else None,
            }
            for cid, a in per_course.items()
        ),
        key=lambda r: (-r["enrolled"], r["name"]),
    )

    completion_trend = [{"date": d, "value": v} for d, v in sorted(trend.items())]

    return {
        "configured": True,
        "enrolledUsers": enrolled_users,
        "totalUsers": len(users),
        "totalEnrollments": total_enrollments,
        "totalCourses": len(courses),
        "modulesCompleted": completed,
        "inProgress": in_progress,
        "notStarted": not_started,
        "completionRate": round((completed / total_enrollments) * 1000) / 10 if total_enrollments > 0 else None,
        "avgQuizScore": round((score_sum / score_n) * 10) / 10 if score_n > 0 else None,
        "hasScoreData": score_n > 0,
        "completionTrend": completion_trend,
        "courses": course_rows,
    }


async def lms_probe(tenant_key: str | None) -> dict[str, Any]:
    """Cheap liveness probe for capability discovery."""
    creds = await resolve_lms_credentials(tenant_key)
    if not creds:
        return {"configured": False, "alive": False, "courses": 0, "note": "No LMS credentials configured"}
    try:
        body = await _api_get(creds, "/courses?items_per_page=1&page=1")
        meta = body.get("meta") or {}
        courses = meta.get("totalItems")
        if courses is None:
            courses = len(body.get("data") or [])
        return {"configured": True, "alive": True, "courses": courses, "note": "OK"}
    except Exception as exc:
        return {"configured": True, "alive": False, "courses": 0, "note": str(exc)}
