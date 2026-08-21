/**
 * data-sources.ts
 *
 * Multi-source data-access layer for the dashboard's Overview endpoint.
 *
 * Rolplay App SQL is the PRIMARY source wherever real data exists for a
 * user's identity: resolveDataSources always attempts to resolve it FIRST,
 * regardless of which pipeline lib/org-type.ts's resolveOrgType assigned as
 * the user's baseline experience. Existing single-source connectors
 * (pharma, coach_app_sql, banco) are untouched and remain the fallback/
 * secondary path -- resolveOrgType still decides which BASE pipeline a
 * user's dashboard is built from; this module only adds a second, optional
 * source on top when one genuinely resolves for the same identity.
 *
 * Scope: Overview only (the tenant-wide aggregate), matching the one
 * proven real-world case (M8) where a single identity has genuinely real,
 * disjoint activity in two sources at once -- verified live: 85/92
 * rolplay_app_sql client_id=24 users share M8's exact mapped pharma domain
 * (arceralifesciences.com). Module-scoped pages (Coach/Simulador/etc.) keep
 * their existing, already-verified single-source scope; composing there
 * has no supporting evidence and risks conflating two different products'
 * module boundaries.
 *
 * No new SQL access, no new credentials: every fetch here goes through the
 * already-hardened connectors (lib/bridge-rolplay-app.ts,
 * lib/bridge-pharma-analytics.ts), which own tenant isolation, auth, and
 * the read-only SQL guard. This module only orders and composes their
 * outputs.
 */
import { resolveRolplayAppAccess, rolplayAppOverview, mergeOverviewSources } from './bridge-rolplay-app'
import { pharmaDashboardOverview } from './bridge-pharma-analytics'
import type { OverviewApiResponse } from './types'
import type { PharmaTenant } from './pharma-tenant'

export type DataSource =
  | { kind: 'rolplay-app-sql'; clientId: number }
  | { kind: 'pharma'; tenant: PharmaTenant }

export interface ComposedOverview {
  data: OverviewApiResponse
  /** e.g. "rolplay-app-24+pharma-m8", or just "pharma-m8" when no secondary source resolves. */
  source: string
}

/**
 * Resolves every REAL data source available for this identity, ordered
 * with rolplay_app_sql first when it resolves -- "primary" here means
 * "checked and preferred first when composing", not "the only source
 * used": `pharmaTenant` (the base pipeline resolveOrgType already picked
 * for this user) is always included too, since it's how existing pharma
 * tenants keep working exactly as before when no secondary source exists.
 *
 * Uses resolveRolplayAppAccess (not just a domain match) -- it verifies
 * the email is a REAL r_user of that client, preserving tenant isolation
 * the same way every other access grant in this codebase does. A domain
 * squatter never gets composed in.
 *
 * `solution` set (a module-scoped request -- Coach/Simulador/etc.) SKIPS
 * resolving a secondary source entirely: those tabs keep their existing,
 * already-verified single-source (pharma) scope, both to guarantee a
 * module page can never silently switch data source and to avoid an
 * unnecessary live SQL round trip on every module-tab load, since the
 * result would never be used anyway.
 */
export async function resolveDataSources(
  email: string,
  pharmaTenant: PharmaTenant,
  solution: string | null,
): Promise<DataSource[]> {
  if (solution) return [{ kind: 'pharma', tenant: pharmaTenant }]

  const sources: DataSource[] = []
  const clientId = await resolveRolplayAppAccess(email)
  if (clientId) sources.push({ kind: 'rolplay-app-sql', clientId })
  sources.push({ kind: 'pharma', tenant: pharmaTenant })
  return sources
}

async function fetchOne(
  source: DataSource,
  range: { fromIso: string; toIso: string; prevFromIso: string; prevToIso: string },
  solution: string | null,
): Promise<{ data: OverviewApiResponse; label: string }> {
  if (source.kind === 'rolplay-app-sql') {
    // rolplay_app_sql computes its own previous-period window internally
    // (rolplayAppOverview's own -1ms boundary logic) -- only the current
    // range is passed through, matching every other call site of this
    // function elsewhere in the codebase.
    const data = await rolplayAppOverview(source.clientId, { fromIso: range.fromIso, toIso: range.toIso }, solution)
    return { data, label: `rolplay-app-${source.clientId}` }
  }
  const data = await pharmaDashboardOverview(source.tenant, {
    fromIso: range.fromIso, toIso: range.toIso,
    prevFromIso: range.prevFromIso, prevToIso: range.prevToIso,
    solution,
  })
  return { data, label: `pharma-${source.tenant}` }
}

/**
 * Fetches Overview data across every resolved source, composing a second
 * real source in when one exists. Returns null only when `sources` is
 * empty (the caller has nothing to show at all).
 *
 * Trusts `sources` completely for what to compose -- resolveDataSources is
 * the single place that decides a module-scoped request gets exactly one
 * (pharma) source, so this function never needs its own `solution` special
 * case to stay correct; passing more than one source here always means
 * "compose", by construction. An empty dataset from either source degrades
 * safely: rolplayAppOverview and pharmaDashboardOverview both already
 * return null (not 0/false) for every field when a source has no real data
 * in range, and mergeOverviewSources already excludes a null rate from its
 * weighted average rather than treating it as zero -- this function adds
 * no new fabrication risk on top of those existing guarantees.
 */
export async function fetchOverview(
  sources: DataSource[],
  range: { fromIso: string; toIso: string; prevFromIso: string; prevToIso: string },
  solution: string | null,
): Promise<ComposedOverview | null> {
  if (sources.length === 0) return null

  const [first, ...rest] = sources
  const primary = await fetchOne(first, range, solution)

  if (rest.length === 0) {
    return { data: primary.data, source: primary.label }
  }

  const secondary = await fetchOne(rest[0], range, solution)
  return {
    data: mergeOverviewSources(primary.data, secondary.data),
    source: `${primary.label}+${secondary.label}`,
  }
}
