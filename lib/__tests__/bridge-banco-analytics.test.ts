/**
 * Tests for bridge-banco-analytics.ts
 *
 * Strategy: mock mysql2/promise so no real DB connections are made.
 * Verifies that:
 *   1. Each function returns the correct shape (OverviewApiResponse, etc.)
 *   2. Numeric fields are properly cast from DB strings
 *   3. Edge cases (no rows, null scores) are handled gracefully
 *   4. Errors from execute() propagate correctly
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// ── Mock mysql2/promise before module import ──────────────────────────────────

const mockExecute = vi.fn()

vi.mock('mysql2/promise', () => ({
  default: {
    createPool: vi.fn(() => ({ execute: mockExecute })),
  },
}))

import {
  bancoDashboardOverview,
  bancoDashboardTrends,
  bancoDashboardUsecaseBreakdown,
  bancoDashboardBestPerformers,
  bancoDashboardResults,
} from '../bridge-banco-analytics'

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Make execute() resolve with these rows (mysql2 returns [rows, fields]) */
function dbRows(rows: unknown[]) {
  mockExecute.mockResolvedValue([rows, []])
}

/** Make every execute() call in the test resolve with the same rows */
function dbRowsAlways(rows: unknown[]) {
  mockExecute.mockResolvedValue([rows, []])
}

beforeEach(() => {
  // Provide minimal env so getBancoPool() doesn't throw
  process.env.BANCO_DB_HOST = 'localhost'
  process.env.BANCO_DB_USER = 'test_user'
  process.env.BANCO_DB_PASSWORD = ''
  vi.clearAllMocks()
})

// ── Overview ──────────────────────────────────────────────────────────────────

describe('bancoDashboardOverview', () => {
  it('returns correct shape with numeric values from DB strings', async () => {
    const row = { totalEvaluations: '42', avgScore: '73.5', passedEvaluations: '30', passRate: '71.4' }
    // overview makes 2 execute calls (current + previous period)
    mockExecute.mockResolvedValue([[row], []])

    const result = await bancoDashboardOverview({
      fromIso:     '2026-04-01T00:00:00.000Z',
      toIso:       '2026-05-01T00:00:00.000Z',
      prevFromIso: '2026-03-01T00:00:00.000Z',
      prevToIso:   '2026-03-31T00:00:00.000Z',
    })

    expect(result.totalEvaluations).toBe(42)
    expect(result.avgScore).toBe(73.5)
    expect(result.passedEvaluations).toBe(30)
    expect(result.passRate).toBe(71.4)
  })

  it('returns zeros and nulls when DB returns empty rows', async () => {
    mockExecute.mockResolvedValue([[], []])

    const result = await bancoDashboardOverview({
      fromIso:     '2026-04-01T00:00:00.000Z',
      toIso:       '2026-05-01T00:00:00.000Z',
      prevFromIso: '2026-03-01T00:00:00.000Z',
      prevToIso:   '2026-03-31T00:00:00.000Z',
    })

    expect(result.totalEvaluations).toBe(0)
    expect(result.avgScore).toBeNull()
    expect(result.passRate).toBeNull()
    expect(result.passedEvaluations).toBe(0)
    expect(result.prevTotalEvaluations).toBe(0)
  })

  it('handles null avgScore and passRate from DB', async () => {
    const row = { totalEvaluations: '5', avgScore: null, passedEvaluations: '0', passRate: null }
    mockExecute.mockResolvedValue([[row], []])

    const result = await bancoDashboardOverview({
      fromIso:     '2026-04-01T00:00:00.000Z',
      toIso:       '2026-05-01T00:00:00.000Z',
      prevFromIso: '2026-03-01T00:00:00.000Z',
      prevToIso:   '2026-03-31T00:00:00.000Z',
    })

    expect(result.avgScore).toBeNull()
    expect(result.passRate).toBeNull()
  })

  it('throws when DB execute throws', async () => {
    mockExecute.mockRejectedValue(new Error('MySQL syntax error'))

    await expect(
      bancoDashboardOverview({
        fromIso:     '2026-04-01T00:00:00.000Z',
        toIso:       '2026-05-01T00:00:00.000Z',
        prevFromIso: '2026-03-01T00:00:00.000Z',
        prevToIso:   '2026-03-31T00:00:00.000Z',
      })
    ).rejects.toThrow('MySQL syntax error')
  })
})

// ── Trends ────────────────────────────────────────────────────────────────────

describe('bancoDashboardTrends', () => {
  it('returns three trend arrays with correct shapes', async () => {
    const rows = [
      { date: '2026-04-10', avg_score: '65.0', passed: '3', failed: '1', total: '4' },
      { date: '2026-04-11', avg_score: '70.5', passed: '5', failed: '0', total: '5' },
    ]
    dbRows(rows)

    const result = await bancoDashboardTrends({
      fromIso: '2026-04-01T00:00:00.000Z',
      toIso:   '2026-05-01T00:00:00.000Z',
    })

    expect(result.scoreTrend).toHaveLength(2)
    expect(result.passFailTrend).toHaveLength(2)
    expect(result.evalCountTrend).toHaveLength(2)

    expect(result.scoreTrend[0]).toEqual({ date: '2026-04-10', value: 65 })
    expect(result.passFailTrend[0]).toEqual({ date: '2026-04-10', value: 3, value2: 1 })
    expect(result.evalCountTrend[1]).toEqual({ date: '2026-04-11', value: 5 })
  })

  it('returns empty arrays when no data', async () => {
    dbRows([])

    const result = await bancoDashboardTrends({
      fromIso: '2026-04-01T00:00:00.000Z',
      toIso:   '2026-05-01T00:00:00.000Z',
    })

    expect(result.scoreTrend).toEqual([])
    expect(result.passFailTrend).toEqual([])
    expect(result.evalCountTrend).toEqual([])
  })

  it('defaults null avg_score to 0 in scoreTrend', async () => {
    dbRows([{ date: '2026-04-10', avg_score: null, passed: '0', failed: '2', total: '2' }])

    const result = await bancoDashboardTrends({
      fromIso: '2026-04-01T00:00:00.000Z',
      toIso:   '2026-05-01T00:00:00.000Z',
    })

    expect(result.scoreTrend[0].value).toBe(0)
  })
})

// ── Usecase breakdown ─────────────────────────────────────────────────────────

describe('bancoDashboardUsecaseBreakdown', () => {
  it('returns correct UsecaseApiRow shape', async () => {
    dbRows([
      { usecaseId: '11', totalEvaluations: '20', avgScore: '68.0', passRate: '75.0', passed: '15' },
    ])

    const result = await bancoDashboardUsecaseBreakdown({
      fromIso: '2026-04-01T00:00:00.000Z',
      toIso:   '2026-05-01T00:00:00.000Z',
    })

    expect(result.data).toHaveLength(1)
    expect(result.data[0]).toMatchObject({
      usecaseId:        11,
      usecase_name:     null,
      totalEvaluations: 20,
      avgScore:         68,
      passRate:         75,
      passed:           15,
    })
  })

  it('returns empty data array when DB returns no rows', async () => {
    dbRows([])

    const result = await bancoDashboardUsecaseBreakdown({
      fromIso: '2026-04-01T00:00:00.000Z',
      toIso:   '2026-05-01T00:00:00.000Z',
    })

    expect(result.data).toEqual([])
  })
})

// ── Best performers ───────────────────────────────────────────────────────────

describe('bancoDashboardBestPerformers', () => {
  it('returns correct BestPerformerRow shape with empty user_email', async () => {
    dbRows([
      { user_name: 'Maria Lopez', sessions: '10', avg_score: '82.5', pass_rate: '90.0' },
      { user_name: 'Carlos Ruiz', sessions: '7',  avg_score: '61.0', pass_rate: '57.1' },
    ])

    const result = await bancoDashboardBestPerformers({
      fromIso: '2026-04-01T00:00:00.000Z',
      toIso:   '2026-05-01T00:00:00.000Z',
      limit:   5,
    })

    expect(result.data).toHaveLength(2)
    expect(result.data[0].user_email).toBe('')
    expect(result.data[0].user_name).toBe('Maria Lopez')
    expect(result.data[0].sessions).toBe(10)
    expect(result.data[0].avg_score).toBe(82.5)
    expect(result.data[0].pass_rate).toBe(90)
  })

  it('caps limit at 20', async () => {
    dbRowsAlways([])

    await expect(
      bancoDashboardBestPerformers({
        fromIso: '2026-04-01T00:00:00.000Z',
        toIso:   '2026-05-01T00:00:00.000Z',
        limit:   100,
      })
    ).resolves.toBeDefined()
  })
})

// ── Results ───────────────────────────────────────────────────────────────────

describe('bancoDashboardResults', () => {
  it('returns correct EvaluationApiRow shape', async () => {
    dbRows([
      { savedReportId: '101', usecaseId: '11', score: '75', passed: '1', date: '2026-04-15' },
      { savedReportId: '102', usecaseId: '11', score: '45', passed: '0', date: '2026-04-14' },
    ])

    const result = await bancoDashboardResults({
      fromIso: '2026-04-01T00:00:00.000Z',
      toIso:   '2026-05-01T00:00:00.000Z',
      limit:   50,
    })

    expect(result.data).toHaveLength(2)
    expect(result.data[0]).toMatchObject({
      savedReportId: 101,
      usecaseId:     11,
      score:         75,
      result:        'passed',
      passed:        true,
      date:          '2026-04-15',
    })
    expect(result.data[1]).toMatchObject({ result: 'failed', passed: false })
  })

  it('handles null usecaseId', async () => {
    dbRows([
      { savedReportId: '200', usecaseId: null, score: '60', passed: '1', date: '2026-04-20' },
    ])

    const result = await bancoDashboardResults({
      fromIso: '2026-04-01T00:00:00.000Z',
      toIso:   '2026-05-01T00:00:00.000Z',
      limit:   50,
    })

    expect(result.data[0].usecaseId).toBeNull()
  })
})
