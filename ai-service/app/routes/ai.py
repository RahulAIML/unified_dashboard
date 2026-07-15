"""AI service HTTP API."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import jobs
from ..agents import company_discovery, publish
from ..agents.service_discovery import pick_primary
from ..agents import service_discovery, schema_discovery
from ..knowledge import get_knowledge, put_knowledge
from ..models import CompanyKnowledge, DashboardConfig, GenerateRequest, JobState

router = APIRouter(prefix="/ai", tags=["ai"])


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


@router.get("/status/{job_id}", response_model=JobState, response_model_by_alias=True)
async def status(job_id: str) -> JobState:
    job = jobs.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
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


@router.get("/dashboard/{slug}", response_model=DashboardConfig)
async def get_dashboard(slug: str) -> DashboardConfig:
    """Return a published dashboard config for the Next.js app to render."""
    from ..db import get_pool
    import json
    pool = await get_pool()
    if pool:
        row = await pool.fetchrow("SELECT config FROM dashboard_metadata WHERE slug=$1 AND published=TRUE", slug)
        if row:
            return DashboardConfig.model_validate(json.loads(row["config"]))
    job = jobs.latest_for_slug(slug)
    if job and job.dashboard:
        return job.dashboard
    raise HTTPException(status_code=404, detail="dashboard not found")
