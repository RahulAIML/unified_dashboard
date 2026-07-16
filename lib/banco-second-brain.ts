/**
 * banco-second-brain.ts
 *
 * Banco-domain orgs (coppel, bancoppel — see BANCO_EMAIL_DOMAINS) do NOT have
 * rows in coach_app.coach_users, so the SQL banco pipeline
 * (bridge-banco-analytics.ts) returns empty for them. Their real data lives in
 * Second Brain (coaching sessions, members, message logs). This module routes
 * banco orgs to that Second Brain data instead.
 *
 * Admin-email resolution tries candidates in order and returns the FIRST that
 * actually resolves upstream.
 *
 * CONVENTION (confirmed against the live API): every Second Brain organization's
 * admin account is provisioned as `admin1@{company-domain}` — e.g. Coppel's is
 * admin1@coppel.com. This is a genuine self-service pattern: any NEW company
 * onboarded into Second Brain resolves automatically the moment their own
 * admin1@{domain} account exists — no code change, no env var, no per-tenant
 * hardcoding required.
 *
 * BUG FIXED (previous version): a hardcoded env fallback (SECOND_BRAIN_ADMIN_EMAIL
 * = admin1@coppel.com) was offered as a candidate for every user. Any tenant
 * whose own derived address didn't yet resolve (i.e. almost everyone, since
 * Coppel is so far the only company actually provisioned) silently fell
 * through to that fallback and received COPPEL's real Second Brain profile —
 * cross-tenant data exposure. The fix below derives admin1@{their-own-domain}
 * for every tenant and stops there — no shared fallback of any kind, so one
 * tenant's data can never stand in for another's.
 */

import { fetchSecondBrainProfile, computeSecondBrainKpis, type SecondBrainProfile } from './second-brain-api'
import type { OverviewApiResponse } from './types'

const GENERIC_DOMAINS = new Set([
  'gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com',
  'icloud.com', 'protonmail.com', 'live.com', 'aol.com',
])

/**
 * Ordered, de-duped list of admin emails to try for a user:
 *   1. explicit per-tenant override (tenant_integrations table) — for the rare
 *      org whose admin account doesn't follow the admin1@{domain} convention
 *   2. derived admin1@{company-domain} — the real, general provisioning pattern
 *
 * No global env fallback: each tenant only ever resolves to ITS OWN Second
 * Brain org (or none at all), never another tenant's.
 */
export async function secondBrainAdminCandidates(
  email: string,
  customerId: number,
): Promise<string[]> {
  const candidates: string[] = []

  try {
    const { getTenantIntegration } = await import('./db-tenant-integrations')
    const integration = await getTenantIntegration(customerId)
    if (integration?.second_brain_admin_email) candidates.push(integration.second_brain_admin_email)
  } catch {
    // non-fatal — fall through to the derived candidate
  }

  const domain = email.split('@')[1]?.toLowerCase()
  if (domain && !GENERIC_DOMAINS.has(domain)) candidates.push(`admin1@${domain}`)

  // De-dupe, preserve order.
  const seen = new Set<string>()
  return candidates.filter((c) => {
    const k = c.toLowerCase().trim()
    if (!k || seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** First Second Brain profile that resolves for this user, or null. */
export async function resolveSecondBrainProfile(
  email: string,
  customerId: number,
): Promise<{ profile: SecondBrainProfile; adminEmail: string } | null> {
  for (const adminEmail of await secondBrainAdminCandidates(email, customerId)) {
    const profile = await fetchSecondBrainProfile(adminEmail).catch(() => null)
    if (profile) return { profile, adminEmail }
  }
  return null
}

const EMPTY_OVERVIEW: OverviewApiResponse = {
  totalEvaluations: 0, prevTotalEvaluations: 0,
  avgScore: null, prevAvgScore: null,
  passRate: null, prevPassRate: null,
  passedEvaluations: 0,
}

/**
 * Banco Overview, sourced from Second Brain. Second Brain has no per-session
 * score/pass concept, so avgScore/passRate are honestly null — the headline
 * metric is coaching sessions (the org's "sessions"). Rich member/message
 * detail lives on the dedicated Second Brain page.
 */
export async function bancoOverviewFromSecondBrain(
  email: string,
  customerId: number,
): Promise<OverviewApiResponse> {
  const resolved = await resolveSecondBrainProfile(email, customerId)
  if (!resolved) return EMPTY_OVERVIEW

  const stats = (resolved.profile.stats ?? {}) as Record<string, unknown>
  const kpis = computeSecondBrainKpis(resolved.profile)

  // Coaching sessions is the closest analog to "sessions/evaluations" for a
  // Second Brain org; fall back to message logs, then member count, so the
  // headline is never a misleading zero when the org clearly has activity.
  const coachingSessions = Number(stats.total_coaching_sessions ?? 0)
  const total = coachingSessions || kpis.totalConversations || kpis.totalMembers

  return {
    totalEvaluations: total,
    avgScore: null,
    passRate: null,
    passedEvaluations: 0,
    prevTotalEvaluations: 0,
    prevAvgScore: null,
    prevPassRate: null,
  }
}
