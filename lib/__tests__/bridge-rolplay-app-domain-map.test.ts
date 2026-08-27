/**
 * Regression coverage for BUILTIN_DOMAIN_MAP -- found live (2026-08-27) via a
 * direct r_user query that two large real clients (476 and 156 real users
 * respectively) were entirely missing from this map, so EVERY one of their
 * users got "You're not linked to any organization yet" on login. Reported
 * live by a real Armstrong Labs user (acevedorr@armstronglabs.com.mx,
 * client_id 33, confirmed real via r_user).
 */
import { describe, it, expect } from 'vitest'
import { resolveRolplayAppClientId } from '../bridge-rolplay-app'

describe('resolveRolplayAppClientId — domain map', () => {
  it('resolves armstronglabs.com.mx to client_id 33', () => {
    expect(resolveRolplayAppClientId('acevedorr@armstronglabs.com.mx')).toBe(33)
  })

  it('resolves procapslatam.com to client_id 40', () => {
    expect(resolveRolplayAppClientId('acarroll@procapslatam.com')).toBe(40)
  })

  it('is case-insensitive and trims whitespace, matching every other domain in the map', () => {
    expect(resolveRolplayAppClientId('  ACEVEDORR@ARMSTRONGLABS.COM.MX  ')).toBe(33)
  })

  it('still resolves the pre-existing mapped domains (no regression)', () => {
    expect(resolveRolplayAppClientId('adriana.losada@siigo.com')).toBe(29)
    expect(resolveRolplayAppClientId('adrian.heredia@arceralifesciences.com')).toBe(24)
    expect(resolveRolplayAppClientId('someone@takeda.com')).toBe(13)
    expect(resolveRolplayAppClientId('someone@besins-healthcare.com')).toBe(14)
    expect(resolveRolplayAppClientId('someone@rowe.com.do')).toBe(25)
  })

  it('still excludes the shared staff domain audioweb.com.mx (spans multiple unrelated clients)', () => {
    expect(resolveRolplayAppClientId('someone@audioweb.com.mx')).toBeNull()
  })

  it('returns null for an unmapped domain, never a fabricated client_id', () => {
    expect(resolveRolplayAppClientId('someone@totally-unmapped-company.com')).toBeNull()
  })
})
