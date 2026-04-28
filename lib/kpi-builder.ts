/**
 * kpi-builder.ts — single source of truth for all KPI math and data safety.
 *
 * Three responsibility layers:
 *  1. Safety helpers   — safeNumber, safeString (sanitise raw DB values)
 *  2. Normalisation    — normalizeScore, normalizeResult (standardise values)
 *  3. KPI calculation  — isPassed, computePassRate, buildKpiSummary
 *
 * APIs MUST NOT calculate KPIs directly — import from here only.
 */

// ── 1. Safety helpers ─────────────────────────────────────────────────────────

/**
 * Converts any raw DB value to a finite number, or null if conversion fails.
 *
 * @example
 *   safeNumber(8.5)    // → 8.5
 *   safeNumber("7")    // → 7
 *   safeNumber(null)   // → null
 *   safeNumber("abc")  // → null
 *   safeNumber(Infinity) // → null
 */
export function safeNumber(value: unknown): number | null {
  if (value === null || value === undefined) return null
  const n = typeof value === "number" ? value : Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Converts any raw DB value to a trimmed non-empty string, or null.
 *
 * @example
 *   safeString("Bueno")   // → "Bueno"
 *   safeString("  ")      // → null  (blank string)
 *   safeString(null)      // → null
 *   safeString(42)        // → "42"
 */
export function safeString(value: unknown): string | null {
  if (value === null || value === undefined) return null
  const s = String(value).trim()
  return s.length > 0 ? s : null
}

// ── 2. Normalisation ──────────────────────────────────────────────────────────

/**
 * Normalises a raw DB score to a 0–100 scale (DB-2 fix).
 *
 * Rules:
 *   ≤ 10  → treated as 0–10 range → multiplied × 10
 *   > 10  → already on 0–100 scale → returned as-is
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
  const n = safeNumber(score)
  if (n === null) return null
  if (n <= 10) return Math.round((n / 10) * 100 * 10) / 10  // 0-10 → 0-100
  return Math.round(n * 10) / 10                              // already 0-100
}

/**
 * Standardises a raw result string into a canonical pass/fail label.
 *
 * DB inconsistency: the same concept is stored as "Básico", "Bueno",
 * "Deficiente", "status", etc. across different use cases.
 *
 * Canonical output:
 *   "pass"    → session passed (anything except "Deficiente" / empty)
 *   "fail"    → session failed (explicitly "Deficiente")
 *   null      → no result recorded (excluded from pass-rate calculations)
 *
 * @example
 *   normalizeResult("Bueno")       // → "pass"
 *   normalizeResult("Básico")      // → "pass"
 *   normalizeResult("Deficiente")  // → "fail"
 *   normalizeResult(null)          // → null
 *   normalizeResult("")            // → null
 */
export function normalizeResult(
  result: string | null | undefined
): "pass" | "fail" | null {
  const s = safeString(result)
  if (s === null) return null
  return s === "Deficiente" ? "fail" : "pass"
}

// ── 3. KPI calculation ────────────────────────────────────────────────────────

/**
 * Returns true when a raw result string counts as a passing grade.
 * A session is failed ONLY when result is explicitly "Deficiente".
 * null / empty strings are excluded from pass-rate counts entirely.
 *
 * @example
 *   isPassed("Bueno")       // → true
 *   isPassed("Básico")      // → true
 *   isPassed("Deficiente")  // → false
 *   isPassed(null)          // → false  (excluded, not counted as fail)
 */
export function isPassed(result: string | null | undefined): boolean {
  const s = safeString(result)
  if (s === null) return false
  return s !== "Deficiente"
}

/**
 * Computes pass rate as a 0–100 percentage (1 decimal place).
 * Returns null when there are no result records to evaluate.
 *
 * @param passed          Count of sessions with a passing result.
 * @param totalWithResult Count of sessions that have ANY result value.
 *
 * @example
 *   computePassRate(7, 10)  // → 70.0
 *   computePassRate(0, 0)   // → null
 */
export function computePassRate(
  passed:          number,
  totalWithResult: number
): number | null {
  if (totalWithResult <= 0) return null
  return Math.round((passed / totalWithResult) * 100 * 10) / 10
}

// ── 4. KPI summary builder ────────────────────────────────────────────────────

export interface KpiSummary {
  total_sessions:  number
  avg_score:       number | null   // normalised to 0-100
  pass_rate:       number | null   // 0-100 %
  passed_sessions: number
}

/**
 * Assembles a standard KPI summary from raw aggregate values.
 * Applies normalizeScore to rawAvg automatically.
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

// ── KPI deltas (current vs previous) ─────────────────────────────────────────

export type DeltaDirection = "up" | "down" | "flat"

/**
 * Computes % change between current and prior period.
 * Returns 0 when prev is null/0 or current is null.
 */
export function calcDeltaPct(
  current: number | null | undefined,
  prev:    number | null | undefined,
  decimals = 0
): number {
  const c = safeNumber(current)
  const p = safeNumber(prev)
  if (c === null || p === null || p === 0) return 0
  const raw = ((c - p) / Math.abs(p)) * 100
  const factor = Math.pow(10, Math.max(0, decimals))
  return Math.round(raw * factor) / factor
}

export function deltaDirection(deltaPct: number): DeltaDirection {
  if (deltaPct > 0) return "up"
  if (deltaPct < 0) return "down"
  return "flat"
}

/**
 * Estimates prior passed sessions from (total, passRate%).
 * Centralised here so pages don't duplicate KPI logic.
 */
export function estimatePassedSessions(
  totalEvaluations: number | null | undefined,
  passRatePct:      number | null | undefined
): number {
  const total = safeNumber(totalEvaluations) ?? 0
  const pr    = safeNumber(passRatePct) ?? 0
  if (total <= 0 || pr <= 0) return 0
  return Math.round((total * pr) / 100)
}

// ── 5. Module-specific KPI labels ─────────────────────────────────────────────

export interface ModuleKpiConfig {
  module: string
  labels: {
    metric1: string
    metric2: string
    metric3: string
    metric4?: string
  }
}

/**
 * Per-module KPI label configuration
 * Ensures each module shows correct labels (not generic "Certified Users" everywhere)
 */
export const MODULE_KPI_CONFIG: Record<string, ModuleKpiConfig> = {
  'overview': {
    module: 'overview',
    labels: {
      metric1: 'Practice Sessions',
      metric2: 'Avg Session Score',
      metric3: 'Overall Pass Rate',
      metric4: 'Certified Users',
    },
  },
  'coach': {
    module: 'coach',
    labels: {
      metric1: 'Practice Sessions',
      metric2: 'Successful Sessions',  // Changed from "Certified Users"
      metric3: 'Avg Session Score',
      metric4: 'Session Count',
    },
  },
  'simulator': {
    module: 'simulator',
    labels: {
      metric1: 'Total Scenarios',
      metric2: 'Completed Scenarios',  // Changed from "Certified Users"
      metric3: 'Avg Scenario Score',
      metric4: 'Scenario Count',
    },
  },
  'certification': {
    module: 'certification',
    labels: {
      metric1: 'Candidates Evaluated',
      metric2: 'Certified Users',  // Keep as-is
      metric3: 'Avg Certification Score',
      metric4: 'Certification Rate',
    },
  },
  'lms': {
    module: 'lms',
    labels: {
      metric1: 'Active Learners',     // Fixed from double-count
      metric2: 'Course Completion %',
      metric3: 'Avg Quiz Score',
      metric4: 'Modules Completed',
    },
  },
  'second-brain': {
    module: 'second-brain',
    labels: {
      metric1: 'Total Interactions',
      metric2: 'Active Knowledge Seekers',
      metric3: 'Avg Relevance Score',
      metric4: 'Documents Indexed',
    },
  },
}

/**
 * Get KPI labels for a specific module
 * Falls back to overview labels if module not found
 */
export function getModuleKpiLabels(module: string | null | undefined): ModuleKpiConfig['labels'] {
  if (!module) return MODULE_KPI_CONFIG['overview'].labels
  const config = MODULE_KPI_CONFIG[module]
  return config ? config.labels : MODULE_KPI_CONFIG['overview'].labels
}

export interface BuildKpiCardInput<TLabelKey extends string = string> {
  label: string
  labelKey: TLabelKey
  value: number | string
  prevValue?: number | string | null
  unit?: string
  tier: "A" | "B"
  decimals?: number
}

/**
 * Builds a KPI card with a delta% computed via calcDeltaPct.
 * Centralised here to avoid pages duplicating delta math / rounding rules.
 */
export function buildKpiCard<TLabelKey extends string = string>(
  input: BuildKpiCardInput<TLabelKey>
) {
  const decimals = input.decimals ?? 0
  const delta = calcDeltaPct(
    typeof input.value === "number" ? input.value : safeNumber(input.value),
    typeof input.prevValue === "number" ? input.prevValue : safeNumber(input.prevValue),
    decimals
  )

  return {
    label:    input.label,
    labelKey: input.labelKey,
    value:    input.value,
    delta,
    unit:     input.unit,
    tier:     input.tier,
  }
}
