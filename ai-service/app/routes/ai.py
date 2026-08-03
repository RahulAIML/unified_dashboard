"""AI service HTTP API."""
from __future__ import annotations

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from .. import jobs
from ..agents import company_discovery, publish
from ..agents.service_discovery import pick_primary
from ..agents import service_discovery, schema_discovery
from ..config import get_settings
from ..knowledge import delete_knowledge, get_knowledge, put_knowledge
from ..models import CompanyKnowledge, DashboardConfig, GenerateRequest, JobState


async def require_internal_secret(x_internal_auth: str | None = Header(default=None)) -> None:
    """This service is deployed as a public Render web service (render.yaml:
    type=web) with no auth of its own beyond CORS — which only constrains
    BROWSER-originated requests, not a direct server-to-server or curl call to
    this service's own URL. Every route under /ai/* provisions tenants,
    generates/publishes dashboards, or reads company analytics data, so all of
    them are gated here, not just the mutating ones.

    Unenforced when internal_shared_secret is unset (the dev default), so a
    local checkout without the env var configured keeps working. It MUST be
    set in production (matching AI_SERVICE_SHARED_SECRET on the Next.js proxy,
    app/api/ai/[...path]/route.ts) or this service remains reachable by anyone
    who finds its URL, bypassing the Next.js admin gate entirely.
    """
    secret = get_settings().internal_shared_secret
    if not secret:
        return
    if x_internal_auth != secret:
        raise HTTPException(status_code=401, detail="invalid or missing internal auth")


router = APIRouter(prefix="/ai", tags=["ai"], dependencies=[Depends(require_internal_secret)])


@router.get("/health")
async def ai_health() -> dict:
    return {"ok": True}


async def _noop_log(*_args) -> None:
    return None


class CompanyIn(BaseModel):
    company: str
    exercise_ids: list[int] = []


@router.post("/discover-company", response_model=CompanyKnowledge)
async def discover_company(body: CompanyIn) -> CompanyKnowledge:
    k = await company_discovery.run(body.company, body.exercise_ids, _noop_log)
    return k


@router.post("/discover-services", response_model=CompanyKnowledge)
async def discover_services(body: CompanyIn) -> CompanyKnowledge:
    k = await company_discovery.run(body.company, body.exercise_ids, _noop_log)
    k = await service_discovery.run(k, body.exercise_ids, _noop_log)
    await put_knowledge(k)
    return k


@router.post("/generate-dashboard", response_model=JobState, response_model_by_alias=True)
async def generate_dashboard(req: GenerateRequest) -> JobState:
    return jobs.create_job(req)


@router.delete("/knowledge/{slug}")
async def forget_company(slug: str) -> dict:
    """Drop a company's cached discovery so the next generate-dashboard run
    re-probes every connector fresh — for correcting a stale/wrong cache entry."""
    await delete_knowledge(slug)
    return {"cleared": slug}


@router.get("/status/{job_id}", response_model=JobState, response_model_by_alias=True)
async def status(job_id: str) -> JobState:
    job = jobs.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    return job


class ProvideIdsIn(BaseModel):
    job_id: str
    exercise_ids: list[int]


@router.post("/provide-ids", response_model=JobState, response_model_by_alias=True)
async def provide_ids(body: ProvideIdsIn) -> JobState:
    """Resume a job paused at needs_ids with the manager-supplied exercise IDs."""
    job = jobs.submit_ids(body.job_id, body.exercise_ids)
    if not job:
        raise HTTPException(status_code=409, detail="job is not waiting for exercise IDs")
    return job


class ConfirmServicesIn(BaseModel):
    job_id: str
    modules: list[str]


@router.post("/confirm-services", response_model=JobState, response_model_by_alias=True)
async def confirm_services(body: ConfirmServicesIn) -> JobState:
    """Resume a job paused at review_services with the manager's selected subset."""
    job = jobs.submit_services(body.job_id, body.modules)
    if not job:
        raise HTTPException(status_code=409, detail="job is not waiting for service confirmation")
    return job


@router.post("/generate-sync", response_model=JobState, response_model_by_alias=True)
async def generate_sync(req: GenerateRequest) -> JobState:
    """Serverless-friendly: run the whole pipeline in ONE request and return the
    finished result (config + validation + preview). No background job / polling,
    so it works on stateless platforms (Vercel) where in-memory jobs don't persist."""
    from ..workflow import run_generation
    from ..models import JobState as JS

    job = JS(job_id="sync", request=req)

    async def _noop(_j) -> None:
        return None

    await run_generation(job, _noop)
    if req.auto_publish and job.validation and job.validation.ok and job.dashboard:
        job.published = await publish.run(job.dashboard, job.knowledge.domains if job.knowledge else [], _noop_log)
    return job


class PublishIn(BaseModel):
    job_id: str


@router.post("/publish")
async def do_publish(body: PublishIn) -> dict:
    job = jobs.get_job(body.job_id)
    if not job or not job.dashboard:
        raise HTTPException(status_code=404, detail="job/dashboard not found")
    if job.validation and not job.validation.ok:
        raise HTTPException(status_code=400, detail="validation failed; cannot publish")
    domains = job.knowledge.domains if job.knowledge else []
    ok = await publish.run(job.dashboard, domains, _noop_log)
    job.published = ok
    return {"published": ok, "slug": job.dashboard.slug}


async def _load_config(slug: str) -> DashboardConfig | None:
    from ..db import get_pool
    import json
    pool = await get_pool()
    if pool:
        row = await pool.fetchrow("SELECT config FROM dashboard_metadata WHERE slug=$1 AND published=TRUE", slug)
        if row:
            return DashboardConfig.model_validate(json.loads(row["config"]))
    job = jobs.latest_for_slug(slug)
    return job.dashboard if job and job.dashboard else None


@router.get("/dashboard/{slug}", response_model=DashboardConfig)
async def get_dashboard(slug: str) -> DashboardConfig:
    """Return a published dashboard config (metadata only)."""
    cfg = await _load_config(slug)
    if not cfg:
        raise HTTPException(status_code=404, detail="dashboard not found")
    return cfg


_RENDER_CACHE_TTL_SECONDS = 30


@router.get("/render/{slug}")
async def render_dashboard(slug: str) -> dict:
    """Return a published dashboard config PLUS live widget data — the Next.js
    dynamic renderer draws a full dashboard page from this, for any connector.

    Cached (see app/cache.py) for a short TTL, keyed on the config's own
    `version` — every publish increments that (dashboard_config.py), so a
    republish naturally busts the cache via a new key rather than needing
    explicit invalidation. This is the one endpoint every dashboard VIEW hits
    (builder preview and the published /d/[slug] page alike), and every
    widget's live query re-runs from scratch on every call today — a
    dashboard viewed repeatedly in a short window (a team refreshing during a
    meeting, several people opening it around the same time) re-pays that
    full cost each time with no cache at all.
    """
    from ..agents import preview
    cfg = await _load_config(slug)
    if not cfg:
        raise HTTPException(status_code=404, detail="dashboard not found")

    async def _compute() -> dict:
        pv = await preview.run(cfg, _noop_log)
        return {"config": cfg.model_dump(mode="json"), "preview": pv.model_dump(mode="json")}

    from .. import cache
    return await cache.get_or_set(f"render:{slug}:v{cfg.version}", _RENDER_CACHE_TTL_SECONDS, _compute)


@router.get("/dashboard-versions/{slug}")
async def list_dashboard_versions(slug: str) -> dict:
    """Every publish has always appended a snapshot here; this is the first
    thing that ever reads it back — dashboard_versions.py's docstring
    explains why publishing was effectively irreversible before this."""
    from .. import dashboard_versions
    return {"slug": slug, "versions": await dashboard_versions.list_versions(slug)}


class RollbackIn(BaseModel):
    slug: str
    version: int


@router.post("/dashboard-versions/rollback")
async def rollback_dashboard(body: RollbackIn) -> dict:
    from .. import dashboard_versions
    restored = await dashboard_versions.rollback_to(body.slug, body.version)
    if not restored:
        raise HTTPException(status_code=404, detail=f"no version {body.version} found for '{body.slug}'")
    return {"slug": body.slug, "restored_from_version": body.version, "new_version": restored.version}
