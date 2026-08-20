/**
 * rolplay-app-first-seen.ts
 *
 * "Nuevo" badge tracking for rolplay_app_sql clients (Siigo, M8, Takeda, …).
 *
 * Unlike pharma_tenants (which has a real created_at from the admin wizard),
 * rolplay.app's own r_client table has no creation-date column at all — it's
 * a third-party production table we don't own and can't ALTER. So "new" for
 * this source can't be derived from their data; instead we record OURSELVES,
 * in our own Postgres, the first moment we ever observed each client_id via
 * the known-companies picker.
 *
 * A client_id observed for the very first time with ZERO real activity
 * (sessions=0 AND users=0) is stamped first_seen=NOW and gets "Nuevo" for
 * NEW_TENANT_WINDOW_MS, then it clears automatically -- no code change
 * needed when a genuinely new client is provisioned. A client_id observed
 * for the first time that ALREADY has real activity is backdated instead
 * (first_seen = NOW - NEW_TENANT_WINDOW_MS - 1 day): this is the rollout
 * case (every one of the ~13 real clients that predate this feature has
 * real sessions the very first time we ever look), and without this it
 * would falsely flag all of them "Nuevo" for two weeks purely because we
 * only just started watching. Zero activity is the same "freshly
 * provisioned, nothing recorded yet" signal already used for hardcoded
 * pharma tenants like Heineken (sessions=0/users=0 in the picker).
 */
import { authQuery, AuthDbError } from './db-auth'

const NEW_TENANT_WINDOW_MS = 14 * 24 * 60 * 60 * 1000

export interface ClientActivity { id: number; sessions: number; users: number }

let tableReady: Promise<void> | null = null

async function ensureTable(): Promise<void> {
  if (!tableReady) {
    tableReady = authQuery(`
      CREATE TABLE IF NOT EXISTS rolplay_app_client_first_seen (
        client_id  INTEGER PRIMARY KEY,
        first_seen TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).then(() => undefined).catch((err) => {
      // Let the next call retry (e.g. a transient connection blip) instead of
      // permanently caching a failure.
      tableReady = null
      throw err
    })
  }
  await tableReady
}

/**
 * Records the first time each of these clients was ever observed (backdating
 * any that already have real activity, per the module doc above), and
 * returns when each one was first seen. Idempotent: a client_id already
 * tracked keeps its original first_seen forever (ON CONFLICT DO NOTHING) --
 * `activity` is only consulted the very first time a given client_id is
 * inserted.
 *
 * Returns an empty map (never throws) when the auth DB isn't configured or
 * unreachable -- this is a convenience badge, not a security or data-
 * correctness feature, so its absence must never break the company picker.
 */
export async function recordSeenAndGetFirstSeen(activity: ClientActivity[]): Promise<Map<number, Date>> {
  const byId = new Map(activity.filter(a => Number.isFinite(a.id)).map(a => [a.id, a]))
  const ids = [...byId.keys()]
  if (ids.length === 0) return new Map()

  try {
    await ensureTable()
    const brandNewIds  = ids.filter(id => (byId.get(id)?.sessions ?? 0) === 0 && (byId.get(id)?.users ?? 0) === 0)
    const preexistingIds = ids.filter(id => !brandNewIds.includes(id))

    // Two separate INSERTs so each group gets the right first_seen the one
    // time it's actually created -- ON CONFLICT DO NOTHING makes both safe
    // to re-run on every request without ever overwriting a real tracked date.
    if (brandNewIds.length > 0) {
      await authQuery(
        `INSERT INTO rolplay_app_client_first_seen (client_id, first_seen)
         SELECT id, NOW() FROM UNNEST($1::int[]) AS id
         ON CONFLICT (client_id) DO NOTHING`,
        [brandNewIds],
      )
    }
    if (preexistingIds.length > 0) {
      await authQuery(
        `INSERT INTO rolplay_app_client_first_seen (client_id, first_seen)
         SELECT id, NOW() - INTERVAL '15 days' FROM UNNEST($1::int[]) AS id
         ON CONFLICT (client_id) DO NOTHING`,
        [preexistingIds],
      )
    }

    const rows = await authQuery<{ client_id: number; first_seen: Date }>(
      `SELECT client_id, first_seen FROM rolplay_app_client_first_seen WHERE client_id = ANY($1::int[])`,
      [ids],
    )
    return new Map(rows.map(r => [Number(r.client_id), new Date(r.first_seen)]))
  } catch (err) {
    if (!(err instanceof AuthDbError) && !(err instanceof Error)) throw err
    console.warn('[rolplay-app-first-seen] tracking unavailable (non-fatal):', (err as Error).message)
    return new Map()
  }
}

export { NEW_TENANT_WINDOW_MS }
