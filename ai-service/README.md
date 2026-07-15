# Rolplay AI Dashboard-Builder Service

A standalone **FastAPI + async Python** microservice that turns a company name
(+ optional exercise IDs) into a **live, real-data dashboard config** — no
developer needed. The Next.js app talks to it over HTTP and renders the
resulting metadata.

## Why a separate service
AI orchestration is kept out of the Next.js frontend. This service owns the
agent workflow; the frontend only calls its APIs and renders published configs.

## The agents (independent, not one giant prompt)
1. **Planner** — breaks the request into the ordered task plan.
2. **Company Discovery** — resolves the company; reuses the knowledge base.
3. **Service Discovery** — probes every connector; finds what's alive + has data.
4. **Schema Discovery** — reads real responses → normalized metrics/dimensions/modules.
5. **Dashboard Planning** — schema → widgets/rows/filters (only real-data metrics).
6. **Dashboard Config** — assembles publishable metadata (no React generated).
7. **Validation** — static checks (missing metrics, ids, duplicates, empties).
8. **Preview** — calls the real backend → live widget values before publishing.
9. **Publish** — persists config + makes it live via the existing `pharma_tenants` pipeline.

Discovery is **deterministic** (no LLM required). An LLM key is optional and only
refines titles/recommendations. Runs fully in-memory if no DB is configured.

## Connectors (the extension point)
`app/connectors/` — one module per data source produces a `ServiceDescriptor`.
Today: pharma `kpi` / `sale_exercises` / `exceltis_rest`, `coach_app` SQL,
Second Brain, rolplay-app SQL. Add a new REST/SQL/GraphQL/SaaS source by adding
one connector; the agents never change.

## Run locally
```bash
python -m venv .venv && ./.venv/Scripts/pip install -r requirements.txt
cp .env.example .env            # optional; defaults hit production data sources
./.venv/Scripts/uvicorn app.main:app --port 8088
```

## API
- `POST /ai/discover-company`   `{company, exercise_ids?}` → knowledge
- `POST /ai/discover-services`  → knowledge with live services
- `POST /ai/generate-dashboard` `{company, exercise_ids?, auto_publish?}` → job
- `GET  /ai/status/{job_id}`     → live job state (phase, percent, logs, preview)
- `POST /ai/publish`             `{job_id}` → make live
- `GET  /ai/dashboard/{slug}`    → published config (Next.js renders this)
- `GET  /health`

## Quick check (no HTTP)
```bash
./.venv/Scripts/python scripts/try_generate.py   # runs the full pipeline for Apotex/Heineken/Siigo
```

## Database tables (created on first DB connect; never touches existing tables)
`agent_memory`, `dashboard_metadata`, `dashboard_versions`, `discovery_logs`,
`validation_reports`. Publish also upserts the existing `pharma_tenants` /
`pharma_tenant_domains`.
