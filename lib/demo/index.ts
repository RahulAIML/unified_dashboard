/**
 * lib/demo/index.ts
 *
 * Central toggle for DEMO MODE.
 *
 * Set NEXT_PUBLIC_DEMO_MODE=true in .env.local to activate.
 * Works on both server (API routes) and client (UI indicators).
 *
 * To switch back to real APIs: remove the env var or set to 'false'.
 * No other code changes required.
 */

export const isDemoMode = (): boolean =>
  process.env.NEXT_PUBLIC_DEMO_MODE === 'true'

/**
 * Rolplay-only demo tenant.
 *
 * The commercial team needs ONE dashboard where every module (Overview, LMS,
 * Master Coach, Simulator, Certifier Coach, Second Brain) shows data, to
 * showcase the full ecosystem. That is served with artificial data and is
 * therefore restricted to Rolplay's OWN domains — never a real client, who must
 * only ever see their own real data.
 *
 * Extra domains can be added via DEMO_DOMAINS ("a.com,b.com") without a deploy.
 */
const BUILTIN_DEMO_DOMAINS = ['rolplay.ai', 'rolplay.app', 'rolplay.net', 'rolplay.com']

export function demoDomains(): string[] {
  const extra = (process.env.DEMO_DOMAINS ?? '')
    .split(',')
    .map(d => d.trim().toLowerCase())
    .filter(Boolean)
  return [...BUILTIN_DEMO_DOMAINS, ...extra]
}

/** True only for a Rolplay-domain login → serve the full 6-module demo. */
export function isRolplayDemoTenant(email: string | null | undefined): boolean {
  const domain = (email ?? '').toLowerCase().trim().split('@')[1]
  if (!domain) return false
  return demoDomains().includes(domain)
}

/** Demo data applies when the global flag is on OR the user is a Rolplay demo tenant. */
export function useDemoData(email: string | null | undefined): boolean {
  return isDemoMode() || isRolplayDemoTenant(email)
}
