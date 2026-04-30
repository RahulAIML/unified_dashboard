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

async function bridgePost<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  const { url, secret } = requireBridgeConfig()
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Bridge-Key': secret,
    },
    body: JSON.stringify({ action, ...payload }),
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

async function bridgeSql<T>(sql: string, params: Array<string | number | null>): Promise<T> {
  const { url, secret } = requireBridgeConfig()
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Bridge-Key': secret,
    },
    body: JSON.stringify({ sql, params }),
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

function buildUsecaseClause(usecaseIds: number[] | undefined, params: Array<string | number | null>, column = 'sr.usecase_id'): string {
  const safe = (usecaseIds ?? []).filter((id) => Number.isFinite(id) && id > 0)
  if (safe.length === 0) return ''
  const placeholders = safe.map(() => '?').join(',')
  params.push(...safe)
  return ` AND ${column} IN (${placeholders})`
}

export async function resolveCustomerIdByEmail(email: string): Promise<number | null> {
  const normalizedEmail = email.toLowerCase().trim()

  // Preferred production contract:
  // POST { action: "resolve_customer", email }
  try {
    const data = await bridgePost<{ customer_id: number | string | null }>('resolve_customer', { email: normalizedEmail })
    const n = Number(data.customer_id)
    return Number.isFinite(n) && n > 0 ? n : null
  } catch {
    try {
      // Read-only compatibility fallback for bridges exposing GET actions only.
      const data = await bridgeGet<{ customer_id: number | string | null }>('resolve_customer_id', { email: normalizedEmail })
      const n = Number(data.customer_id)
      return Number.isFinite(n) && n > 0 ? n : null
    } catch {
      // Final compatibility fallback for bridges that expose SQL mode only.
      const rows = await bridgeSql<Array<{ customer_id: number | string | null }>>(
        'SELECT customer_id FROM coach_app.coach_users WHERE user_email = ? LIMIT 1',
        [normalizedEmail]
      )
      const row = rows?.[0]
      const n = Number(row?.customer_id ?? null)
      return Number.isFinite(n) && n > 0 ? n : null
    }
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
  try {
    return await bridgeGet('overview_kpis', {
      customer_id: params.customerId,
      from: params.fromIso,
      to: params.toIso,
      usecase_ids: params.usecaseIds?.join(',') ?? undefined,
    })
  } catch {
    const sqlParams: Array<string | number | null> = [params.customerId, params.fromIso, params.toIso]
    const uc = buildUsecaseClause(params.usecaseIds, sqlParams)
    const rows = await bridgeSql<Array<{
      total_sessions: number | string
      avg_score: number | string | null
      passed: number | string
      total_results: number | string
    }>>(
      `SELECT
         COUNT(DISTINCT sr.id) AS total_sessions,
         ROUND(AVG(CASE WHEN rfc.field_key = 'overall_score' THEN rfc.value_num END), 2) AS avg_score,
         COUNT(DISTINCT CASE WHEN sr.passed_flag = 1 THEN sr.id END) AS passed,
         COUNT(DISTINCT sr.id) AS total_results
       FROM rolplay_pro_analytics.report_field_current rfc
       JOIN coach_app.saved_reports sr ON sr.id = rfc.saved_report_id
       JOIN coach_app.coach_users cu ON cu.id = sr.coach_user_id
       WHERE cu.customer_id = ?
         AND rfc.report_created_at BETWEEN ? AND ?${uc}`,
      sqlParams
    )
    const row = rows[0] ?? { total_sessions: 0, avg_score: null, passed: 0, total_results: 0 }
    return {
      current: {
        total_sessions: Number(row.total_sessions ?? 0),
        avg_score: row.avg_score === null ? null : Number(row.avg_score),
        passed: Number(row.passed ?? 0),
        total_results: Number(row.total_results ?? 0),
      },
    }
  }
}

export async function bridgeTrends(params: {
  customerId: number
  fromIso: string
  toIso: string
  usecaseIds?: number[] | undefined
}): Promise<unknown> {
  try {
    return await bridgeGet('trends', {
      customer_id: params.customerId,
      from: params.fromIso,
      to: params.toIso,
      usecase_ids: params.usecaseIds?.join(',') ?? undefined,
    })
  } catch {
    const scoreParams: Array<string | number | null> = [params.customerId, params.fromIso, params.toIso]
    const scoreUc = buildUsecaseClause(params.usecaseIds, scoreParams)
    const scoreTrend = await bridgeSql<Array<{ date: string; avg_score: number | string | null }>>(
      `SELECT
         DATE(rfc.report_created_at) AS date,
         ROUND(AVG(CASE WHEN rfc.field_key = 'overall_score' THEN rfc.value_num END), 2) AS avg_score
       FROM rolplay_pro_analytics.report_field_current rfc
       JOIN coach_app.saved_reports sr ON sr.id = rfc.saved_report_id
       JOIN coach_app.coach_users cu ON cu.id = sr.coach_user_id
       WHERE cu.customer_id = ?
         AND rfc.report_created_at BETWEEN ? AND ?${scoreUc}
       GROUP BY DATE(rfc.report_created_at)
       ORDER BY DATE(rfc.report_created_at)`,
      scoreParams
    )

    const passParams: Array<string | number | null> = [params.customerId, params.fromIso, params.toIso]
    const passUc = buildUsecaseClause(params.usecaseIds, passParams)
    const passFail = await bridgeSql<Array<{ date: string; passed: number | string; failed: number | string }>>(
      `SELECT
         DATE(rfc.report_created_at) AS date,
         COUNT(DISTINCT CASE WHEN sr.passed_flag = 1 THEN sr.id END) AS passed,
         COUNT(DISTINCT CASE WHEN sr.passed_flag = 0 THEN sr.id END) AS failed
       FROM rolplay_pro_analytics.report_field_current rfc
       JOIN coach_app.saved_reports sr ON sr.id = rfc.saved_report_id
       JOIN coach_app.coach_users cu ON cu.id = sr.coach_user_id
       WHERE cu.customer_id = ?
         AND rfc.report_created_at BETWEEN ? AND ?${passUc}
       GROUP BY DATE(rfc.report_created_at)
       ORDER BY DATE(rfc.report_created_at)`,
      passParams
    )

    const evalParams: Array<string | number | null> = [params.customerId, params.fromIso, params.toIso]
    const evalUc = buildUsecaseClause(params.usecaseIds, evalParams)
    const evalCount = await bridgeSql<Array<{ date: string; sessions: number | string }>>(
      `SELECT
         DATE(rfc.report_created_at) AS date,
         COUNT(DISTINCT sr.id) AS sessions
       FROM rolplay_pro_analytics.report_field_current rfc
       JOIN coach_app.saved_reports sr ON sr.id = rfc.saved_report_id
       JOIN coach_app.coach_users cu ON cu.id = sr.coach_user_id
       WHERE cu.customer_id = ?
         AND rfc.report_created_at BETWEEN ? AND ?${evalUc}
       GROUP BY DATE(rfc.report_created_at)
       ORDER BY DATE(rfc.report_created_at)`,
      evalParams
    )

    return {
      score_trend: scoreTrend.map((row) => ({ date: String(row.date), avg_score: row.avg_score === null ? null : Number(row.avg_score) })),
      pass_fail: passFail.map((row) => ({ date: String(row.date), passed: Number(row.passed ?? 0), failed: Number(row.failed ?? 0) })),
      eval_count: evalCount.map((row) => ({ date: String(row.date), sessions: Number(row.sessions ?? 0) })),
    }
  }
}

export async function bridgeResults(params: {
  customerId: number
  fromIso: string
  toIso: string
  usecaseIds?: number[] | undefined
  limit: number
}): Promise<unknown> {
  try {
    return await bridgeGet('results', {
      customer_id: params.customerId,
      from: params.fromIso,
      to: params.toIso,
      usecase_ids: params.usecaseIds?.join(',') ?? undefined,
      limit: params.limit,
    })
  } catch {
    const sqlParams: Array<string | number | null> = [params.customerId, params.fromIso, params.toIso]
    const uc = buildUsecaseClause(params.usecaseIds, sqlParams)
    sqlParams.push(Math.max(1, params.limit))
    const rows = await bridgeSql<Array<{
      saved_report_id: number | string
      usecase_id: number | string | null
      score: number | string | null
      passed_flag: number | string | null
      report_created_at: string
    }>>(
      `SELECT
         sr.id AS saved_report_id,
         sr.usecase_id AS usecase_id,
         ROUND(MAX(CASE WHEN rfc.field_key = 'overall_score' THEN rfc.value_num END), 2) AS score,
         sr.passed_flag AS passed_flag,
         MAX(rfc.report_created_at) AS report_created_at
       FROM rolplay_pro_analytics.report_field_current rfc
       JOIN coach_app.saved_reports sr ON sr.id = rfc.saved_report_id
       JOIN coach_app.coach_users cu ON cu.id = sr.coach_user_id
       WHERE cu.customer_id = ?
         AND rfc.report_created_at BETWEEN ? AND ?${uc}
       GROUP BY sr.id, sr.usecase_id, sr.passed_flag
       ORDER BY report_created_at DESC
       LIMIT ?`,
      sqlParams
    )
    return rows.map((row) => ({
      saved_report_id: Number(row.saved_report_id),
      usecase_id: row.usecase_id === null ? null : Number(row.usecase_id),
      score: row.score === null ? null : Number(row.score),
      passed_flag: row.passed_flag === null ? null : Number(row.passed_flag),
      report_created_at: String(row.report_created_at),
    }))
  }
}

export async function bridgeUsecaseBreakdown(params: {
  customerId: number
  fromIso: string
  toIso: string
  usecaseIds?: number[] | undefined
}): Promise<unknown> {
  try {
    return await bridgeGet('usecase_breakdown', {
      customer_id: params.customerId,
      from: params.fromIso,
      to: params.toIso,
      usecase_ids: params.usecaseIds?.join(',') ?? undefined,
    })
  } catch {
    const sqlParams: Array<string | number | null> = [params.customerId, params.fromIso, params.toIso]
    const uc = buildUsecaseClause(params.usecaseIds, sqlParams)
    const rows = await bridgeSql<Array<{
      usecase_id: number | string
      usecase_name: string | null
      total_evaluations: number | string
      avg_score: number | string | null
      passed: number | string
      total_results: number | string
    }>>(
      `SELECT
         sr.usecase_id AS usecase_id,
         MAX(u.usecase_name) AS usecase_name,
         COUNT(DISTINCT sr.id) AS total_evaluations,
         ROUND(AVG(CASE WHEN rfc.field_key = 'overall_score' THEN rfc.value_num END), 2) AS avg_score,
         COUNT(DISTINCT CASE WHEN sr.passed_flag = 1 THEN sr.id END) AS passed,
         COUNT(DISTINCT sr.id) AS total_results
       FROM rolplay_pro_analytics.report_field_current rfc
       JOIN coach_app.saved_reports sr ON sr.id = rfc.saved_report_id
       JOIN coach_app.coach_users cu ON cu.id = sr.coach_user_id
       LEFT JOIN coach_app.usecases u ON u.id = sr.usecase_id
       WHERE cu.customer_id = ?
         AND rfc.report_created_at BETWEEN ? AND ?${uc}
       GROUP BY sr.usecase_id
       ORDER BY total_evaluations DESC`,
      sqlParams
    )
    return rows.map((row) => ({
      usecase_id: Number(row.usecase_id),
      usecase_name: row.usecase_name,
      total_evaluations: Number(row.total_evaluations ?? 0),
      avg_score: row.avg_score === null ? null : Number(row.avg_score),
      passed: Number(row.passed ?? 0),
      total_results: Number(row.total_results ?? 0),
    }))
  }
}

export async function bridgeDrilldown(params: {
  customerId: number
  savedReportId: number
}): Promise<unknown> {
  try {
    return await bridgeGet('drilldown', {
      customer_id: params.customerId,
      saved_report_id: params.savedReportId,
    })
  } catch {
    const metaRows = await bridgeSql<Array<{
      saved_report_id: number | string
      usecase_id: number | string | null
      report_created_at: string
    }>>(
      `SELECT
         sr.id AS saved_report_id,
         sr.usecase_id AS usecase_id,
         MAX(rfc.report_created_at) AS report_created_at
       FROM coach_app.saved_reports sr
       JOIN coach_app.coach_users cu ON cu.id = sr.coach_user_id
       JOIN rolplay_pro_analytics.report_field_current rfc ON rfc.saved_report_id = sr.id
       WHERE cu.customer_id = ?
         AND sr.id = ?
       GROUP BY sr.id, sr.usecase_id
       LIMIT 1`,
      [params.customerId, params.savedReportId]
    )
    const meta = metaRows[0]
    if (!meta) return null

    const fields = await bridgeSql<Array<{
      field_key: string
      field_label: string | null
      value_num: number | string | null
      value_text: string | null
      value_longtext: string | null
    }>>(
      `SELECT
         field_key,
         field_label,
         value_num,
         value_text,
         value_longtext
       FROM rolplay_pro_analytics.report_field_current
       WHERE saved_report_id = ?
       ORDER BY id`,
      [params.savedReportId]
    )

    const payloadRows = await bridgeSql<Array<{ closing_json: string | null }>>(
      `SELECT closing_json
       FROM rolplay_pro_analytics.report_payload_current
       WHERE saved_report_id = ?
       LIMIT 1`,
      [params.savedReportId]
    )

    return {
      saved_report_id: Number(meta.saved_report_id),
      usecase_id: meta.usecase_id === null ? null : Number(meta.usecase_id),
      report_created_at: String(meta.report_created_at),
      fields: fields.map((row) => ({
        field_key: row.field_key,
        field_label: row.field_label,
        value_num: row.value_num === null ? null : Number(row.value_num),
        value_text: row.value_text,
        value_longtext: row.value_longtext,
      })),
      closing_json: payloadRows[0]?.closing_json ?? null,
    }
  }
}
