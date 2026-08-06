import { describe, it, expect } from 'vitest'
import { calcDeltaPct } from '@/lib/kpi-builder'

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
