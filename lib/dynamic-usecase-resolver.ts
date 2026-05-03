/**
 * dynamic-usecase-resolver.ts
 *
 * Replaces the hardcoded solution-map.ts for multi-tenant production use.
 *
 * ARCHITECTURE:
 *   DB sources  → coach, lms, simulator, certification
 *   API source  → second-brain (NEVER touches DB)
 *
 * RULES:
 *   ✔ Dynamically discovers usecases per customer from DB
 *   ✔ Classifies them using field-signature patterns + name hints
 *   ✔ Returns usecase IDs for the requested solution module
 *   ✔ Returns [] for second-brain (API-only — caller must not query DB)
 *   ✔ Returns undefined when no solution filter is requested (= no WHERE filter)
 *   ✔ Returns [-1] when a valid module has no usecases (→ SQL returns 0 rows)
 *   ✔ No hardcoded IDs anywhere
 */

import { bridgeDiscoverUsecaseFields } from './bridge-client'
import { buildDynamicModuleMap } from './usecase-classifier'
import type { UsecaseFields } from './usecase-classifier'

/** Recognised DB-backed solution keys */
const DB_SOLUTIONS = new Set(['coach', 'lms', 'simulator', 'certification'])

/**
 * Resolve which usecase IDs belong to `solution` for `customerId`.
 *
 * Return semantics:
 *   undefined  → no solution filter → caller omits usecase_id WHERE clause
 *   []         → second-brain requested → caller must NOT hit DB at all
 *   [-1]       → valid module but zero matching usecases → query returns 0 rows
 *   [n, …]     → the discovered usecase IDs for this module
 */
export async function resolveDynamicUsecaseIds(
  customerId: number,
  solution: string | null | undefined
): Promise<number[] | undefined> {
  // No filter requested — return all data for the customer
  if (!solution) return undefined

  // Second Brain is strictly API-only — never query the DB
  if (solution === 'second-brain') return []

  // Unknown/unrecognised solution key — no filter (safe fallback)
  if (!DB_SOLUTIONS.has(solution)) return undefined

  try {
    // ── Step 1+2: Discover active usecases + field signatures (spec query) ──
    const { usecases, fieldsByUsecase, metadata } =
      await bridgeDiscoverUsecaseFields(customerId)

    if (usecases.length === 0) {
      // No data at all for this customer — show empty dashboard
      return [-1]
    }

    // ── Step 3: Build UsecaseFields list for classifier ──────────────────────
    const metaMap = new Map(metadata.map(m => [m.id, m.usecase_name]))

    const usecaseFieldsList: UsecaseFields[] = usecases.map(uc => ({
      usecaseId:    Number(uc.usecase_id),
      usecaseName:  metaMap.get(Number(uc.usecase_id)) ?? null,
      fields:       fieldsByUsecase.get(Number(uc.usecase_id)) ?? [],
      sessionCount: Number(uc.sessions),
    }))

    // ── Step 4: Build dynamic module map (no hardcoded IDs) ──────────────────
    const moduleMap = buildDynamicModuleMap(usecaseFieldsList)

    // ── Step 5: Return IDs for the requested module ───────────────────────────
    const ids = moduleMap[solution as keyof typeof moduleMap] ?? []

    // Use sentinel -1 when module exists but has no matching usecases,
    // so the SQL returns 0 rows instead of accidentally returning all rows.
    return ids.length > 0 ? ids : [-1]
  } catch (err) {
    // Discovery failure → log and fall back to no filter (conservative)
    console.error('[resolveDynamicUsecaseIds] discovery failed:', err)
    return undefined
  }
}
