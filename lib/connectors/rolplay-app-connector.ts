/**
 * lib/connectors/rolplay-app-connector.ts — Connector for the rolplay_app backend.
 *
 * A PURE ADAPTER. Every data call delegates to lib/bridge-rolplay-app.ts, which
 * is not modified. That module's numbers are verified against real client data
 * (M8, Siigo, Rowe), so re-deriving them behind a new abstraction would risk
 * changing figures while claiming to only restructure. Restructure first, verify
 * equivalence, normalise later — in that order.
 *
 * Consequences of adapting rather than rewriting, stated plainly:
 *
 *  - `discover()` is OMITTED. The upstream is a raw-SQL executor with no
 *    introspection endpoint this repo may safely call, and `SHOW COLUMNS`
 *    against a production database from a request path is not something to add
 *    quietly. Omitted rather than returning a hand-written fake schema, so the
 *    AI builder can tell this source cannot be introspected yet.
 *
 *  - `progress()` is OMITTED. rolplay_app records scored SESSIONS, not
 *    completion state: there is no "assigned" or "remaining" concept in
 *    r_user_session, so any percentage would be invented. See lib/journey.ts for
 *    the same reasoning applied to the journey view.
 *
 *  - `dimensions()` supports 'usecase' only, which is what the backend actually
 *    groups by today.
 */

import {
  resolveRolplayAppAccess,
  rolplayAppAvailableModules,
  rolplayAppOverview,
  rolplayAppUsecaseBreakdown,
  rolplayAppBestPerformers,
  rolplayAppDataBounds,
} from '../bridge-rolplay-app'
import type { Module } from '../types'
import {
  NO_CAPABILITIES,
  type Connector,
  type ConnectorCapabilities,
  type ConnectorContext,
  type ConnectorHealth,
  type DimensionMember,
  type DrilldownRequest,
  type DrilldownResult,
  type MetricsRequest,
  type MetricsResult,
  type MetricValue,
} from './types'

/**
 * Metric ids this connector answers, mapped to how they are derived.
 * Ids are stable contract — the KPI Registry will reference them — so do not
 * rename without a migration path.
 */
const METRIC_IDS = [
  'sessions.total',
  'sessions.passed',
  'score.average',
  'pass.rate',
] as const

type MetricId = (typeof METRIC_IDS)[number]

function isMetricId(id: string): id is MetricId {
  return (METRIC_IDS as readonly string[]).includes(id)
}

/** Resolve the numeric client id, or null when this tenant has no access. */
async function clientIdFor(ctx: ConnectorContext): Promise<number | null> {
  if (!ctx.email) return null
  return resolveRolplayAppAccess(ctx.email)
}

export const rolplayAppConnector: Connector = {
  kind: 'rolplay-app',

  async capabilities(ctx: ConnectorContext): Promise<ConnectorCapabilities> {
    const clientId = await clientIdFor(ctx)
    if (!clientId) return NO_CAPABILITIES

    // Derived from data actually present (r_simulator.category), not declared —
    // so a tenant never sees a module with nothing behind it.
    const modules = (await rolplayAppAvailableModules(clientId)) as Module[]

    return {
      modules,
      metrics: [...METRIC_IDS],
      dimensions: ['usecase'],
      drilldown: true,
      // No completion concept in this schema — see the file header.
      journey: false,
    }
  },

  async health(ctx: ConnectorContext): Promise<ConnectorHealth> {
    const startedAt = Date.now()
    const checkedAtIso = new Date(startedAt).toISOString()
    try {
      const clientId = await clientIdFor(ctx)
      if (!clientId) {
        return {
          ok: false,
          latencyMs: Date.now() - startedAt,
          detail: 'No rolplay_app client mapped for this email domain',
          checkedAtIso,
        }
      }
      // Cheapest real query that proves the transport AND the tenant mapping
      // work. A ping that does not touch tenant scoping would report healthy
      // while every dashboard call returned nothing.
      await rolplayAppDataBounds(clientId)
      return { ok: true, latencyMs: Date.now() - startedAt, checkedAtIso }
    } catch (err) {
      // Must never throw: callers use health() to decide what to render.
      return {
        ok: false,
        latencyMs: Date.now() - startedAt,
        detail: (err as Error).message,
        checkedAtIso,
      }
    }
  },

  async metrics(ctx: ConnectorContext, req: MetricsRequest): Promise<MetricsResult> {
    const clientId = await clientIdFor(ctx)
    if (!clientId) {
      return {
        values: req.metricIds.map(metricId => ({
          metricId,
          value: null,
          nullReason: 'No rolplay_app client mapped for this tenant',
        })),
      }
    }

    const range = { fromIso: req.range.fromIso, toIso: req.range.toIso }
    const solution = req.module ?? null
    const overview = await rolplayAppOverview(clientId, range, solution)

    const valueFor = (id: MetricId): MetricValue => {
      switch (id) {
        case 'sessions.total':
          return {
            metricId: id,
            value: overview.totalEvaluations,
            previousValue: overview.prevTotalEvaluations,
            unit: 'count',
          }
        case 'sessions.passed':
          return { metricId: id, value: overview.passedEvaluations, unit: 'count' }
        case 'score.average':
          return {
            metricId: id,
            // Preserved as null, never coerced to 0: no scored sessions is not
            // the same as an average of zero.
            value: overview.avgScore,
            previousValue: overview.prevAvgScore,
            unit: 'points',
            ...(overview.avgScore === null
              ? { nullReason: 'No scored sessions in this period' }
              : {}),
          }
        case 'pass.rate':
          return {
            metricId: id,
            value: overview.passRate,
            previousValue: overview.prevPassRate,
            unit: 'percent',
            ...(overview.passRate === null
              ? { nullReason: 'No scored sessions in this period' }
              : {}),
          }
      }
    }

    const values: MetricValue[] = req.metricIds.map(id =>
      isMetricId(id)
        ? valueFor(id)
        : // Unknown ids are reported as unsupported rather than silently dropped:
          // a caller asking for a metric that does not exist should find out.
          { metricId: id, value: null, nullReason: `Unsupported metric '${id}'` },
    )

    if (!req.groupBy) return { values }

    if (req.groupBy !== 'usecase') {
      return { values, groups: [] }
    }

    const breakdown = await rolplayAppUsecaseBreakdown(clientId, range, solution)
    const groups = (breakdown.data ?? []).map(row => ({
      key: String(row.usecaseId),
      // Fall back to the id when the display name is absent — never render
      // "null" as a group label.
      label: row.usecase_name ?? `Use case ${row.usecaseId}`,
      values: [
        { metricId: 'sessions.total', value: row.totalEvaluations, unit: 'count' as const },
        { metricId: 'score.average', value: row.avgScore, unit: 'points' as const },
        { metricId: 'pass.rate', value: row.passRate, unit: 'percent' as const },
      ],
    }))

    return { values, groups }
  },

  async dimensions(ctx: ConnectorContext, dimensionId: string): Promise<DimensionMember[]> {
    if (dimensionId !== 'usecase') return []
    const clientId = await clientIdFor(ctx)
    if (!clientId) return []

    // No range: a filter list should show every option the tenant has, not only
    // those active in the currently selected window.
    const breakdown = await rolplayAppUsecaseBreakdown(clientId)
    return (breakdown.data ?? []).map(row => ({
      key: String(row.usecaseId),
      label: row.usecase_name ?? `Use case ${row.usecaseId}`,
      count: row.totalEvaluations,
    }))
  },

  async drilldowns(ctx: ConnectorContext, req: DrilldownRequest): Promise<DrilldownResult> {
    const clientId = await clientIdFor(ctx)
    if (!clientId) return { columns: [], rows: [] }

    const limit = Math.min(Math.max(1, Math.trunc(req.limit ?? 50)), 500)
    const performers = await rolplayAppBestPerformers(
      clientId,
      limit,
      { fromIso: req.range.fromIso, toIso: req.range.toIso },
      req.module ?? null,
    )

    const rows = (performers.data ?? []).map(p => ({
      // user_name is nullable upstream; fall back to the email rather than null
      // so a drilldown row is always identifiable.
      user: p.user_name ?? p.user_email,
      sessions: p.sessions,
      avg_score: p.avg_score,
      pass_rate: p.pass_rate,
    }))

    return {
      columns: ['user', 'sessions', 'avg_score', 'pass_rate'],
      rows,
      // Rows returned, NOT the tenant's true total: this delegates to
      // bestPerformers(limit) which has no unbounded count. Reporting `limit`
      // as a total would make pagination lie.
      total: rows.length,
    }
  },

  // discover / schema / progress are intentionally ABSENT — see the file header.
  // Do not add stubs that return empty results: callers must be able to tell
  // "unsupported" from "no data".
}
