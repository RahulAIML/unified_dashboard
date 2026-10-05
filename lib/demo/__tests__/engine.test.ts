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
import { demoOverview, demoUsecaseBreakdown, demoBestPerformers, demoTrends, demoLms } from '../engine'

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

/**
 * Reported directly in the Aug 20/21 sprint reviews: the "All" (10-year)
 * default view showed 130K-245K evaluations per module -- 100-200x a real
 * established client's actual lifetime total (verified live against M8:
 * ~900 sessions across its ENTIRE history) -- and every other widget
 * (Usecase Breakdown, Trends, Best Performers, LMS) rolled its own numbers
 * independently of Overview's, so nothing on screen visibly related to
 * anything else. These tests lock in the fix: a believable absolute scale,
 * a real (not inverted/flat) relationship between short and long ranges,
 * and every other widget anchored to Overview's real numbers for the same
 * (solution, from, to) instead of a disconnected RNG stream.
 */
describe('demoOverview — realistic absolute scale for the "All" (10-year) default view', () => {
  it('keeps the widest range under 50K per module, not the old 130K-245K', () => {
    for (const solution of ['lms', 'coach', 'simulator', 'certification']) {
      expect(demoOverview(FROM, TO, solution).totalEvaluations).toBeLessThan(50_000)
    }
  })

  it('a longer date range never shows FEWER (or barely more) total evaluations than a shorter one', () => {
    // Guards against a too-aggressive scale cap making "All time" and "last
    // 30 days" look like roughly the same total, which reads as the company
    // having gone dormant rather than being an established, active client.
    const to = new Date('2026-08-21')
    const from7 = new Date(to); from7.setDate(from7.getDate() - 7)
    const from30 = new Date(to); from30.setDate(from30.getDate() - 30)
    const from365 = new Date(to); from365.setDate(from365.getDate() - 365)
    const fromAll = new Date(to); fromAll.setDate(fromAll.getDate() - 3650)

    const t7 = demoOverview(from7, to, 'coach').totalEvaluations
    const t30 = demoOverview(from30, to, 'coach').totalEvaluations
    const t365 = demoOverview(from365, to, 'coach').totalEvaluations
    const tAll = demoOverview(fromAll, to, 'coach').totalEvaluations

    expect(t30).toBeGreaterThan(t7)
    expect(t365).toBeGreaterThan(t30)
    expect(tAll).toBeGreaterThan(t365)
    // The 10-year total should still be a real multiple of the 30-day total
    // (a growing/established client), not within a couple x of it.
    expect(tAll / t30).toBeGreaterThan(8)
  })
})

describe('demoUsecaseBreakdown — anchored to the real Overview total for the same module/range', () => {
  it('sums back to (approximately) Overview\'s real totalEvaluations for "All" solutions', () => {
    const overview = demoOverview(FROM, TO, null)
    const breakdown = demoUsecaseBreakdown(FROM, TO, null, 'en')
    const sum = breakdown.data.reduce((s, r) => s + r.totalEvaluations, 0)
    // Rounding per row means this is a close approximation, not exact equality.
    expect(Math.abs(sum - overview.totalEvaluations)).toBeLessThan(overview.totalEvaluations * 0.02)
  })

  it('a single module\'s one usecase row equals that module\'s real Overview total exactly', () => {
    const overview = demoOverview(FROM, TO, 'coach')
    const breakdown = demoUsecaseBreakdown(FROM, TO, 'coach', 'en')
    expect(breakdown.data[0].totalEvaluations).toBe(overview.totalEvaluations)
  })
})

describe('demoBestPerformers — anchored to the module\'s real average, never below it', () => {
  it('every performer scores at or above the module\'s real Overview average', () => {
    const overview = demoOverview(FROM, TO, 'certification')
    const best = demoBestPerformers(FROM, TO, 5, 'certification')
    for (const row of best.data) {
      expect(row.avg_score).toBeGreaterThanOrEqual(overview.avgScore)
      expect(row.pass_rate).toBeGreaterThanOrEqual(overview.passRate)
    }
  })
})

describe('demoTrends — evalCountTrend sums close to the real Overview total for the same module/range', () => {
  it('does not drift far from the real total the way an independent RNG model could', () => {
    const overview = demoOverview(FROM, TO, 'simulator')
    const trends = demoTrends(FROM, TO, 'simulator')
    const sum = trends.evalCountTrend.reduce((s, p) => s + p.value, 0)
    expect(Math.abs(sum - overview.totalEvaluations)).toBeLessThan(overview.totalEvaluations * 0.1)
  })
})

/**
 * PM's own worked example from the sprint review: "102 total users, 5
 * courses each, so 510 total possible completions... the completion rate
 * should be compared not to the enrolled, but to the total." Locks in that
 * demoLms now implements exactly that relationship, using the same formula
 * shipped in lib/lms-learnworlds.ts's real fix.
 */
describe('demoLms — every course is a real subset of the SAME shared roster', () => {
  it('no course\'s enrolled count ever exceeds the shared totalUsers roster', () => {
    const lms = demoLms(FROM, TO, 'en')
    for (const course of lms.courses) {
      expect(course.enrolled).toBeLessThanOrEqual(lms.totalUsers)
      expect(course.totalUsers).toBe(lms.totalUsers)
    }
  })

  it('the aggregate completionRate matches completed / (totalUsers x totalCourses), not / totalEnrollments', () => {
    const lms = demoLms(FROM, TO, 'en')
    const expected = Math.round((lms.modulesCompleted / (lms.totalUsers * lms.totalCourses)) * 1000) / 10
    expect(lms.completionRate).toBe(expected)
  })

  it('each course\'s own completionRate matches completed / totalUsers, not / enrolled', () => {
    const lms = demoLms(FROM, TO, 'en')
    for (const course of lms.courses) {
      const expected = Math.round((course.completed / lms.totalUsers) * 1000) / 10
      expect(course.completionRate).toBe(expected)
    }
  })
})

/**
 * Raw per-(learner, course) export, added so an admin can download exactly
 * the rows a completion rate is computed from -- a temporary evaluation tool
 * (Aug 21 sprint review), not part of LmsApiResponse's real-data contract.
 */
describe('demoLms — raw enrollment export rows are consistent with the aggregate counts', () => {
  it('emits exactly `enrolled` rows for each course, matching the course\'s own aggregate', () => {
    const lms = demoLms(FROM, TO, 'en')
    for (const course of lms.courses) {
      const rowsForCourse = lms.enrollments.filter(r => r.courseId === course.courseId)
      expect(rowsForCourse.length).toBe(course.enrolled)
    }
  })

  it('the completed/in_progress/not_started row counts match the course\'s own aggregate fields', () => {
    const lms = demoLms(FROM, TO, 'en')
    for (const course of lms.courses) {
      const rowsForCourse = lms.enrollments.filter(r => r.courseId === course.courseId)
      const completed = rowsForCourse.filter(r => r.status === 'completed').length
      const inProgress = rowsForCourse.filter(r => r.status === 'in_progress').length
      expect(completed).toBe(course.completed)
      expect(inProgress).toBe(course.inProgress)
    }
  })

  it('never fabricates a score or completedAt date for a row that is not completed', () => {
    const lms = demoLms(FROM, TO, 'en')
    for (const row of lms.enrollments) {
      if (row.status !== 'completed') {
        expect(row.score).toBeNull()
        expect(row.completedAt).toBeNull()
      } else {
        expect(row.score).not.toBeNull()
        expect(row.completedAt).not.toBeNull()
      }
    }
  })
})

/**
 * Cursos finalizados por día ("Dashboard KPI fixes" item 3) is now a fixed,
 * always-current 30-day window, matching the identical fix in
 * lib/lms-learnworlds.ts's lmsDashboard. Found live: with the demo date
 * range set to "Todos" (~10 years, FROM/TO above), the chart's x-axis
 * still spanned years even after that real fix shipped -- demoLms had its
 * own separate trend generator that was never updated to match.
 */
describe('demoLms — completions trend is a fixed 30-day window, independent of the selected range', () => {
  it('always returns exactly 30 points regardless of how wide the selected range is', () => {
    const lms = demoLms(FROM, TO, 'en')
    expect(lms.completionTrend).toHaveLength(30)
  })

  it('the 30 dates are the real, current last 30 days, not derived from the selected range', () => {
    const lms = demoLms(FROM, TO, 'en')
    const today = new Date().toISOString().slice(0, 10)
    const thirtyDaysAgo = new Date(Date.now() - 29 * 86_400_000).toISOString().slice(0, 10)
    expect(lms.completionTrend[0].date).toBe(thirtyDaysAgo)
    expect(lms.completionTrend[29].date).toBe(today)
    // FROM ('2016-01-01') must never appear -- confirms the old
    // range-derived generation is gone.
    expect(lms.completionTrend.some(p => p.date.startsWith('2016'))).toBe(false)
  })

  it('a short selected range (e.g. 7 days) still produces the same fixed 30-day trend', () => {
    const shortFrom = new Date(Date.now() - 6 * 86_400_000)
    const shortTo = new Date()
    const lms = demoLms(shortFrom, shortTo, 'en')
    expect(lms.completionTrend).toHaveLength(30)
  })
})
