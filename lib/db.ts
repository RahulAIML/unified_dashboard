/**
 * MySQL query layer (server-side).
 *
 * Uses mysql2/promise and environment variables only:
 *   DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT
 */

import mysql from "mysql2/promise"

let pool: mysql.Pool | null = null

function getPool(): mysql.Pool {
  if (pool) return pool

  const host = process.env.DB_HOST
  const user = process.env.DB_USER
  const password = process.env.DB_PASSWORD
  const database = process.env.DB_NAME
  const port = Number(process.env.DB_PORT ?? 3306)

  if (!host || !user || !database) {
    throw new Error("Missing DB env vars (DB_HOST, DB_USER, DB_NAME)")
  }

  pool = mysql.createPool({
    host,
    user,
    password,
    database,
    port,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    timezone: "Z",
  })

  return pool
}

export async function query<T = Record<string, unknown>>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [rows] = await getPool().execute(sql, params as any)
  return rows as T[]
}
