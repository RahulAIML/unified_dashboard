/**
 * lib/journey.ts — the Rolplay solution journey.
 *
 * The ecosystem is a left-to-right progression, not a flat list of modules:
 * knowledge is adopted (LMS), practised (Master Coach, Simulator), validated
 * (Certifier Coach), then sustained in the field (Second Brain). Learners are
 * assigned work in that order, so the dashboard should read in that order too.
 *
 * A client may hold any SUBSET of these. The subset is never reordered and gaps
 * are never filled in — a tenant with only Simulator + Certifier Coach sees
 * exactly those two, in this sequence.
 *
 * IMPORTANT — what this view does NOT claim. Each stage reports its OWN real
 * numbers. It is not a per-learner funnel: LMS learners are LearnWorlds user IDs
 * while practice/validation learners are bridge members, and there is no
 * verified identity join between those systems. Presenting stage-to-stage
 * drop-off would imply a join we cannot substantiate, so every figure here is
 * scoped to its own stage and labelled with its own meaning.
 *
 * SOURCE NOTE: rolplay_app's `r_simulator.category` has four values — COACH,
 * SIM, SEGMENT and a second-brain one. The fourth is deliberately IGNORED:
 * Second Brain data comes exclusively from its own token-authenticated API,
 * which is the verified source. Do not wire the category variant in.
 */

import type { Module } from './types'
import type { TranslationKey } from './translations'

/** Which phase of the journey a module belongs to (the diagram's headings). */
export type JourneyPhase =
  | 'cognitive'   // Aprendizaje Cognitivo
  | 'practice'    // Aprendizaje práctico
  | 'validation'  // Validación de conocimiento
  | 'excellence'  // Excelencia en ventas

export interface JourneyStage {
  module: Module
  phase: JourneyPhase
  /** Module display name — reuses the sidebar's nav labels so naming stays in sync. */
  labelKey: TranslationKey
  phaseKey: TranslationKey
  /** Where the stage's full detail lives. */
  href: string
  /**
   * What this stage's progress bar measures. Each stage measures a DIFFERENT
   * thing, so the UI must label it rather than implying one shared scale.
   */
  progressKey: TranslationKey
}

/**
 * Canonical order. Index in this array IS the journey position — do not sort
 * stages anywhere else, derive from here.
 */
const STAGES: readonly JourneyStage[] = [
  {
    module: 'lms',
    phase: 'cognitive',
    labelKey: 'navLms',
    phaseKey: 'journeyPhaseCognitive',
    href: '/lms',
    progressKey: 'completionRate',
  },
  {
    module: 'coach',
    phase: 'practice',
    labelKey: 'navCoach',
    phaseKey: 'journeyPhasePractice',
    href: '/coach',
    progressKey: 'colPassRate',
  },
  {
    module: 'simulator',
    phase: 'practice',
    labelKey: 'navSimulator',
    phaseKey: 'journeyPhasePractice',
    href: '/simulator',
    progressKey: 'colPassRate',
  },
  {
    module: 'certification',
    phase: 'validation',
    labelKey: 'navCertification',
    phaseKey: 'journeyPhaseValidation',
    href: '/certification',
    progressKey: 'colPassRate',
  },
  {
    module: 'second-brain',
    phase: 'excellence',
    labelKey: 'navSecondBrain',
    phaseKey: 'journeyPhaseExcellence',
    href: '/second-brain',
    progressKey: 'journeyActiveMembers',
  },
] as const

export const JOURNEY_ORDER: readonly Module[] = STAGES.map(s => s.module)

/**
 * The tenant's stages, in journey order.
 *
 * Filters STAGES by what the tenant has rather than iterating the caller's list,
 * so an out-of-order or duplicated input cannot change the sequence.
 */
export function journeyStages(available: readonly Module[]): JourneyStage[] {
  const has = new Set(available)
  return STAGES.filter(s => has.has(s.module))
}

/**
 * A journey needs at least two stages to be a journey. With one service there is
 * no progression to show, so the nav entry is hidden rather than leading to a
 * page with a single lonely card.
 */
export function hasJourney(available: readonly Module[]): boolean {
  return journeyStages(available).length >= 2
}

/** Contiguous runs of the same phase, for drawing the diagram's phase headings. */
export function journeyPhaseGroups(
  stages: readonly JourneyStage[],
): { phase: JourneyPhase; phaseKey: TranslationKey; stages: JourneyStage[] }[] {
  const groups: { phase: JourneyPhase; phaseKey: TranslationKey; stages: JourneyStage[] }[] = []
  for (const s of stages) {
    const last = groups[groups.length - 1]
    if (last && last.phase === s.phase) last.stages.push(s)
    else groups.push({ phase: s.phase, phaseKey: s.phaseKey, stages: [s] })
  }
  return groups
}
