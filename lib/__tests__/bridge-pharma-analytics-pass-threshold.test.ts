/**
 * Regression coverage for the configurable pass-rate threshold ticket:
 * aggregateSaleExercisesRows (the sale_exercises/exceltis_rest overview
 * aggregate inside bridge-pharma-analytics.ts) must honor a per-tenant
 * threshold rather than the old hardcoded 70, and must produce a null
 * passRate -- never a misleading number -- for a tenant with no passing
 * criteria at all.
 */
import { describe, it, expect } from 'vitest'
import { aggregateSaleExercisesRows, isPassForTenant, type SaleExercisesRow } from '@/lib/bridge-pharma-analytics'

function row(score: number): SaleExercisesRow {
  return { id: 1, usecase_id: 1, usecase_name: 'x', email: 'a@b.com', name: 'A', date: '2026-08-01', score }
}

describe('aggregateSaleExercisesRows — configurable threshold', () => {
  it('counts a score of exactly the threshold as passing', () => {
    const result = aggregateSaleExercisesRows([row(70), row(69)], 70)
    expect(result.passed).toBe(1)
    expect(result.passRate).toBe(50)
  })

  it('applies an 80-point threshold when the tenant is configured for it', () => {
    const result = aggregateSaleExercisesRows([row(85), row(75)], 80)
    expect(result.passed).toBe(1)
    expect(result.passRate).toBe(50)
  })

  it('never computes a pass rate for a tenant with no passing criteria (threshold null)', () => {
    const result = aggregateSaleExercisesRows([row(100), row(0)], null)
    expect(result.passRate).toBeNull()
    expect(result.passed).toBe(0)
    // avgScore is unaffected -- it's not a pass/fail concept.
    expect(result.avgScore).toBe(50)
  })

  it('avgScore and total are always computed regardless of threshold', () => {
    const result = aggregateSaleExercisesRows([row(90), row(70)], null)
    expect(result.total).toBe(2)
    expect(result.avgScore).toBe(80)
  })
})

/**
 * The aggregate above always honored the configured threshold, but every OTHER
 * pass comparison in bridge-pharma-analytics.ts used a module-level
 * `const PASS_THRESHOLD = LEGACY_PASS_THRESHOLD` (70). A tenant configured at 80
 * therefore saw an Overview tile computed at 80 while its trend chart, usecase
 * breakdown, best-performers table, Results rows and drilldown badges all still
 * used 70 -- two contradictory definitions of "passed" on one dashboard.
 * isPassForTenant is the single predicate all of those now share.
 */
describe('isPassForTenant — one definition of "passed" per tenant', () => {
  it('treats a score at the threshold as a pass', () => {
    expect(isPassForTenant(70, 70)).toBe(true)
    expect(isPassForTenant(80, 80)).toBe(true)
  })

  it('does NOT count 75 as passing for a tenant configured at 80', () => {
    // The exact inconsistency C3 describes: 75 passed under the hardcoded 70
    // in the trend/breakdown/results paths while failing in the Overview tile.
    expect(isPassForTenant(75, 80)).toBe(false)
    expect(isPassForTenant(75, 70)).toBe(true)
  })

  it('never passes anything for a tenant with no passing criteria', () => {
    expect(isPassForTenant(100, null)).toBe(false)
    expect(isPassForTenant(0, null)).toBe(false)
  })

  it('rejects non-finite scores rather than throwing or coercing', () => {
    expect(isPassForTenant(NaN, 70)).toBe(false)
    expect(isPassForTenant(Infinity, 70)).toBe(false)
  })
})
