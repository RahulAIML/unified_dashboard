/**
 * tenant-probe.ts — heuristic auto-detect for the admin tenant wizard.
 *
 * Given a bare endpoint URL, try each of the 3 known backend shapes this
 * dashboard already speaks (see lib/pharma-tenant.ts's TenantConfig.kind) and
 * report which one responded. This is a best-effort SUGGESTION, not a
 * decision — every onboarding attempt so far in this codebase (Sanfer,
 * Apotex, the 6 exceltis_rest clients) needed real bespoke verification
 * against each client's actual source, so the admin wizard always shows the
 * raw sample response and requires a human to confirm/override the kind
 * before saving, rather than auto-deploying a guess.
 */

// Generous timeout — this dashboard has repeatedly seen transient
// Vercel-to-origin-server latency spikes well past a few seconds, and a
// false "unreachable" probe result would wrongly discourage onboarding a
// perfectly healthy client endpoint.
const PROBE_TIMEOUT_MS = 20_000

export interface ProbeResult {
  kind: 'sale_exercises' | 'kpi' | 'exceltis_rest' | null
  confidence: 'high' | 'low'
  note: string
  rawSample: string
}

async function timedFetch(url: string, init: RequestInit): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS), cache: 'no-store' })
}

/** Action-dispatch bridge (sale_exercises / kpi kinds) — POST {action, ...}. */
async function probeActionDispatch(url: string, xTenant?: string): Promise<{ ok: boolean; sample: string }> {
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' }
    if (xTenant) headers['X-Tenant'] = xTenant
    const resp = await timedFetch(url, {
      method: 'POST', headers, body: 'action=org.members',
    })
    const text = await resp.text()
    let ok = false
    try {
      const json = JSON.parse(text)
      ok = json.ok === true || Array.isArray(json.data)
    } catch { /* not JSON */ }
    return { ok, sample: text.slice(0, 500) }
  } catch (err) {
    return { ok: false, sample: `(request failed: ${(err as Error).message})` }
  }
}

/** Flask REST endpoints (exceltis_rest kind) — GET /api/dim_actividades. */
async function probeExceltisRest(url: string): Promise<{ ok: boolean; sample: string }> {
  try {
    const base = url.replace(/\/+$/, '')
    const resp = await timedFetch(`${base}/api/dim_actividades`, { method: 'GET' })
    const text = await resp.text()
    // A live Flask app answers with either real data OR its own validation
    // error ("Debes proporcionar al menos un ID") — both prove the shape.
    const ok = resp.status === 200 || (resp.status === 400 && /id/i.test(text))
    return { ok, sample: text.slice(0, 500) }
  } catch (err) {
    return { ok: false, sample: `(request failed: ${(err as Error).message})` }
  }
}

export async function probeTenantEndpoint(url: string, xTenant?: string): Promise<ProbeResult> {
  const [dispatch, rest] = await Promise.all([
    probeActionDispatch(url, xTenant),
    probeExceltisRest(url),
  ])

  if (dispatch.ok && !rest.ok) {
    return {
      kind: 'sale_exercises',
      confidence: 'low',
      note: "Responded to an action-dispatch POST (action=org.members). Defaulted to 'sale_exercises' — pick 'kpi' instead if this client's data comes back as pre-aggregated KPI rows rather than raw per-session rows (see Apotex for reference).",
      rawSample: dispatch.sample,
    }
  }
  if (rest.ok && !dispatch.ok) {
    return {
      kind: 'exceltis_rest',
      confidence: 'high',
      note: "Responded to GET /api/dim_actividades like the existing exceltis_rest clients (Heineken, M8, Lacoste, Chiesi, Labomed).",
      rawSample: rest.sample,
    }
  }
  if (dispatch.ok && rest.ok) {
    return {
      kind: null,
      confidence: 'low',
      note: 'Endpoint answered BOTH probes — unusual. Verify manually against the client\'s own source before picking a kind.',
      rawSample: `[action-dispatch] ${dispatch.sample}\n\n[exceltis_rest] ${rest.sample}`,
    }
  }
  return {
    kind: null,
    confidence: 'low',
    note: 'Neither known shape responded. Double-check the URL, or this client may need a new kind this dashboard doesn\'t support yet.',
    rawSample: `[action-dispatch] ${dispatch.sample}\n\n[exceltis_rest] ${rest.sample}`,
  }
}
