/**
 * The journey's whole value is the ORDER, so that is what these pin down:
 * a tenant's subset must always read left-to-right in ecosystem sequence,
 * regardless of what order the modules endpoint happened to return them in.
 */
import { describe, it, expect } from 'vitest'
import { journeyStages, journeyPhaseGroups, hasJourney, JOURNEY_ORDER } from '../journey'
import type { Module } from '../types'

const ALL: Module[] = ['lms', 'coach', 'simulator', 'certification', 'second-brain']

describe('JOURNEY_ORDER', () => {
  it('follows the ecosystem sequence', () => {
    expect([...JOURNEY_ORDER]).toEqual([
      'lms', 'coach', 'simulator', 'certification', 'second-brain',
    ])
  })
})

describe('journeyStages', () => {
  it('returns every stage in order for a full tenant', () => {
    expect(journeyStages(ALL).map(s => s.module)).toEqual(ALL)
  })

  it('keeps canonical order even when the input is shuffled', () => {
    // /api/dashboard/modules orders its own output; the journey must not depend
    // on that, or a change there would silently reorder the diagram.
    const shuffled: Module[] = ['second-brain', 'simulator', 'lms', 'certification', 'coach']
    expect(journeyStages(shuffled).map(s => s.module)).toEqual(ALL)
  })

  it('preserves order and leaves no gap for a partial tenant', () => {
    const stages = journeyStages(['certification', 'simulator'])
    expect(stages.map(s => s.module)).toEqual(['simulator', 'certification'])
  })

  it('ignores duplicates', () => {
    const stages = journeyStages(['coach', 'coach', 'lms'])
    expect(stages.map(s => s.module)).toEqual(['lms', 'coach'])
  })

  it('returns nothing for a tenant with no modules', () => {
    expect(journeyStages([])).toEqual([])
  })

  it('gives every stage a detail link and a named progress metric', () => {
    for (const s of journeyStages(ALL)) {
      expect(s.href).toMatch(/^\//)
      // The rings measure different things per stage, so each must say which.
      expect(s.progressKey).toBeTruthy()
      expect(s.labelKey).toBeTruthy()
    }
  })
})

describe('hasJourney', () => {
  it('needs at least two stages', () => {
    expect(hasJourney([])).toBe(false)
    expect(hasJourney(['simulator'])).toBe(false)
    expect(hasJourney(['simulator', 'certification'])).toBe(true)
    expect(hasJourney(ALL)).toBe(true)
  })

  it('does not count a module that is not part of the journey', () => {
    // Guards against a future Module value silently enabling the nav entry.
    expect(hasJourney(['simulator', 'not-a-module' as Module])).toBe(false)
  })
})

describe('journeyPhaseGroups', () => {
  it('groups the two practice modules under one heading', () => {
    const groups = journeyPhaseGroups(journeyStages(ALL))
    expect(groups.map(g => g.phase)).toEqual([
      'cognitive', 'practice', 'validation', 'excellence',
    ])
    expect(groups[1].stages.map(s => s.module)).toEqual(['coach', 'simulator'])
  })

  it('omits phases the tenant has no module for', () => {
    const groups = journeyPhaseGroups(journeyStages(['lms', 'certification']))
    expect(groups.map(g => g.phase)).toEqual(['cognitive', 'validation'])
  })

  it('accounts for every stage exactly once', () => {
    const stages = journeyStages(ALL)
    const grouped = journeyPhaseGroups(stages).flatMap(g => g.stages)
    expect(grouped.map(s => s.module)).toEqual(stages.map(s => s.module))
  })
})
