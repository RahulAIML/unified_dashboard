/**
 * usecase-classifier.ts - Dynamic usecase classification based on real data patterns
 * 
 * Rules derived from production database analysis:
 * - Uses field patterns to classify when name is missing
 * - Separates Second Brain (API-only) from DB analytics
 * - No hardcoded IDs - fully dynamic
 */

import type { Module } from './types'

export interface UsecaseClassification {
  usecaseId: number
  module: Module
  confidence: 'high' | 'medium' | 'low'
  reason: string
}

export interface UsecaseFields {
  usecaseId: number
  usecaseName: string | null
  fields: string[]
  sessionCount: number
}

/**
 * Classify a usecase based on name and field patterns
 * Works even when usecase metadata is missing (orphaned data)
 */
export function classifyUsecase(
  usecaseId: number,
  usecaseName: string | null,
  fields: string[]
): { module: Module; confidence: 'high' | 'medium' | 'low'; reason: string } {
  const name = usecaseName?.toLowerCase() || ''
  const fieldSet = new Set(fields)

  // Rule 1: Second Brain - STRICTLY API-ONLY
  // If name contains "Second Brain", it MUST be handled via API, not DB
  if (name.includes('second brain')) {
    return {
      module: 'second-brain',
      confidence: 'high',
      reason: 'Name contains "Second Brain" - handled via API only'
    }
  }

  // Rule 2: Certification - has pass/fail or certification patterns
  const hasPassPattern = fieldSet.has('passed_flag') || 
                         fieldSet.has('certification_status') ||
                         fieldSet.has('exam_result') ||
                         fieldSet.has('pass_rate')
  const isCertificationName = name.includes('evaluador') || 
                               name.includes('certification') || 
                               name.includes('exam')
  
  if (hasPassPattern || isCertificationName) {
    return {
      module: 'certification',
      confidence: hasPassPattern ? 'high' : 'medium',
      reason: hasPassPattern ? 'Has certification/pass fields' : 'Name suggests certification'
    }
  }

  // Rule 3: Simulator - from name
  if (name.includes('simulador') || name.includes('simulator')) {
    return {
      module: 'simulator',
      confidence: 'high',
      reason: 'Name contains simulator indicator'
    }
  }

  // Rule 4: LMS - from name
  if (name.includes('lms') || name.includes('learning') || name.includes('course')) {
    return {
      module: 'lms',
      confidence: 'high',
      reason: 'Name contains LMS indicator'
    }
  }

  // Rule 5: Coach - field patterns
  // Has question/answer/score pattern
  const hasQuestions = fields.some(f => /^question_\d+$/.test(f)) ||
                       fields.some(f => /^q\d+_question$/.test(f))
  const hasAnswers = fields.some(f => /^answer_\d+$/.test(f)) ||
                     fields.some(f => /^q\d+_answer$/.test(f))
  const hasScores = fields.some(f => /^score_\d+$/.test(f)) ||
                    fields.some(f => /^q\d+_score$/.test(f))
  
  // Has coaching-specific fields
  const hasCoachingFields = fieldSet.has('overall_assessment') ||
                            fieldSet.has('recommendations') ||
                            fieldSet.has('strengths') ||
                            fieldSet.has('weaknesses') ||
                            fieldSet.has('key_learnings') ||
                            fieldSet.has('justification_1') ||
                            fieldSet.has('improvement_area')

  if ((hasQuestions && hasAnswers) || (hasScores && hasCoachingFields)) {
    return {
      module: 'coach',
      confidence: 'high',
      reason: `Has coaching pattern: questions=${hasQuestions}, answers=${hasAnswers}, scores=${hasScores}, coachingFields=${hasCoachingFields}`
    }
  }

  // Rule 6: Coach - medium confidence (has some coaching indicators)
  if (hasCoachingFields || hasScores || fieldSet.has('overall_score')) {
    return {
      module: 'coach',
      confidence: 'medium',
      reason: 'Has some coaching assessment fields'
    }
  }

  // Fallback - default to coach (most common module)
  return {
    module: 'coach',
    confidence: 'low',
    reason: 'No clear patterns - defaulting to coach'
  }
}

/**
 * Build dynamic module mapping from database
 */
export function buildDynamicModuleMap(usecaseFields: UsecaseFields[]): {
  coach: number[]
  lms: number[]
  simulator: number[]
  certification: number[]
  'second-brain': number[]  // Should be empty - API-only
} {
  const mapping = {
    coach: [] as number[],
    lms: [] as number[],
    simulator: [] as number[],
    certification: [] as number[],
    'second-brain': [] as number[]
  }

  for (const uc of usecaseFields) {
    const classification = classifyUsecase(uc.usecaseId, uc.usecaseName, uc.fields)
    
    // Skip Second Brain usecases - they are API-only
    if (classification.module === 'second-brain') {
      continue
    }
    
    mapping[classification.module].push(uc.usecaseId)
  }

  return mapping
}

/**
 * Get usecase IDs for a specific module
 */
export function getUsecaseIdsForModule(
  module: Module,
  usecaseFields: UsecaseFields[]
): number[] {
  if (module === 'second-brain') {
    return [] // Second Brain is API-only
  }

  const mapping = buildDynamicModuleMap(usecaseFields)
  return mapping[module]
}

/**
 * Check if usecase should use API (Second Brain) or DB
 */
export function isApiOnlyUsecase(usecaseName: string | null): boolean {
  if (!usecaseName) return false
  return usecaseName.toLowerCase().includes('second brain')
}

/**
 * Filter out API-only usecases from DB query results
 */
export function filterDbOnlyUsecases(usecaseFields: UsecaseFields[]): UsecaseFields[] {
  return usecaseFields.filter(uc => !isApiOnlyUsecase(uc.usecaseName))
}
