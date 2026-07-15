"""FastAPI entrypoint for the Rolplay AI dashboard-builder service."""
from __future__ import annotations

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from .config import get_settings
from .routes.ai import router as ai_router

settings = get_settings()

app = FastAPI(title=settings.service_name, version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(ai_router)


@app.get("/health")
async def health() -> dict:
    return {
        "ok": True,
        "service": settings.service_name,
        "llm_enabled": settings.llm_enabled,
        "db_configured": bool(settings.auth_database_url),
    }
