/**
 * MySQL query layer (server-side).
 *
 * Two modes — chosen automatically at runtime:
 *
 *  Mode A — PHP Bridge (preferred):
 *    Set BRIDGE_URL + BRIDGE_SECRET in env.
 *    All queries go via HTTPS POST to the bridge.
 *    Port 3306 never needs to be open externally.
 *
 *  Mode B — Direct MySQL (fallback):
 *    Set DB_HOST, DB_USER, DB_PASSWORD, DB_NAME in env.
 *    Used when BRIDGE_URL is absent.
 */

import mysql from "mysql2/promise"

// ── Mode A: PHP bridge ────────────────────────────────────────────────────────

async function queryViaBridge<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  const url    = process.env.BRIDGE_URL!
  const secret = process.env.BRIDGE_SECRET ?? "REDACTED_BRIDGE_SECRET"

  const res = await fetch(url, {
    method:  "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Bridge-Key":  secret,
    },
    body: JSON.stringify({ sql, params }),
    // Next.js: don't cache DB responses
    cache: "no-store",
  })

  if (!res.ok) {
    throw new Error(`Bridge HTTP ${res.status}: ${await res.text()}`)
  }

  const json = await res.json() as { success: boolean; data: T[]; error: string | null }

  if (!json.success) {
    throw new Error(`Bridge error: ${json.error ?? "unknown"}`)
  }

  return json.data
}

// ── Mode B: Direct MySQL pool ─────────────────────────────────────────────────

let pool: mysql.Pool | null = null

function getPool(): mysql.Pool {
  if (pool) return pool

  const host     = process.env.DB_HOST
  const user     = process.env.DB_USER
  const password = process.env.DB_PASSWORD
  const database = process.env.DB_NAME
  const port     = Number(process.env.DB_PORT ?? 3306)

  if (!host || !user || !database) {
    throw new Error("Missing DB env vars (DB_HOST, DB_USER, DB_NAME)")
  }

  pool = mysql.createPool({
    host, user, password, database, port,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: "Z",
  })

  return pool
}

async function queryDirect<T>(sql: string, params: unknown[] = []): Promise<T[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [rows] = await getPool().execute(sql, params as any)
  return rows as T[]
}

// ── Public query() — auto-selects mode ───────────────────────────────────────

export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  if (process.env.BRIDGE_URL) {
    return queryViaBridge<T>(sql, params)
  }
  return queryDirect<T>(sql, params)
}

// ── fetchBridge — calls a named action endpoint ───────────────────────────────
// Use this when you want a pre-built action (kpis, trend, modules, test)
// instead of sending raw SQL.

export async function fetchBridge<T = Record<string, unknown>>(
  action: string,
  params?: Record<string, string>
): Promise<T | null> {
  const url    = process.env.BRIDGE_URL
  const secret = process.env.BRIDGE_SECRET ?? "REDACTED_BRIDGE_SECRET"

  if (!url) return null

  const qs = new URLSearchParams({ action, ...params }).toString()

  try {
    const res = await fetch(`${url}?${qs}`, {
      method:  "GET",
      headers: { "X-Bridge-Key": secret },
      cache:   "no-store",
    })

    if (!res.ok) return null

    const json = await res.json() as { success: boolean; data: T; error: string | null }
    return json.success ? json.data : null
  } catch {
    return null
  }
}
