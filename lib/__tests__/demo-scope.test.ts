import { describe, it, expect, afterEach } from 'vitest'
import { isRolplayDemoTenant, useDemoData } from '../demo'
import { demoBusinessLines, demoOrganization, demoObjections, demoAccessStatus } from '../demo/engine'

const ORIGINAL_DEMO_DOMAINS = process.env.DEMO_DOMAINS
const ORIGINAL_DEMO_MODE = process.env.NEXT_PUBLIC_DEMO_MODE

afterEach(() => {
  if (ORIGINAL_DEMO_DOMAINS === undefined) delete process.env.DEMO_DOMAINS
  else process.env.DEMO_DOMAINS = ORIGINAL_DEMO_DOMAINS
  if (ORIGINAL_DEMO_MODE === undefined) delete process.env.NEXT_PUBLIC_DEMO_MODE
  else process.env.NEXT_PUBLIC_DEMO_MODE = ORIGINAL_DEMO_MODE
})

describe('demo scoping — Rolplay domains ONLY', () => {
  it('treats rolplay domains as demo tenants', () => {
    for (const e of ['sales@rolplay.ai', 'demo@rolplay.app', 'x@rolplay.net', 'y@rolplay.com']) {
      expect(isRolplayDemoTenant(e)).toBe(true)
    }
  })

  it('NEVER treats a real client as a demo tenant (no fake data for clients)', () => {
    for (const e of [
      'adriana.losada@siigo.com',   // rival client
      'user@takeda.com',
      'someone@coppel.com',
      'rep@sanfer.com.mx',
      'a@arceralifesciences.com',
      'b@rowe.com.do',
      'c@besins-healthcare.com',
      'd@gmail.com',
    ]) {
      expect(isRolplayDemoTenant(e)).toBe(false)
      expect(useDemoData(e)).toBe(false)
    }
  })

  it('is not fooled by lookalike domains', () => {
    expect(isRolplayDemoTenant('user@notrolplay.ai')).toBe(false)
    expect(isRolplayDemoTenant('user@rolplay.ai.evil.com')).toBe(false)
    expect(isRolplayDemoTenant('rolplay.ai@siigo.com')).toBe(false) // local part only
  })

  it('handles missing/blank emails safely', () => {
    expect(isRolplayDemoTenant(null)).toBe(false)
    expect(isRolplayDemoTenant(undefined)).toBe(false)
    expect(isRolplayDemoTenant('')).toBe(false)
    expect(isRolplayDemoTenant('no-at-sign')).toBe(false)
  })

  it('is case-insensitive and trims', () => {
    expect(isRolplayDemoTenant('  Sales@RolPlay.AI ')).toBe(true)
  })

  it('supports extra demo domains via env without a deploy', () => {
    process.env.DEMO_DOMAINS = 'partnerdemo.com'
    expect(isRolplayDemoTenant('x@partnerdemo.com')).toBe(true)
    expect(isRolplayDemoTenant('x@siigo.com')).toBe(false)
  })

  it('global NEXT_PUBLIC_DEMO_MODE still forces demo data for anyone', () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = 'true'
    expect(useDemoData('adriana.losada@siigo.com')).toBe(true)
  })
})

describe('demo generators produce data for every module', () => {
  const from = new Date('2026-01-01T00:00:00Z')
  const to   = new Date('2026-06-30T00:00:00Z')

  it('access status enables the whole ecosystem', () => {
    const a = demoAccessStatus()
    expect(a.hasAnyAccess).toBe(true)
    expect(a.hasCoachData).toBe(true)
    expect(a.hasSecondBrainData).toBe(true)
    expect(a.hasPharmaAccess).toBe(true)
    expect(a.hasRolplayAppAccess).toBe(true)
  })

  it('business lines are populated and sorted best-first', () => {
    const { data } = demoBusinessLines(from, to)
    expect(data.length).toBeGreaterThan(3)
    expect(data[0].avgScore).toBeGreaterThanOrEqual(data[data.length - 1].avgScore!)
    for (const l of data) {
      expect(l.name).toBeTruthy()
      expect(l.memberCount).toBeGreaterThan(0)
      expect(l.simCount).toBeGreaterThan(0)
    }
  })

  it('organization has admins, members and consistent totals', () => {
    const o = demoOrganization()
    expect(o.admins.length).toBeGreaterThan(0)
    expect(o.members.length).toBeGreaterThan(0)
    expect(o.totalMembers).toBe(o.members.length)
    expect(o.totalAdmins).toBe(o.admins.length)
    // every member is attached to a real admin
    const adminIds = new Set(o.admins.map(a => a.id))
    for (const m of o.members) expect(adminIds.has(m.adminId!)).toBe(true)
  })

  it('objections are populated, worst-first, with model + advisor answers', () => {
    const { data } = demoObjections(from, to)
    expect(data.length).toBeGreaterThan(3)
    expect(data[0].passRate).toBeLessThanOrEqual(data[data.length - 1].passRate)
    for (const o of data) {
      expect(o.objectionText).toBeTruthy()
      expect(o.modelAnswer).toBeTruthy()
      expect(o.topAnswers.length).toBeGreaterThan(0)
      expect(o.count).toBeGreaterThan(0)
    }
  })

  it('is deterministic for a given range (stable demos)', () => {
    expect(demoBusinessLines(from, to)).toEqual(demoBusinessLines(from, to))
    expect(demoObjections(from, to)).toEqual(demoObjections(from, to))
  })
})
