/**
 * MySQL query layer — server-side only.
 *
 * Supports two modes, chosen automatically via env vars:
 *
 * Mode A — Direct MySQL (requires port 3306 accessible):
 *   DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT
 *
 * Mode B — PHP Bridge (recommended for shared hosting):
 *   BRIDGE_URL    = https://improveyourpitchbeta.net/rolplay-ai/rolplay-bridge.php
 *   BRIDGE_SECRET = REDACTED_BRIDGE_SECRET
 *
 * If BRIDGE_URL is set, all queries go through the PHP bridge over HTTPS.
 * data-provider.ts is unaffected — it always calls query() below.
 */

import mysql from 'mysql2/promise'

// ─── Mode B: PHP Bridge ───────────────────────────────────────────────────────

async function queryViaBridge<T>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const bridgeUrl    = process.env.BRIDGE_URL!
  const bridgeSecret = process.env.BRIDGE_SECRET ?? 'REDACTED_BRIDGE_SECRET'

  const res = await fetch(bridgeUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Bridge-Key': bridgeSecret,
    },
    body: JSON.stringify({ sql, params }),
    // No cache — always fresh data
    cache: 'no-store',
  })

  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    throw new Error(`Bridge error ${res.status}: ${body?.error ?? res.statusText}`)
  }

  return res.json() as Promise<T[]>
}

// ─── Mode A: Direct MySQL pool ────────────────────────────────────────────────

let pool: mysql.Pool | null = null

function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      host:               process.env.DB_HOST     ?? 'localhost',
      user:               process.env.DB_USER     ?? 'root',
      password:           process.env.DB_PASSWORD ?? '',
      database:           process.env.DB_NAME     ?? 'rolplay_pro_analytics',
      port:               Number(process.env.DB_PORT ?? 3306),
      waitForConnections: true,
      connectionLimit:    10,
      queueLimit:         0,
      timezone:           'Z',
    })
  }
  return pool
}

async function queryDirect<T>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [rows] = await getPool().execute(sql, params as any)
  return rows as T[]
}

// ─── Unified entry point ──────────────────────────────────────────────────────

/**
 * Run a parameterised SQL query and return typed rows.
 * Automatically uses the PHP bridge if BRIDGE_URL is set.
 */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  if (process.env.BRIDGE_URL) {
    return queryViaBridge<T>(sql, params)
  }
  return queryDirect<T>(sql, params)
}
