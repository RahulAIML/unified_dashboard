/**
 * lib/demo/journey-bookends.ts — DEMO-ONLY mock data for the Journey's two
 * "bookend" stages: Initial Diagnostic (before the learning journey) and
 * Final Exam (after it).
 *
 * WHY THIS IS ITS OWN FILE, SEPARATE FROM lib/demo/engine.ts:
 * engine.ts's demo functions (demoOverview, demoLms, ...) mirror what the
 * REAL Rolplay SQL-backed APIs return for a real tenant -- they're a
 * stand-in for real data that genuinely exists elsewhere. A diagnostic/
 * final-exam data source does NOT exist anywhere in this platform yet
 * (confirmed: no such module, table, or endpoint). This file is the one
 * place that fact is true, so it can never be mistaken for "real data
 * pretending to look like SQL" -- it's explicitly, permanently mock, until
 * a real diagnostic endpoint exists.
 *
 * FUTURE MIGRATION: when a real diagnostic/final-exam data source exists,
 * only app/api/dashboard/journey-bookends/route.ts's real-mode branch needs
 * to change (call the real endpoint instead of returning null) -- this file
 * and the Journey UI (app/journey/page.tsx) do not need to change at all,
 * because both already consume the SAME JourneyBookend shape.
 */

export type JourneyBookendStatus = 'completed' | 'in_progress' | 'upcoming'

export interface JourneyBookend {
  kind: 'diagnostic' | 'final_exam'
  /** 0-10 scale, matching the platform's existing session-score conventions elsewhere. */
  score: number
  maxScore: number
  sessions: number
  /** YYYY-MM-DD */
  firstSessionDate: string
  status: JourneyBookendStatus
}

/**
 * Fixed, deterministic demo values (never randomized) -- a manager reading
 * this dashboard needs to be able to reference the exact same numbers every
 * time, e.g. when discussing them with a client, matching the platform's
 * existing "reproducible demo data" convention.
 */
export function demoJourneyBookends(): { diagnostic: JourneyBookend; finalExam: JourneyBookend } {
  return {
    diagnostic: {
      kind: 'diagnostic',
      score: 5.5,
      maxScore: 10,
      sessions: 15,
      firstSessionDate: '2026-08-05',
      status: 'completed',
    },
    finalExam: {
      kind: 'final_exam',
      score: 9.5,
      maxScore: 10,
      sessions: 2,
      firstSessionDate: '2026-10-25',
      status: 'completed',
    },
  }
}
