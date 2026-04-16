/**
 * solution-map.ts
 *
 * Maps dashboard solution filter names → real usecase_ids from the DB.
 *
 * Usecase IDs discovered from the production bridge (action=modules):
 *   323, 351, 363, 369, 381, 385, 389, 390, 391, 392, 394, 396, 397
 *
 * UC 401: discovered during DB audit (2026-04-16). Contains coaching-methodology
 * fields (evaluacion_metodologia_*, apertura_colaborador_*). 15 sessions — the
 * largest single dataset. Mapped to "coach" solution.
 *
 * Grouped into the five dashboard solutions by ID range / product area.
 * Update this map as new usecases are added to the platform.
 */

export type SolutionKey = "lms" | "coach" | "simulator" | "certification" | "second-brain"

export const SOLUTION_USECASE_MAP: Record<SolutionKey, number[]> = {
  lms:           [323, 351, 363],
  coach:         [369, 381, 385, 401],
  simulator:     [389, 390, 391],
  certification: [392, 394],
  "second-brain":[396, 397],
}

/**
 * Given a solution name, returns the corresponding usecase IDs.
 * Returns undefined (= no filter = all usecases) when solution is unknown/null.
 */
export function solutionToUsecaseIds(solution: string | null | undefined): number[] | undefined {
  if (!solution) return undefined
  return SOLUTION_USECASE_MAP[solution as SolutionKey] ?? undefined
}
