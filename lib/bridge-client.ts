type BridgeJson<T> = { success: boolean; data: T; error: string | null }

function requireBridgeConfig() {
  const url = process.env.BRIDGE_URL
  const secret = process.env.BRIDGE_SECRET
  if (!url) throw new Error('BRIDGE_URL is not set')
  if (!secret) throw new Error('BRIDGE_SECRET is not set')
  return { url, secret }
}

async function bridgeGet<T>(action: string, params: Record<string, string | number | undefined | null> = {}): Promise<T> {
  const { url, secret } = requireBridgeConfig()
  const qs = new URLSearchParams({ action })
  for (const [k, v] of Object.entries(params)) {
    if (v === null || v === undefined) continue
    qs.set(k, String(v))
  }

  const res = await fetch(`${url}?${qs.toString()}`, {
    method: 'GET',
    headers: { 'X-Bridge-Key': secret },
    cache: 'no-store',
    signal: AbortSignal.timeout(12_000),
  })

  if (!res.ok) {
    throw new Error(`Bridge HTTP ${res.status}`)
  }

  const json = (await res.json()) as BridgeJson<T>
  if (!json.success) throw new Error(json.error ?? 'Bridge error')
  return json.data
}

export async function resolveCustomerIdByEmail(email: string): Promise<number | null> {
  try {
    const data = await bridgeGet<{ customer_id: number | string | null }>('resolve_customer_id', { email })
    const n = Number(data.customer_id)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // First-time deploy guard: create the contract view, then retry once.
    if (msg.toLowerCase().includes('bridge') || msg.toLowerCase().includes('http')) {
      throw err
    }
    await ensureCoachUsersView().catch(() => null)
    const data2 = await bridgeGet<{ customer_id: number | string | null }>('resolve_customer_id', { email })
    const n2 = Number(data2.customer_id)
    return Number.isFinite(n2) && n2 > 0 ? n2 : null
  }
}

export async function ensureCoachUsersView(): Promise<{ view: string; status: string }> {
  return bridgeGet<{ view: string; status: string }>('setup_coach_users_view')
}

export async function bridgeOverviewKpis(params: {
  customerId: number
  fromIso: string
  toIso: string
  usecaseIds?: number[] | undefined
}): Promise<unknown> {
  return bridgeGet('overview_kpis', {
    customer_id: params.customerId,
    from: params.fromIso,
    to: params.toIso,
    usecase_ids: params.usecaseIds?.join(',') ?? undefined,
  })
}

export async function bridgeTrends(params: {
  customerId: number
  fromIso: string
  toIso: string
  usecaseIds?: number[] | undefined
}): Promise<unknown> {
  return bridgeGet('trends', {
    customer_id: params.customerId,
    from: params.fromIso,
    to: params.toIso,
    usecase_ids: params.usecaseIds?.join(',') ?? undefined,
  })
}

export async function bridgeResults(params: {
  customerId: number
  fromIso: string
  toIso: string
  usecaseIds?: number[] | undefined
  limit: number
}): Promise<unknown> {
  return bridgeGet('results', {
    customer_id: params.customerId,
    from: params.fromIso,
    to: params.toIso,
    usecase_ids: params.usecaseIds?.join(',') ?? undefined,
    limit: params.limit,
  })
}

export async function bridgeUsecaseBreakdown(params: {
  customerId: number
  fromIso: string
  toIso: string
  usecaseIds?: number[] | undefined
}): Promise<unknown> {
  return bridgeGet('usecase_breakdown', {
    customer_id: params.customerId,
    from: params.fromIso,
    to: params.toIso,
    usecase_ids: params.usecaseIds?.join(',') ?? undefined,
  })
}

export async function bridgeDrilldown(params: {
  customerId: number
  savedReportId: number
}): Promise<unknown> {
  return bridgeGet('drilldown', {
    customer_id: params.customerId,
    saved_report_id: params.savedReportId,
  })
}
