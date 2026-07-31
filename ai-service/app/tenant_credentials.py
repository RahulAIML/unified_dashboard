"""Python port of lib/tenant-credentials.ts — DB-first, env-fallback per-tenant
credential resolution. Reads the SAME tenant_credentials table the Next.js app
writes (shared Postgres auth DB), so a tenant onboarded through the wizard (DB
row, no env var) resolves identically from this service.

Resolution order, matching the TS version exactly:
  1. tenant_credentials (encrypted, DB)
  2. <ENV_PREFIX>_<TENANT_KEY>_<FIELD> environment variable, per field
  3. <ENV_PREFIX>_<FIELD> shared environment variable — ONLY when tenant_key
     is None, never as a fallback for a named tenant (a bare LMS_* would
     otherwise serve one school's data to every tenant).

A DB or decryption problem never falls back to env — that would mask a
misconfigured tenant as working and could serve the wrong tenant's
credentials. Decryption failures are surfaced via a warning callback, not
raised, so one bad field doesn't abort discovery for an otherwise-working
tenant.
"""
from __future__ import annotations

import re
from typing import Callable, Awaitable

from .config import get_settings
from .secret_crypto import SecretCryptoError, decrypt_secret

CredentialBundle = dict[str, str]

WarnFn = Callable[[str], Awaitable[None]] | None


def _tenant_env_var_name(tenant_key: str, env_prefix: str, suffix: str) -> str:
    scoped = re.sub(r"[^A-Z0-9]+", "_", tenant_key.upper())
    return f"{env_prefix}_{scoped}_{suffix}"


async def _read_from_db(tenant_key: str, provider: str, warn: WarnFn) -> CredentialBundle:
    from .db import get_pool

    key = get_settings().secret_encryption_key
    if not key:
        return {}

    pool = await get_pool()
    if not pool:
        return {}

    try:
        rows = await pool.fetch(
            """SELECT field, value_encrypted FROM tenant_credentials
                WHERE tenant_key = $1 AND provider = $2 AND is_active
                ORDER BY field""",
            tenant_key, provider,
        )
    except Exception:
        # No table yet, or a transient outage — the expected state for every
        # tenant not yet migrated to the encrypted store. Silent by design,
        # matching resolveTenantCredentials' identical rationale.
        return {}

    bundle: CredentialBundle = {}
    for row in rows:
        try:
            bundle[row["field"]] = decrypt_secret(row["value_encrypted"], key)
        except SecretCryptoError as exc:
            if warn:
                await warn(
                    f"[tenant-credentials] DECRYPT FAILED tenant={tenant_key} "
                    f"provider={provider} field={row['field']}: {exc}"
                )
    return bundle


async def resolve_tenant_credentials(
    tenant_key: str | None,
    provider: str,
    env_prefix: str,
    fields: list[str],
    warn: WarnFn = None,
) -> CredentialBundle:
    import os

    bundle: CredentialBundle = await _read_from_db(tenant_key, provider, warn) if tenant_key else {}

    for field in fields:
        if bundle.get(field):
            continue
        suffix = field.upper()
        if tenant_key:
            v = os.environ.get(_tenant_env_var_name(tenant_key, env_prefix, suffix))
            if v:
                bundle[field] = v
            # Deliberately NO shared fallback for a named tenant.
            continue
        shared = os.environ.get(f"{env_prefix}_{suffix}")
        if shared:
            bundle[field] = shared

    return bundle
