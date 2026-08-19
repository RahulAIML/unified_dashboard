/**
 * Regression: Raúl (client) reported that filtering the demo Overview by
 * "Master Coach" showed MORE total sessions than "All" -- a part bigger
 * than the whole. Root cause: demoOverview's "All" case (solution=null)
 * drew its own independent flat rate (52/day) instead of aggregating the
 * per-module rates (lms 42, coach 58, simulator 50, certification 36),
 * so a module with a higher flat rate than 52 (coach, at 58) could and
 * did exceed "All" over the same date range. Fixed by deriving "All" as
 * a real sum/weighted-average of the per-module results.
 */
import { describe, it, expect } from 'vitest'
import { demoOverview, demoUsecaseBreakdown } from '../engine'

const FROM = new Date('2016-01-01')
const TO = new Date('2026-01-01') // ~10 years, matches ALL_TIME_DAYS scale

describe('demoOverview — "All" vs per-module internal consistency', () => {
  it('never lets a single module exceed "All" for the same date range', () => {
    const all = demoOverview(FROM, TO, null)
    for (const solution of ['lms', 'coach', 'simulator', 'certification', 'second-brain']) {
      const module = demoOverview(FROM, TO, solution)
      expect(module.totalEvaluations).toBeLessThanOrEqual(all.totalEvaluations)
    }
  })

  it('"All" totalEvaluations equals the exact sum of every real module', () => {
    const all = demoOverview(FROM, TO, null)
    const sum = ['lms', 'coach', 'simulator', 'certification', 'second-brain']
      .map(s => demoOverview(FROM, TO, s).totalEvaluations)
      .reduce((a, b) => a + b, 0)
    expect(all.totalEvaluations).toBe(sum)
  })

  it('"All" passedEvaluations never exceeds "All" totalEvaluations', () => {
    const all = demoOverview(FROM, TO, null)
    expect(all.passedEvaluations).toBeLessThanOrEqual(all.totalEvaluations)
  })
})

describe('demoUsecaseBreakdown — per-module usecase no longer collapses to one id', () => {
  it('gives different modules different usecase ids (not always the first one)', () => {
    const coach = demoUsecaseBreakdown(FROM, TO, 'coach', 'en')
    const simulator = demoUsecaseBreakdown(FROM, TO, 'simulator', 'en')
    expect(coach.data[0].usecaseId).not.toBe(simulator.data[0].usecaseId)
  })
})
