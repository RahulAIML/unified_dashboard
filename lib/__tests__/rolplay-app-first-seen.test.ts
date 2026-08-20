import { describe, it, expect, vi, beforeEach } from 'vitest'

const authQuery = vi.fn()

vi.mock('../db-auth', () => ({
  authQuery: (...args: unknown[]) => authQuery(...args),
  AuthDbError: class AuthDbError extends Error {},
}))

async function fresh() {
  vi.resetModules()
  authQuery.mockReset()
  return import('../rolplay-app-first-seen')
}

describe('recordSeenAndGetFirstSeen', () => {
  it('returns an empty map without querying anything for an empty input', async () => {
    const mod = await fresh()
    const result = await mod.recordSeenAndGetFirstSeen([])
    expect(result.size).toBe(0)
    expect(authQuery).not.toHaveBeenCalled()
  })

  it('stamps a zero-activity client with NOW (genuinely fresh, "Nuevo"-eligible)', async () => {
    const mod = await fresh()
    const seenAt = new Date()
    authQuery
      .mockResolvedValueOnce(undefined) // CREATE TABLE IF NOT EXISTS
      .mockResolvedValueOnce(undefined) // INSERT brand-new (NOW())
      .mockResolvedValueOnce([{ client_id: 88, first_seen: seenAt }]) // SELECT

    const result = await mod.recordSeenAndGetFirstSeen([{ id: 88, sessions: 0, users: 0 }])

    expect(result.get(88)).toEqual(seenAt)
    // Only the brand-new INSERT ran -- no pre-existing-activity INSERT, since
    // every id in this call has zero activity.
    expect(authQuery).toHaveBeenCalledTimes(3)
    expect(authQuery.mock.calls[1][0]).toContain('NOW()')
    expect(authQuery.mock.calls[1][1]).toEqual([[88]])
  })

  it('backdates a client that already has real activity the first time it is seen, so rollout does not flag every existing client as new', async () => {
    const mod = await fresh()
    const backdated = new Date(Date.now() - 15 * 24 * 60 * 60 * 1000)
    authQuery
      .mockResolvedValueOnce(undefined) // CREATE TABLE IF NOT EXISTS
      .mockResolvedValueOnce(undefined) // INSERT pre-existing (backdated)
      .mockResolvedValueOnce([{ client_id: 29, first_seen: backdated }]) // SELECT

    const result = await mod.recordSeenAndGetFirstSeen([{ id: 29, sessions: 154, users: 61 }])

    const { NEW_TENANT_WINDOW_MS } = mod
    expect(Date.now() - result.get(29)!.getTime()).toBeGreaterThan(NEW_TENANT_WINDOW_MS)
    expect(authQuery).toHaveBeenCalledTimes(3)
    expect(authQuery.mock.calls[1][0]).toContain("NOW() - INTERVAL '15 days'")
    expect(authQuery.mock.calls[1][1]).toEqual([[29]])
  })

  it('splits a mixed batch into two INSERTs -- brand-new ids get NOW(), pre-existing-activity ids get backdated', async () => {
    const mod = await fresh()
    authQuery
      .mockResolvedValueOnce(undefined) // CREATE TABLE
      .mockResolvedValueOnce(undefined) // INSERT brand-new
      .mockResolvedValueOnce(undefined) // INSERT pre-existing
      .mockResolvedValueOnce([
        { client_id: 88, first_seen: new Date() },
        { client_id: 29, first_seen: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000) },
      ])

    await mod.recordSeenAndGetFirstSeen([
      { id: 88, sessions: 0, users: 0 },
      { id: 29, sessions: 154, users: 61 },
    ])

    expect(authQuery).toHaveBeenCalledTimes(4)
    expect(authQuery.mock.calls[1][0]).toContain('NOW()')
    expect(authQuery.mock.calls[1][1]).toEqual([[88]])
    expect(authQuery.mock.calls[2][0]).toContain("INTERVAL '15 days'")
    expect(authQuery.mock.calls[2][1]).toEqual([[29]])
  })

  it('never re-stamps a client_id already tracked (ON CONFLICT DO NOTHING keeps the original first_seen)', async () => {
    const mod = await fresh()
    const originalFirstSeen = new Date('2026-01-01T00:00:00.000Z')
    authQuery
      .mockResolvedValueOnce(undefined) // CREATE TABLE
      .mockResolvedValueOnce(undefined) // INSERT (no-op due to ON CONFLICT)
      .mockResolvedValueOnce([{ client_id: 29, first_seen: originalFirstSeen }])

    // Called again with real activity now, long after its true first_seen --
    // the SELECT must still return the ORIGINAL date, not a new backdate.
    const result = await mod.recordSeenAndGetFirstSeen([{ id: 29, sessions: 9999, users: 500 }])
    expect(result.get(29)).toEqual(originalFirstSeen)
  })

  it('returns an empty map (never throws) when the auth DB is unreachable', async () => {
    const mod = await fresh()
    authQuery.mockRejectedValue(new Error('connection refused'))

    const result = await mod.recordSeenAndGetFirstSeen([{ id: 29, sessions: 0, users: 0 }])
    expect(result.size).toBe(0)
  })
})
