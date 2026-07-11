import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { isBancoOrg, resolveOrgType } from '../org-type'

// ── isBancoOrg ────────────────────────────────────────────────────────────────

describe('isBancoOrg', () => {
  beforeEach(() => {
    vi.resetModules()
  })
  afterEach(() => {
    delete process.env.BANCO_EMAIL_DOMAINS
  })

  it('returns false when BANCO_EMAIL_DOMAINS is not set', () => {
    delete process.env.BANCO_EMAIL_DOMAINS
    expect(isBancoOrg('user@bancoppel.com')).toBe(false)
  })

  it('returns false when BANCO_EMAIL_DOMAINS is empty string', () => {
    process.env.BANCO_EMAIL_DOMAINS = ''
    expect(isBancoOrg('user@bancoppel.com')).toBe(false)
  })

  it('returns true when email domain matches single configured domain', () => {
    process.env.BANCO_EMAIL_DOMAINS = 'bancoppel.com'
    expect(isBancoOrg('user@bancoppel.com')).toBe(true)
  })

  it('returns true when email domain matches one of multiple configured domains', () => {
    process.env.BANCO_EMAIL_DOMAINS = 'bancoppel.com,coppel.com'
    expect(isBancoOrg('employee@coppel.com')).toBe(true)
    expect(isBancoOrg('manager@bancoppel.com')).toBe(true)
  })

  it('returns false when email domain does not match any configured domain', () => {
    process.env.BANCO_EMAIL_DOMAINS = 'bancoppel.com,coppel.com'
    expect(isBancoOrg('user@gmail.com')).toBe(false)
    expect(isBancoOrg('user@rolplay.pro')).toBe(false)
  })

  it('is case-insensitive for both email and configured domains', () => {
    process.env.BANCO_EMAIL_DOMAINS = 'BancOppel.COM'
    expect(isBancoOrg('User@BANCOPPEL.COM')).toBe(true)
    expect(isBancoOrg('User@bancoppel.com')).toBe(true)
  })

  it('handles extra spaces around domains in env var', () => {
    process.env.BANCO_EMAIL_DOMAINS = ' bancoppel.com , coppel.com '
    expect(isBancoOrg('user@bancoppel.com')).toBe(true)
    expect(isBancoOrg('user@coppel.com')).toBe(true)
  })

  it('returns false for email with no @ symbol', () => {
    process.env.BANCO_EMAIL_DOMAINS = 'bancoppel.com'
    expect(isBancoOrg('notanemail')).toBe(false)
  })

  it('returns false for empty email string', () => {
    process.env.BANCO_EMAIL_DOMAINS = 'bancoppel.com'
    expect(isBancoOrg('')).toBe(false)
  })
})

// ── resolveOrgType ────────────────────────────────────────────────────────────

describe('resolveOrgType', () => {
  afterEach(() => {
    delete process.env.BANCO_EMAIL_DOMAINS
  })

  it("returns 'banco' when email matches Banco domain, regardless of customerId", async () => {
    process.env.BANCO_EMAIL_DOMAINS = 'bancoppel.com'
    expect(await resolveOrgType('user@bancoppel.com', 0)).toBe('banco')
    expect(await resolveOrgType('user@bancoppel.com', 5)).toBe('banco')
  })

  it("returns 'analytics' when customerId > 0 and not Banco", async () => {
    process.env.BANCO_EMAIL_DOMAINS = 'bancoppel.com'
    expect(await resolveOrgType('user@rolplay.pro', 3)).toBe('analytics')
    expect(await resolveOrgType('admin@hyqvia.com', 11)).toBe('analytics')
  })

  it("returns 'none' when not Banco and customerId is 0", async () => {
    process.env.BANCO_EMAIL_DOMAINS = 'bancoppel.com'
    expect(await resolveOrgType('newuser@gmail.com', 0)).toBe('none')
  })

  it("returns 'none' when BANCO_EMAIL_DOMAINS is not set and customerId is 0", async () => {
    delete process.env.BANCO_EMAIL_DOMAINS
    expect(await resolveOrgType('user@bancoppel.com', 0)).toBe('none')
  })

  it("'banco' takes priority over 'analytics' if a Banco user also has customerId > 0", async () => {
    process.env.BANCO_EMAIL_DOMAINS = 'bancoppel.com'
    expect(await resolveOrgType('user@bancoppel.com', 7)).toBe('banco')
  })
})
