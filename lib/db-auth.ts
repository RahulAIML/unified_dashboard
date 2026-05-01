/**
 * db-auth.ts — PostgreSQL connection layer for the Auth DB.
 *
 * This is the ONLY place that touches the auth PostgreSQL database.
 * Analytics data stays in the MySQL analytics DB (via PHP bridge in lib/db.ts).
 * Auth data (users, sessions) lives exclusively in this separate PostgreSQL DB.
 *
 * Connection is configured via the AUTH_DATABASE_URL environment variable:
 *   AUTH_DATABASE_URL=postgresql://user:password@host:5432/rolplay_auth_db
 *
 * Recommended providers (free tier):
 *   • Neon     — https://neon.tech          (serverless PostgreSQL, best for Next.js)
 *   • Supabase — https://supabase.com        (PostgreSQL with extra features)
 *   • Railway  — https://railway.app         (simple managed PostgreSQL)
 *
 * The pool is module-level so it's reused across hot reloads in development
 * and across invocations in serverless environments.
 */

import { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg'

// ── Typed error class ──────────────────────────────────────────────────────────

export class AuthDbError extends Error {
  constructor(
    message: string,
    public readonly code:
      | 'NOT_CONFIGURED'   // AUTH_DATABASE_URL not set
      | 'CONNECTION_FAILED' // Can't reach PostgreSQL
      | 'TABLE_MISSING'    // Schema not initialised
      | 'DUPLICATE_EMAIL'  // Unique constraint violation
      | 'QUERY_FAILED'     // Any other query error
  ) {
    super(message)
    this.name = 'AuthDbError'
  }
}

// ── Singleton pool ─────────────────────────────────────────────────────────────

// Declare on global to survive Next.js hot reloads in development
declare global {
  // eslint-disable-next-line no-var
  var __authPool: Pool | undefined
}

function getPool(): Pool {
  if (global.__authPool) return global.__authPool

  const connectionString = process.env.AUTH_DATABASE_URL

  if (!connectionString) {
    throw new AuthDbError(
      'AUTH_DATABASE_URL is not configured. ' +
        'Add it to .env.local (see .env.local.example for instructions).',
      'NOT_CONFIGURED'
    )
  }

  // Strip ?sslmode=... from the URL so the pg ssl option object takes full control.
  // When both are present, newer pg versions let the URL sslmode win and ignore
  // rejectUnauthorized: false — causing "self-signed certificate" on Render/Neon.
  const sslDisabled = /sslmode=disable/i.test(connectionString)
  const cleanUrl = connectionString.replace(/[?&]sslmode=[^&]*/gi, '')
    .replace(/[?&]$/, '')

  const pool = new Pool({
    connectionString: cleanUrl,
    // SSL required for all managed providers (Render, Neon, Supabase, Railway).
    // rejectUnauthorized: false accepts self-signed certs used by Render Postgres.
    ssl: sslDisabled ? false : { rejectUnauthorized: false },
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  })

  // Surface connection errors early rather than on first query
  pool.on('error', (err) => {
    console.error('[auth-db] Unexpected pool error:', err.message)
  })

  global.__authPool = pool
  return pool
}

// ── Public query function ──────────────────────────────────────────────────────

/**
 * Execute a parameterised query against the Auth PostgreSQL DB.
 *
 * Parameters use PostgreSQL notation ($1, $2, …) not MySQL (?).
 *
 * @example
 *   const rows = await authQuery<{ id: number }>(
 *     'SELECT id FROM users WHERE email = $1 LIMIT 1',
 *     ['user@example.com']
 *   )
 */
export async function authQuery<T extends QueryResultRow = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  let client: PoolClient | undefined

  try {
    client = await getPool().connect()
    const result: QueryResult<T> = await client.query<T>(sql, params)
    return result.rows
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)

    // Surface AuthDbError (e.g. NOT_CONFIGURED) unchanged
    if (err instanceof AuthDbError) throw err

    // Map well-known PostgreSQL error codes to typed errors
    const pgCode = (err as NodeJS.ErrnoException & { code?: string }).code

    if (
      pgCode === 'ECONNREFUSED' ||
      pgCode === 'ETIMEDOUT' ||
      pgCode === '08001' || // connection_exception
      pgCode === '08006' || // connection_failure
      pgCode === '57P03'    // cannot_connect_now
    ) {
      throw new AuthDbError(
        'Cannot connect to the auth database. Check AUTH_DATABASE_URL and network.',
        'CONNECTION_FAILED'
      )
    }

    if (pgCode === '23505') {
      // unique_violation
      throw new AuthDbError('Email address is already registered.', 'DUPLICATE_EMAIL')
    }

    if (
      pgCode === '42P01' || // undefined_table
      msg.toLowerCase().includes('does not exist')
    ) {
      throw new AuthDbError(
        'Auth database schema not initialised. Call GET /api/auth/setup to create tables.',
        'TABLE_MISSING'
      )
    }

    if (msg.toLowerCase().includes('econnrefused') || msg.toLowerCase().includes('etimedout')) {
      throw new AuthDbError(
        'Cannot connect to the auth database. Check AUTH_DATABASE_URL.',
        'CONNECTION_FAILED'
      )
    }

    throw new AuthDbError(`Auth database error: ${msg}`, 'QUERY_FAILED')
  } finally {
    client?.release()
  }
}

/**
 * Run multiple statements in a single transaction.
 * Rolls back automatically if any statement throws.
 */
export async function authTransaction(
  fn: (client: PoolClient) => Promise<void>
): Promise<void> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    await fn(client)
    await client.query('COMMIT')
  } catch (err) {
    await client.query('ROLLBACK')
    throw err
  } finally {
    client.release()
  }
}

/**
 * Run a raw DDL statement (used only by the setup endpoint).
 * Returns the raw QueryResult instead of rows.
 */
export async function authExec(sql: string): Promise<QueryResult> {
  const client = await getPool().connect()
  try {
    return await client.query(sql)
  } finally {
    client.release()
  }
}
