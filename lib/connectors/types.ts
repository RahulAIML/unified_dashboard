/**
 * lib/connectors/types.ts — the Connector interface.
 *
 * PURPOSE. Today every dashboard route dispatches on `orgType` with an if/else
 * chain, and the same branching is repeated across routes. Adding a data source
 * means editing every route, and a capability nested in the wrong branch becomes
 * unreachable — which is exactly how the LMS gate ended up invisible to every
 * non-pharma tenant. A connector answers for itself instead.
 *
 * DESIGN RULES, learned from this codebase rather than from a pattern book:
 *
 * 1. NEVER expose raw SQL. `metrics()` takes a typed request, not a query. The
 *    existing rolplay-app transport POSTs SQL strings over HTTP; the interface
 *    must not make that the contract, or every future connector inherits it.
 *
 * 2. CAPABILITIES ARE HONEST. `capabilities()` reports what a connector can
 *    actually answer for a given tenant. A connector must never claim a
 *    capability it will then serve as zeros — an empty chart that looks like an
 *    outage is worse than an absent tab. This mirrors the discipline already in
 *    lib/lms-learnworlds.ts, which returns null rather than 0 for ungraded work.
 *
 * 3. UNSUPPORTED IS EXPLICIT, NOT EMPTY. Optional methods are genuinely absent
 *    (`undefined`) rather than present-and-returning-nothing, so a caller can
 *    tell "this source has no journey concept" from "this tenant has no journey
 *    data yet". Conflating those is how silent-empty bugs start.
 *
 * 4. WRAP, DON'T REWRITE. The first implementations delegate to the existing
 *    bridge modules unchanged. Normalising their internals at the same time as
 *    introducing the abstraction would mean two unverifiable changes at once,
 *    and the numbers on these dashboards are checked against real client data.
 */

import type { Module } from '../types'

/** Stable identifier for a connector implementation. */
export type ConnectorKind =
  | 'rolplay-app'
  | 'pharma-bridge'
  | 'banco-second-brain'
  | 'exceltis-rest'
  | 'learnworlds-lms'

/** Everything a connector needs to act for one tenant on one request. */
export interface ConnectorContext {
  /** Signed-in user's email — several backends resolve tenancy from its domain. */
  email: string
  /** Legacy customer id where the pipeline uses one. */
  customerId?: number | null
  /** Resolved tenant key where the pipeline has one. */
  tenantKey?: string | null
}

/** Inclusive date window. ISO 8601 strings, as every existing route uses. */
export interface DateRange {
  fromIso: string
  toIso: string
}

/**
 * What a connector can answer for THIS tenant.
 *
 * Deliberately per-tenant, not per-connector-class: two tenants on the same
 * backend routinely differ (Sanfer has objections data, Apotex does not).
 */
export interface ConnectorCapabilities {
  /** Dashboard modules this tenant genuinely has data for. */
  modules: Module[]
  /** Metric ids `metrics()` will answer. */
  metrics: string[]
  /** Dimension ids available for grouping. */
  dimensions: string[]
  /** True when row-level drilldown is supported. */
  drilldown: boolean
  /** True when a per-learner journey/progress can be computed. */
  journey: boolean
}

export interface ConnectorHealth {
  ok: boolean
  /** Round-trip time of the probe, ms. */
  latencyMs: number
  /** Operator-facing reason when `ok` is false. Never include credentials. */
  detail?: string
  checkedAtIso: string
}

/**
 * Schema discovery output. Intentionally descriptive rather than SQL-shaped —
 * a REST or GraphQL source has no tables, and forcing one vocabulary onto all
 * of them would make the abstraction lie about half its implementations.
 */
export interface DiscoveredField {
  name: string
  /** Semantic role, which is what the KPI/widget engines need — not a DB type. */
  role: 'identifier' | 'timestamp' | 'measure' | 'dimension' | 'text' | 'unknown'
  nullable?: boolean
  /** Example values, for the AI builder. MUST be non-sensitive. */
  samples?: (string | number)[]
}

export interface DiscoveredEntity {
  name: string
  fields: DiscoveredField[]
  /** Approximate row count when cheaply available; never guessed. */
  approximateRows?: number
}

export interface DiscoveredSchema {
  entities: DiscoveredEntity[]
  /** Set when discovery was partial, with the reason. Honesty over completeness. */
  incomplete?: string
}

/** One metric value for a window, plus the prior window for comparison. */
export interface MetricValue {
  metricId: string
  value: number | null
  previousValue?: number | null
  unit?: 'count' | 'percent' | 'points' | 'seconds'
  /**
   * null means NOT MEASURABLE, never zero. Callers must render an empty state.
   * Collapsing null to 0 has produced real incorrect dashboards here.
   */
  nullReason?: string
}

export interface MetricsRequest {
  metricIds: string[]
  range: DateRange
  /** Restrict to one module/solution, e.g. 'coach'. */
  module?: Module | null
  /** Group by a dimension id from `capabilities().dimensions`. */
  groupBy?: string | null
}

export interface MetricsResult {
  values: MetricValue[]
  /** Present when groupBy was requested. */
  groups?: { key: string; label: string; values: MetricValue[] }[]
}

export interface DimensionMember {
  key: string
  label: string
  count?: number
}

export interface DrilldownRequest {
  range: DateRange
  module?: Module | null
  limit?: number
  offset?: number
}

export interface DrilldownResult {
  /** Column ids present in `rows`, in display order. */
  columns: string[]
  rows: Record<string, string | number | null>[]
  /** Total matching rows when known, for pagination. */
  total?: number
}

/** Per-module progress for a tenant. */
export interface ProgressResult {
  module: Module
  /** 0–100, or null when the module has no completion concept. */
  percent: number | null
  completed: number
  remaining: number | null
  status: 'not_started' | 'in_progress' | 'complete' | 'unknown'
}

/**
 * The interface. Only `kind`, `capabilities` and `health` are required — a
 * connector that cannot do schema discovery must OMIT the method rather than
 * return an empty schema, so callers can distinguish "not supported" from
 * "nothing found".
 */
export interface Connector {
  readonly kind: ConnectorKind

  /** What this tenant can be asked for. Cheap; may be called per request. */
  capabilities(ctx: ConnectorContext): Promise<ConnectorCapabilities>

  /** Liveness of the upstream. Must never throw — report `ok: false` instead. */
  health(ctx: ConnectorContext): Promise<ConnectorHealth>

  /** Infer entities/fields. Omit when the source cannot be introspected. */
  discover?(ctx: ConnectorContext): Promise<DiscoveredSchema>

  /** Alias of discover() for callers that only want the shape. */
  schema?(ctx: ConnectorContext): Promise<DiscoveredSchema>

  /** Metric values. Omit only if the connector serves no metrics at all. */
  metrics?(ctx: ConnectorContext, req: MetricsRequest): Promise<MetricsResult>

  /** Members of a dimension, for filter UIs. */
  dimensions?(ctx: ConnectorContext, dimensionId: string): Promise<DimensionMember[]>

  /** Row-level detail behind a metric. */
  drilldowns?(ctx: ConnectorContext, req: DrilldownRequest): Promise<DrilldownResult>

  /** Per-module progress. Omit where the source has no completion concept. */
  progress?(ctx: ConnectorContext, range: DateRange): Promise<ProgressResult[]>
}

/** Capabilities object meaning "nothing available", for a tenant with no access. */
export const NO_CAPABILITIES: ConnectorCapabilities = {
  modules: [],
  metrics: [],
  dimensions: [],
  drilldown: false,
  journey: false,
}
