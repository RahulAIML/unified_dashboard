/**
 * field-map.ts — two-layer field registry (DB-1 fix).
 *
 * ─── Why two layers? ──────────────────────────────────────────────────────────
 *
 *  CORE fields   → used by KPI calculations and charts.
 *                  These are the only fields that affect dashboard numbers.
 *                  Must stay minimal and clean.
 *
 *  EXTRA fields  → used only by the drilldown / detail view.
 *                  Never included in aggregate queries or KPI math.
 *                  Captures qualitative data (strengths, improvements, etc.)
 *
 * ─── Why multiple aliases per key? ───────────────────────────────────────────
 *
 *  Different use cases write the same concept under different field_key names.
 *  E.g. "overall_score" (most UCs) vs "final_score" (some UCs).
 *  Using fieldInClause() catches all variants in a single SQL IN clause.
 *
 * ─── Adding a new alias ───────────────────────────────────────────────────────
 *  Append it to the matching array — no other file needs to change.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// ── CORE fields — KPIs and charts only ───────────────────────────────────────

/**
 * Fields used for aggregate queries: avg_score, pass_rate, total_sessions.
 * KPI logic MUST reference only these keys — never EXTRA_FIELD_MAP keys.
 */
export const CORE_FIELD_MAP = {
  /** Numeric score (0-10 or 0-100 — normalised via normalizeScore before use) */
  score:  ["overall_score", "final_score"] as const,
  /** Text result — pass/fail determination via isPassed() */
  result: ["overall_result", "status"]     as const,
} as const

export type CoreFieldKey = keyof typeof CORE_FIELD_MAP

// ── EXTRA fields — drill-down / detail view only ──────────────────────────────

/**
 * Fields fetched for the session detail view.
 * NEVER used in aggregate queries or KPI calculations.
 */
export const EXTRA_FIELD_MAP = {
  strengths:    ["strengths",        "general_strengths"]        as const,
  improvements: ["improvement_areas","general_improvement_areas"] as const,
} as const

export type ExtraFieldKey = keyof typeof EXTRA_FIELD_MAP

// ── SQL helpers ───────────────────────────────────────────────────────────────

type AnyFieldKey = CoreFieldKey | ExtraFieldKey
type AnyFieldMap = typeof CORE_FIELD_MAP & typeof EXTRA_FIELD_MAP

const COMBINED_MAP: AnyFieldMap = { ...CORE_FIELD_MAP, ...EXTRA_FIELD_MAP }

/**
 * Returns a SQL IN expression ready to embed in a WHERE / JOIN ON clause.
 *
 * @param key    Logical field name from either CORE or EXTRA map.
 * @param column SQL column reference (default "field_key").
 *
 * @example
 *   fieldInClause("score")
 *   // → "field_key IN ('overall_score','final_score')"
 *
 *   fieldInClause("result", "sc.field_key")
 *   // → "sc.field_key IN ('overall_result','status')"
 */
export function fieldInClause(key: AnyFieldKey, column = "field_key"): string {
  const aliases = COMBINED_MAP[key] as readonly string[]
  const quoted  = aliases.map((k) => `'${k}'`).join(", ")
  return `${column} IN (${quoted})`
}

/**
 * Returns the raw array of DB field_key strings for a logical field.
 * Useful when you need the values as an array (e.g. Set membership checks).
 */
export function fieldKeys(key: AnyFieldKey): readonly string[] {
  return COMBINED_MAP[key]
}

/**
 * Convenience: a flat Set of all CORE field_key strings.
 * Used in the drilldown UI to highlight KPI-relevant rows.
 */
export const CORE_FIELD_KEYS: ReadonlySet<string> = new Set([
  ...CORE_FIELD_MAP.score,
  ...CORE_FIELD_MAP.result,
])

export const SCORE_FIELD_KEYS: ReadonlySet<string> = new Set(CORE_FIELD_MAP.score)
export const RESULT_FIELD_KEYS: ReadonlySet<string> = new Set(CORE_FIELD_MAP.result)

/**
 * Convenience: a flat Set of all EXTRA field_key strings.
 * Used in the drilldown UI to label qualitative fields.
 */
export const EXTRA_FIELD_KEYS: ReadonlySet<string> = new Set([
  ...EXTRA_FIELD_MAP.strengths,
  ...EXTRA_FIELD_MAP.improvements,
])
