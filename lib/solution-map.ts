/**
 * solution-map.ts
 *
 * Maps dashboard solution filter names → real usecase_ids from the DB.
 *
 * Usecase IDs verified from coach_app.usecases (production, 2026-05-01):
 *
 *   ID  | Name                                | Solution
 *   ----|-------------------------------------|----------
 *    7  | HyQvia Coaching Representante Medico| coach
 *    9  | Coach HyQvia                        | coach
 *   10  | Coach Takeda Livtencity             | coach
 *   12  | Coach Takeda SNC (prueba)           | coach
 *   14  | Coach Livtencity Actualizado        | coach
 *   17  | Takeda Coach Exkruthera             | coach
 *   18  | Takeda Coach                        | coach
 *   19  | Takeda Coach Adcetris               | coach
 *   23  | Coach Chinoin Antifludes            | coach
 *   24  | Coach Reforzamiento HyQvia          | coach
 *   31  | Coach Entyvio                       | coach
 *   33  | (HyQvia Coach session — pending UC) | coach
 *   20  | Profuturo Afore                     | lms
 *   22  | Profuturo Afore Evaluador           | certification
 *   21  | Profuturo Afore Simulador           | simulator
 *   30  | Prueba Simulador Alejandro          | simulator
 *   26  | Coach Second Brain Exkruthera       | second-brain
 *   27  | Coach Second Brain HyQvia           | second-brain
 *   28  | Coach Second Brain Adcetris         | second-brain
 *   29  | Coach Second Brain Livtencity       | second-brain
 *   42  | (pending usecase)                   | coach
 *
 * Update this map as new usecases are added to the platform.
 */

export type SolutionKey = "lms" | "coach" | "simulator" | "certification" | "second-brain"

export const SOLUTION_USECASE_MAP: Record<SolutionKey, number[]> = {
  lms:           [20],
  coach:         [7, 9, 10, 12, 14, 17, 18, 19, 23, 24, 31, 33, 42],
  simulator:     [21, 30],
  certification: [22],
  "second-brain":[26, 27, 28, 29],
}

/**
 * Given a solution name, returns the corresponding usecase IDs.
 * Returns undefined (= no filter = all usecases) when solution is unknown/null.
 */
export function solutionToUsecaseIds(solution: string | null | undefined): number[] | undefined {
  if (!solution) return undefined
  return SOLUTION_USECASE_MAP[solution as SolutionKey] ?? undefined
}
