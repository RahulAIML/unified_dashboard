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
import {
  resolveRolplayAppAccess, rolplayAppOverview, mergeOverviewSources,
  rolplayAppResults, rolplayAppUsecaseBreakdown, rolplayAppBestPerformers, rolplayAppTrends,
} from './bridge-rolplay-app'
import {
  pharmaDashboardOverview, pharmaDashboardResults, pharmaDashboardUsecaseBreakdown,
  pharmaDashboardBestPerformers, pharmaDashboardTrends,
} from './bridge-pharma-analytics'
import type {
  OverviewApiResponse, EvaluationApiRow, UsecaseApiRow, BestPerformerRow,
  TrendsApiResponse, ApiTrendPoint, ScoreDistributionBucket,
} from './types'
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

// ── Results (individual evaluation rows) ────────────────────────────────────

async function fetchResultsOne(
  source: DataSource,
  limit: number,
  range: { fromIso: string; toIso: string },
  solution: string | null,
): Promise<{ data: EvaluationApiRow[]; label: string }> {
  if (source.kind === 'rolplay-app-sql') {
    const { data } = await rolplayAppResults(source.clientId, limit, range, solution)
    return { data, label: `rolplay-app-${source.clientId}` }
  }
  const { data } = await pharmaDashboardResults(source.tenant, { ...range, limit, solution })
  return { data, label: `pharma-${source.tenant}` }
}

/**
 * Composes individual-session rows across sources: concatenate, sort by
 * date (most recent first, matching every existing single-source
 * implementation's own ORDER BY), then re-apply `limit` over the COMBINED
 * set -- so a tenant with real recent activity in both sources sees the
 * true most-recent `limit` rows across both, not `limit` from the primary
 * plus a separate `limit` from the secondary.
 */
export async function fetchResults(
  sources: DataSource[],
  limit: number,
  range: { fromIso: string; toIso: string },
  solution: string | null,
): Promise<{ data: EvaluationApiRow[]; source: string } | null> {
  if (sources.length === 0) return null
  const [first, ...rest] = sources
  const primary = await fetchResultsOne(first, limit, range, solution)
  if (rest.length === 0) return { data: primary.data, source: primary.label }

  const secondary = await fetchResultsOne(rest[0], limit, range, solution)
  const data = [...primary.data, ...secondary.data]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, limit)
  return { data, source: `${primary.label}+${secondary.label}` }
}

// ── Usecase / per-simulator breakdown ────────────────────────────────────────

async function fetchUsecaseBreakdownOne(
  source: DataSource,
  range: { fromIso: string; toIso: string },
  solution: string | null,
): Promise<{ data: UsecaseApiRow[]; label: string }> {
  if (source.kind === 'rolplay-app-sql') {
    const { data } = await rolplayAppUsecaseBreakdown(source.clientId, range, solution)
    return { data, label: `rolplay-app-${source.clientId}` }
  }
  const { data } = await pharmaDashboardUsecaseBreakdown(source.tenant, { ...range, solution })
  return { data, label: `pharma-${source.tenant}` }
}

/**
 * Composes per-usecase/per-simulator rows across sources: a straight
 * concatenation, re-sorted by totalEvaluations descending. Safe without any
 * id-collision handling -- rolplay_app_sql's simulator ids and a pharma
 * bridge's own usecase ids are different id spaces on different systems,
 * verified never to overlap (M8's rolplay_app_sql simulator ids are in the
 * 3000s; pharma_exceltis_rest's ucids are 3-digit), so no two rows from
 * different sources can ever refer to the same real usecase.
 */
export async function fetchUsecaseBreakdown(
  sources: DataSource[],
  range: { fromIso: string; toIso: string },
  solution: string | null,
): Promise<{ data: UsecaseApiRow[]; source: string } | null> {
  if (sources.length === 0) return null
  const [first, ...rest] = sources
  const primary = await fetchUsecaseBreakdownOne(first, range, solution)
  if (rest.length === 0) return { data: primary.data, source: primary.label }

  const secondary = await fetchUsecaseBreakdownOne(rest[0], range, solution)
  const data = [...primary.data, ...secondary.data].sort((a, b) => b.totalEvaluations - a.totalEvaluations)
  return { data, source: `${primary.label}+${secondary.label}` }
}

// ── Best performers (leaderboard) ────────────────────────────────────────────

async function fetchBestPerformersOne(
  source: DataSource,
  limit: number,
  range: { fromIso: string; toIso: string },
  solution: string | null,
): Promise<{ resp: Awaited<ReturnType<typeof pharmaDashboardBestPerformers>>; label: string }> {
  if (source.kind === 'rolplay-app-sql') {
    const resp = await rolplayAppBestPerformers(source.clientId, limit, range, solution)
    return { resp, label: `rolplay-app-${source.clientId}` }
  }
  const resp = await pharmaDashboardBestPerformers(source.tenant, { ...range, limit, solution })
  return { resp, label: `pharma-${source.tenant}` }
}

/**
 * Composes leaderboard rows across sources, merging BY EMAIL rather than
 * concatenating: the same real rep can be a genuine user of both systems
 * (the exact M8 case this whole layer was built for), and listing them
 * twice with partial stats would misrepresent who the actual top performer
 * is. A merged row sums sessions and weight-averages avg_score/pass_rate by
 * each source's own session count -- same weighting rule as
 * mergeOverviewSources, for the same reason (a source with more sessions
 * should influence the blended average more). `user_name` prefers whichever
 * side has one; `allTimeStats` (only ever present for a handful of pharma
 * tenants, e.g. Sanfer) is passed through from whichever source has it
 * rather than merged -- combining two different systems' "all-time" history
 * into one number is exactly the kind of invented relationship this layer
 * must not produce.
 */
export async function fetchBestPerformers(
  sources: DataSource[],
  limit: number,
  range: { fromIso: string; toIso: string },
  solution: string | null,
): Promise<{ data: BestPerformerRow[]; source: string; allTimeStats?: NonNullable<Awaited<ReturnType<typeof pharmaDashboardBestPerformers>>['allTimeStats']> } | null> {
  if (sources.length === 0) return null
  const [first, ...rest] = sources
  const primary = await fetchBestPerformersOne(first, limit, range, solution)
  if (rest.length === 0) {
    return { data: primary.resp.data, source: primary.label, allTimeStats: primary.resp.allTimeStats }
  }

  const secondary = await fetchBestPerformersOne(rest[0], limit, range, solution)

  const byEmail = new Map<string, BestPerformerRow>()
  for (const row of [...primary.resp.data, ...secondary.resp.data]) {
    const key = row.user_email.toLowerCase().trim()
    const existing = byEmail.get(key)
    if (!existing) { byEmail.set(key, { ...row }); continue }
    const sessions = existing.sessions + row.sessions
    byEmail.set(key, {
      user_email: existing.user_email,
      user_name:  existing.user_name ?? row.user_name,
      sessions,
      avg_score:  sessions > 0 ? Math.round(((existing.avg_score * existing.sessions + row.avg_score * row.sessions) / sessions) * 100) / 100 : 0,
      pass_rate:  sessions > 0 ? Math.round(((existing.pass_rate * existing.sessions + row.pass_rate * row.sessions) / sessions) * 10) / 10 : 0,
    })
  }
  const data = [...byEmail.values()]
    .sort((a, b) => b.avg_score - a.avg_score || b.sessions - a.sessions)
    .slice(0, limit)

  return {
    data, source: `${primary.label}+${secondary.label}`,
    allTimeStats: primary.resp.allTimeStats ?? secondary.resp.allTimeStats,
  }
}

// ── Trends (daily time series + score-distribution histogram) ──────────────

async function fetchTrendsOne(
  source: DataSource,
  range: { fromIso: string; toIso: string },
  solution: string | null,
): Promise<{ data: TrendsApiResponse; label: string }> {
  if (source.kind === 'rolplay-app-sql') {
    const data = await rolplayAppTrends(source.clientId, range, solution)
    return { data, label: `rolplay-app-${source.clientId}` }
  }
  const data = await pharmaDashboardTrends(source.tenant, { ...range, solution })
  return { data, label: `pharma-${source.tenant}` }
}

/** date -> { sessions (from evalCountTrend), passed (from passFailTrend.value) }. */
function dailyCountsByDate(trends: TrendsApiResponse): Map<string, { sessions: number; passed: number }> {
  const map = new Map<string, { sessions: number; passed: number }>()
  for (const p of trends.evalCountTrend) map.set(p.date, { sessions: p.value, passed: 0 })
  for (const p of trends.passFailTrend) {
    const entry = map.get(p.date) ?? { sessions: 0, passed: 0 }
    entry.passed = p.value
    map.set(p.date, entry)
  }
  return map
}

function scoreByDate(trends: TrendsApiResponse): Map<string, number> {
  return new Map(trends.scoreTrend.map(p => [p.date, p.value]))
}

/**
 * Merges two TrendsApiResponse objects date-by-date. `evalCountTrend` and
 * `passFailTrend.value` (passed count) sum directly -- both are real counts
 * of disjoint sessions. `passFailTrend.value2` (failed count) is always
 * DERIVED as sessions-passed rather than summed or copied from either
 * source, since only pharma's own connector populates it today
 * (rolplay_app_sql's never has) -- deriving it here is arithmetic, not
 * fabrication, and gives every composed date a consistent shape regardless
 * of which source(s) contributed to it. `scoreTrend` is a
 * session-count-weighted average for a date present in both sources, or
 * passed through unchanged for a date present in only one -- never
 * averaging a real score against an absent one. Dates are emitted in
 * SORTED order across the union of both sources' calendars.
 */
function mergeTrends(a: TrendsApiResponse, b: TrendsApiResponse): TrendsApiResponse {
  const aCounts = dailyCountsByDate(a), bCounts = dailyCountsByDate(b)
  const aScores = scoreByDate(a), bScores = scoreByDate(b)
  const dates = [...new Set([...aCounts.keys(), ...bCounts.keys()])].sort()

  const scoreTrend: ApiTrendPoint[] = []
  const passFailTrend: ApiTrendPoint[] = []
  const evalCountTrend: ApiTrendPoint[] = []

  for (const date of dates) {
    const ac = aCounts.get(date), bc = bCounts.get(date)
    const sessions = (ac?.sessions ?? 0) + (bc?.sessions ?? 0)
    const passed = (ac?.passed ?? 0) + (bc?.passed ?? 0)
    evalCountTrend.push({ date, value: sessions })
    passFailTrend.push({ date, value: passed, value2: Math.max(0, sessions - passed) })

    const aScore = aScores.get(date), bScore = bScores.get(date)
    if (aScore != null && bScore != null && ac && bc) {
      const w = ac.sessions + bc.sessions
      scoreTrend.push({ date, value: w > 0 ? Math.round(((aScore * ac.sessions + bScore * bc.sessions) / w) * 100) / 100 : aScore })
    } else if (aScore != null) {
      scoreTrend.push({ date, value: aScore })
    } else if (bScore != null) {
      scoreTrend.push({ date, value: bScore })
    }
    // Neither source has a real score for this date -- correctly absent
    // from scoreTrend, matching how every single-source connector already
    // omits an unscored day rather than fabricating a 0.
  }

  // Score-distribution histogram: sum matching bucket ranges, recompute pct
  // from the new grand total. Only combined when BOTH sources use the same
  // fixed bucket scheme (verified: both preview_fetch.py's and
  // bridge-pharma-analytics.ts's buildScoreDistribution use the identical
  // 10-wide 0-9..90-100 ranges) -- if either source's buckets don't line up
  // 1:1 with the other's, composing them would silently misrepresent the
  // distribution, so this falls back to whichever source actually has one
  // instead of guessing.
  let scoreDistribution: ScoreDistributionBucket[] | undefined
  if (a.scoreDistribution && b.scoreDistribution && sameBucketRanges(a.scoreDistribution, b.scoreDistribution)) {
    const byRange = new Map(a.scoreDistribution.map(bk => [bk.range, bk.count]))
    for (const bk of b.scoreDistribution) byRange.set(bk.range, (byRange.get(bk.range) ?? 0) + bk.count)
    const total = [...byRange.values()].reduce((s, n) => s + n, 0) || 1
    scoreDistribution = [...byRange.entries()].map(([range, count]) => ({
      range, count, pct: Math.round((count / total) * 10000) / 100,
    }))
  } else {
    scoreDistribution = a.scoreDistribution ?? b.scoreDistribution
  }

  return { scoreTrend, passFailTrend, evalCountTrend, scoreDistribution }
}

function sameBucketRanges(a: ScoreDistributionBucket[], b: ScoreDistributionBucket[]): boolean {
  if (a.length !== b.length) return false
  const bRanges = new Set(b.map(bk => bk.range))
  return a.every(bk => bRanges.has(bk.range))
}

export async function fetchTrends(
  sources: DataSource[],
  range: { fromIso: string; toIso: string },
  solution: string | null,
): Promise<{ data: TrendsApiResponse; source: string } | null> {
  if (sources.length === 0) return null
  const [first, ...rest] = sources
  const primary = await fetchTrendsOne(first, range, solution)
  if (rest.length === 0) return { data: primary.data, source: primary.label }

  const secondary = await fetchTrendsOne(rest[0], range, solution)
  return { data: mergeTrends(primary.data, secondary.data), source: `${primary.label}+${secondary.label}` }
}
