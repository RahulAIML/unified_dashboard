import { describe, it, expect } from 'vitest'
import { calcDeltaPct, resolvePassThreshold, passRateLegend, LEGACY_PASS_THRESHOLD, DEFAULT_NEW_PASS_THRESHOLD } from '@/lib/kpi-builder'

describe('calcDeltaPct', () => {
  it('computes a normal percentage change', () => {
    expect(calcDeltaPct(150, 100)).toBe(50)
  })

  it('returns 0 when prev is 0 (no fabricated comparison)', () => {
    expect(calcDeltaPct(50, 0)).toBe(0)
  })

  it('returns 0 when prev is null/undefined', () => {
    expect(calcDeltaPct(50, null)).toBe(0)
    expect(calcDeltaPct(50, undefined)).toBe(0)
  })

  it('returns 0 when current is null/undefined', () => {
    expect(calcDeltaPct(null, 50)).toBe(0)
  })

  it('suppresses swings over 999% as a meaningless negligible-baseline comparison', () => {
    // Observed live: 514 sessions vs. a 5-session prior period reads as a
    // technically-correct but meaningless "+10180%".
    expect(calcDeltaPct(514, 5)).toBe(0)
  })

  it('keeps a large but plausible swing under the cap', () => {
    expect(calcDeltaPct(120, 20)).toBe(500)
  })
})

describe('resolvePassThreshold', () => {
  it('falls back to the legacy 70 threshold when nothing is configured', () => {
    expect(resolvePassThreshold(undefined)).toBe(LEGACY_PASS_THRESHOLD)
    expect(resolvePassThreshold(null)).toBe(LEGACY_PASS_THRESHOLD)
    expect(resolvePassThreshold({})).toBe(LEGACY_PASS_THRESHOLD)
  })

  it('uses an explicitly configured threshold', () => {
    expect(resolvePassThreshold({ passThreshold: 80 })).toBe(80)
    expect(resolvePassThreshold({ passThreshold: DEFAULT_NEW_PASS_THRESHOLD })).toBe(80)
  })

  it('returns null when the tenant has no passing criteria, even with a threshold set', () => {
    expect(resolvePassThreshold({ hasNoPassingCriteria: true })).toBeNull()
    expect(resolvePassThreshold({ hasNoPassingCriteria: true, passThreshold: 70 })).toBeNull()
  })
})

describe('passRateLegend', () => {
  it('renders the exact configured threshold, not a hardcoded number', () => {
    expect(passRateLegend(80)).toBe('Pass threshold: score ≥ 80 pts')
    expect(passRateLegend(70)).toBe('Pass threshold: score ≥ 70 pts')
  })

  it('returns null (hide the section) for a tenant with no passing criteria', () => {
    expect(passRateLegend(null)).toBeNull()
  })
})
