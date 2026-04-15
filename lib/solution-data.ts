/**
 * solution-data.ts — shared mock KPI dataset for all module pages.
 *
 * All values are the 30-day baseline for a mature platform deployment.
 * Call getSolutionData(solution, days) to get period-scaled values ready
 * to drop into KPI cards.
 *
 * User counts (users/assigned) are cumulative — they don't scale with period.
 * Session/evaluation counts scale linearly with days.
 * Rates (avgScore, passRate) get a small ±seed variation per period to feel alive.
 *
 * To wire up real data later: replace getSolutionData() with an API call
 * and keep this file as the fallback.
 */

export interface SolutionData {
  // Cumulative (don't scale with period)
  users:    number
  assigned: number
  // Period-scaled
  totalEvaluations:     number
  passedEvaluations:    number
  prevTotalEvaluations: number
  // Rates (± slight period variation)
  avgScore:    number
  passRate:    number
  prevAvgScore:    number
  prevPassRate:    number
  // Chart bases (scaled)
  activityBase: number
}

// ── 30-day baselines ──────────────────────────────────────────────────────────
// users sum:    87+62+54+31+14 = 248 ✓
// assigned sum: 65+48+41+23+9  = 186 ✓
const BASE: Record<string, Omit<SolutionData, 'totalEvaluations'|'passedEvaluations'|'prevTotalEvaluations'|'activityBase'> & {
  totalEvaluations: number; passedEvaluations: number; prevTotalEvaluations: number; activityBase: number
}> = {
  all: {
    users: 248, assigned: 186,
    totalEvaluations: 1342, passedEvaluations: 94,  prevTotalEvaluations: 1041,
    avgScore: 76,  passRate: 63, prevAvgScore: 71, prevPassRate: 58,
    activityBase: 45,
  },
  lms: {
    users: 87, assigned: 65,
    totalEvaluations: 312, passedEvaluations: 28, prevTotalEvaluations: 271,
    avgScore: 82, passRate: 71, prevAvgScore: 78, prevPassRate: 66,
    activityBase: 11,
  },
  coach: {
    users: 62, assigned: 48,
    totalEvaluations: 287, passedEvaluations: 19, prevTotalEvaluations: 320,
    avgScore: 69, passRate: 58, prevAvgScore: 72, prevPassRate: 61,
    activityBase: 10,
  },
  simulator: {
    users: 54, assigned: 41,
    totalEvaluations: 398, passedEvaluations: 31, prevTotalEvaluations: 352,
    avgScore: 74, passRate: 65, prevAvgScore: 70, prevPassRate: 60,
    activityBase: 14,
  },
  certification: {
    users: 31, assigned: 23,
    totalEvaluations: 198, passedEvaluations: 16, prevTotalEvaluations: 174,
    avgScore: 79, passRate: 68, prevAvgScore: 75, prevPassRate: 64,
    activityBase: 7,
  },
  "second-brain": {
    users: 14, assigned: 9,
    totalEvaluations: 147, passedEvaluations: 12, prevTotalEvaluations: 124,
    avgScore: 88, passRate: 75, prevAvgScore: 83, prevPassRate: 70,
    activityBase: 5,
  },
}

/** Tiny deterministic jitter so rates feel alive across periods */
function jitter(seed: number, range: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280
  return Math.round(((x - Math.floor(x)) * range) - range / 2)
}

/**
 * Returns period-scaled KPI data for the given solution + day count.
 * Safe to call on every render — result is deterministic (no Math.random).
 */
export function getSolutionData(solution: string | null, days: number): SolutionData {
  const key = solution ?? "all"
  const b   = BASE[key] ?? BASE.all
  const ps  = days / 30   // 7d → 0.233, 30d → 1, 90d → 3

  // Rate variation: ±3 pts/% — same seed = same value for same (solution, days) combo
  const scoreSeed   = key.length * 7  + days
  const rateSeed    = key.length * 13 + days

  return {
    // Cumulative — don't scale
    users:    b.users,
    assigned: b.assigned,

    // Scale with period
    totalEvaluations:     Math.round(b.totalEvaluations     * ps),
    passedEvaluations:    Math.round(b.passedEvaluations    * ps),
    prevTotalEvaluations: Math.round(b.prevTotalEvaluations * ps),
    activityBase:         Math.round(b.activityBase         * ps),

    // Rates with light period-specific variation
    avgScore:    Math.min(99, Math.max(40, b.avgScore    + jitter(scoreSeed,     6))),
    passRate:    Math.min(99, Math.max(20, b.passRate    + jitter(rateSeed,      8))),
    prevAvgScore:Math.min(99, Math.max(40, b.prevAvgScore + jitter(scoreSeed+1,  6))),
    prevPassRate:Math.min(99, Math.max(20, b.prevPassRate + jitter(rateSeed+1,   8))),
  }
}
