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
 * actually resolves upstream. The env fallback (SECOND_BRAIN_ADMIN_EMAIL) is a
 * REAL organization's admin address (today: admin1@coppel.com) — it must only
 * ever be offered as a candidate for that same organization's own users
 * (banco-domain users), never as a blanket last resort for every tenant.
 *
 * BUG FIXED: previously the env fallback was pushed unconditionally for every
 * user. A client whose own admin@{domain} didn't resolve in Second Brain (i.e.
 * almost every non-banco tenant) fell through to the fallback and silently
 * received Coppel's real Second Brain profile as if it were their own —
 * cross-tenant data exposure. Now the fallback is scoped to isBancoOrg(email).
 */

import { fetchSecondBrainProfile, computeSecondBrainKpis, type SecondBrainProfile } from './second-brain-api'
import { isBancoOrg } from './org-type'
import type { OverviewApiResponse } from './types'

const GENERIC_DOMAINS = new Set([
  'gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.com',
  'icloud.com', 'protonmail.com', 'live.com', 'aol.com',
])

/**
 * Ordered, de-duped list of admin emails to try for a user:
 *   1. explicit per-tenant integration (tenant_integrations table)
 *   2. derived admin@{company-domain}
 *   3. env global fallback (SECOND_BRAIN_ADMIN_EMAIL)
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
    // non-fatal — fall through to derived/env
  }

  const domain = email.split('@')[1]?.toLowerCase()
  if (domain && !GENERIC_DOMAINS.has(domain)) candidates.push(`admin@${domain}`)

  // Scoped fallback: only offer the env default to the organization it
  // actually belongs to (banco-domain users). Never a blanket default for
  // other tenants — that would leak Coppel's real data to them.
  if (isBancoOrg(email) && process.env.SECOND_BRAIN_ADMIN_EMAIL) {
    candidates.push(process.env.SECOND_BRAIN_ADMIN_EMAIL)
  }

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
