import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Module gating for query-endpoint clients. Verifies the mapping the live DB
 * proved: r_simulator.category COACH → Master Coach ('coach'), SIM →
 * 'simulator', SEGMENT → Certifier Coach ('certification'); and that 'SB' is
 * NEVER surfaced here (Second Brain has its own API + token).
 */

const fetchMock = vi.fn()

beforeEach(() => {
  vi.resetModules()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => vi.unstubAllGlobals())

function mockCategories(rows: { category: string | null; n: number }[]) {
  fetchMock.mockResolvedValue({
    ok: true,
    json: async () => ({ result: 'success', data: rows }),
  })
}

describe('rolplayAppAvailableModules', () => {
  it('maps M8-style data (SIM+COACH+SEGMENT) to all three modules, canonical order', async () => {
    mockCategories([
      { category: 'SIM', n: 306 },
      { category: 'COACH', n: 165 },
      { category: 'SEGMENT', n: 4 },
    ])
    const { rolplayAppAvailableModules } = await import('../bridge-rolplay-app')
    expect(await rolplayAppAvailableModules(24)).toEqual(['coach', 'simulator', 'certification'])
  })

  it('maps Siigo-style data (SIM only) to just simulator', async () => {
    mockCategories([{ category: 'SIM', n: 136 }])
    const { rolplayAppAvailableModules } = await import('../bridge-rolplay-app')
    expect(await rolplayAppAvailableModules(29)).toEqual(['simulator'])
  })

  it('maps Rowe-style data (COACH+SIM) to coach + simulator', async () => {
    mockCategories([{ category: 'COACH', n: 198 }, { category: 'SIM', n: 43 }])
    const { rolplayAppAvailableModules } = await import('../bridge-rolplay-app')
    expect(await rolplayAppAvailableModules(25)).toEqual(['coach', 'simulator'])
  })

  it('never surfaces Second Brain from this schema (SB is its own API)', async () => {
    mockCategories([{ category: 'SB', n: 3 }, { category: 'COACH', n: 2 }])
    const { rolplayAppAvailableModules } = await import('../bridge-rolplay-app')
    const mods = await rolplayAppAvailableModules(13)
    expect(mods).toEqual(['coach'])
    expect(mods).not.toContain('second-brain')
  })

  it('ignores uncategorised/zero-session rows', async () => {
    mockCategories([{ category: null, n: 266 }, { category: 'SIM', n: 0 }, { category: 'COACH', n: 7 }])
    const { rolplayAppAvailableModules } = await import('../bridge-rolplay-app')
    expect(await rolplayAppAvailableModules(33)).toEqual(['coach'])
  })

  it('returns [] when the query fails (caller falls back, never crashes)', async () => {
    fetchMock.mockRejectedValue(new Error('network'))
    const { rolplayAppAvailableModules } = await import('../bridge-rolplay-app')
    expect(await rolplayAppAvailableModules(29)).toEqual([])
  })
})
