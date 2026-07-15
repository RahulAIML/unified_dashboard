"""Central configuration for the AI dashboard-builder service.

All external endpoints and secrets are read from the environment so this
service shares the same configuration surface as the Next.js app (same bridge
URLs, same auth DB). Nothing is hardcoded per-company here — company-specific
knowledge is discovered at runtime and stored in the knowledge base.
"""
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # ── Service ────────────────────────────────────────────────────────────────
    service_name: str = "rolplay-ai-dashboard-builder"
    host: str = "0.0.0.0"
    port: int = 8088
    # Comma-separated origins allowed to call this service (the Next.js app).
    cors_origins: str = "http://localhost:3000,https://rolplaypro-dashboard.onrender.com"

    # ── Persistence (reuses the Next.js auth Postgres DB; new tables only) ──────
    auth_database_url: str | None = None

    # ── Rolplay data sources (same values the Next.js app uses) ─────────────────
    # Pharma unified bridge base, e.g. https://serv.aux-rolplay.com/unified
    pharma_bridge_base_url: str = "https://serv.aux-rolplay.com/unified"
    # Some pharma tenants live on per-client roots directly under the host.
    pharma_host_root: str = "https://serv.aux-rolplay.com"
    # coach_app SQL bridge
    bridge_url: str | None = None
    bridge_secret: str | None = None
    # Second Brain
    second_brain_api_url: str | None = None
    second_brain_api_token: str | None = None
    second_brain_admin_email: str | None = None
    # Rolplay-app raw SQL endpoint (SELECT-only)
    rolplay_app_sql_url: str = "https://rolplay.app/ajax/remote-access.php"

    # ── LLM (Gemini) — agents fall back to deterministic heuristics if unset ────
    # Default: Gemini 3 Flash (Pro-level intelligence at Flash speed/price).
    # Set LLM_MODEL=gemini-3.1-pro-preview for maximum reasoning quality.
    gemini_api_key: str | None = None
    llm_model: str = "gemini-3-flash-preview"
    llm_thinking_level: str = "low"  # minimal|low|medium|high
    gemini_base_url: str = "https://generativelanguage.googleapis.com/v1beta"

    # ── Discovery tuning ────────────────────────────────────────────────────────
    http_timeout_seconds: float = 30.0
    discovery_wide_date_from: str = "2015-01-01"
    discovery_wide_date_to: str = "2035-12-31"

    @property
    def cors_origin_list(self) -> list[str]:
        return [o.strip() for o in self.cors_origins.split(",") if o.strip()]

    @property
    def llm_enabled(self) -> bool:
        return bool(self.gemini_api_key)


@lru_cache
def get_settings() -> Settings:
    return Settings()
