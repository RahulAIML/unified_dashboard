/**
 * MySQL connection pool — server-side only.
 *
 * Do NOT import this module from any "use client" file.
 * It reads credentials from environment variables:
 *   DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT
 *
 * Analytics database: rolplay_pro_analytics
 *   Tables: report_field_current, report_payload_current
 */

import mysql from 'mysql2/promise'

// Singleton pool — Next.js module cache keeps this alive across requests in prod
let pool: mysql.Pool | null = null

export function getPool(): mysql.Pool {
  if (!pool) {
    pool = mysql.createPool({
      host:             process.env.DB_HOST     ?? 'localhost',
      user:             process.env.DB_USER     ?? 'root',
      password:         process.env.DB_PASSWORD ?? '',
      database:         process.env.DB_NAME     ?? 'rolplay_pro_analytics',
      port:             Number(process.env.DB_PORT ?? 3306),
      waitForConnections: true,
      connectionLimit:  10,
      queueLimit:       0,
      timezone:         'Z',        // store/read datetimes as UTC
    })
  }
  return pool
}

/** Convenience: run a parameterised query and return rows. */
export async function query<T = Record<string, unknown>>(
  sql: string,
  params?: unknown[]
): Promise<T[]> {
  const [rows] = await getPool().execute(sql, params)
  return rows as T[]
}
