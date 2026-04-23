/**
 * kpi-builder.ts — single source of truth for all KPI math.
 *
 * Import these functions everywhere KPI values are calculated.
 * Never duplicate these formulas in routes, pages, or data-provider.
 */

// ── Score normalisation ───────────────────────────────────────────────────────

/**
 * Normalises a raw DB score to a 0–100 scale.
 *
 * Rules (DB-2 resolution):
 *   ≤ 10  → treated as 0–10 range  → multiply × 10
 *   > 10  → already on 0–100 scale → return as-is
 *   null / non-finite → null
 *
 * @example
 *   normalizeScore(8.5)   // → 85
 *   normalizeScore(72)    // → 72
 *   normalizeScore(null)  // → null
 */
export function normalizeScore(
  score: number | string | null | undefined
): number | null {
  if (score === null || score === undefined) return null
  const n = typeof score === "string" ? Number(score) : score
  if (!Number.isFinite(n)) return null
  if (n <= 10) return Math.round((n / 10) * 100 * 10) / 10   // 0-10 → 0-100
  return Math.round(n * 10) / 10                              // already 0-100
}

// ── Pass / fail determination ─────────────────────────────────────────────────

/**
 * Returns true when an overall_result / status value counts as a passing grade.
 *
 * A session is considered failed ONLY when result is explicitly "Deficiente".
 * null / empty strings are excluded from pass-rate counts entirely.
 *
 * @example
 *   isPassed("Bueno")       // → true
 *   isPassed("Básico")      // → true
 *   isPassed("Deficiente")  // → false
 *   isPassed(null)          // → false  (excluded, not failed)
 */
export function isPassed(result: string | null | undefined): boolean {
  if (!result || result.trim() === "") return false
  return result.trim() !== "Deficiente"
}

// ── Pass rate ─────────────────────────────────────────────────────────────────

/**
 * Computes pass rate as a 0–100 percentage (1 decimal place).
 * Returns null when there are no result records to evaluate.
 *
 * @param passed         Count of sessions that passed.
 * @param totalWithResult Count of sessions that have ANY result value.
 *
 * @example
 *   computePassRate(7, 10)  // → 70.0
 *   computePassRate(0, 0)   // → null
 */
export function computePassRate(
  passed: number,
  totalWithResult: number
): number | null {
  if (totalWithResult <= 0) return null
  return Math.round((passed / totalWithResult) * 100 * 10) / 10
}

// ── KPI summary builder ───────────────────────────────────────────────────────

export interface KpiSummary {
  total_sessions:  number
  avg_score:       number | null   // normalised to 0-100
  pass_rate:       number | null   // 0-100 %
  passed_sessions: number
}

/**
 * Assembles a standard KPI summary from raw aggregate values.
 * Applies normaliseScore to rawAvg before storing.
 */
export function buildKpiSummary(
  total:           number,
  rawAvg:          number | null,
  passed:          number,
  totalWithResult: number
): KpiSummary {
  return {
    total_sessions:  total,
    avg_score:       normalizeScore(rawAvg),
    pass_rate:       computePassRate(passed, totalWithResult),
    passed_sessions: passed,
  }
}
