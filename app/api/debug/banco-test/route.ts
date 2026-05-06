/**
 * GET /api/debug/banco-test
 *
 * Diagnostic endpoint — tests every layer of the Banco pipeline and returns
 * exactly what went wrong so errors can be diagnosed without reading server logs.
 *
 * SECURITY: requires valid auth cookie, returns 401 otherwise.
 * Remove or protect behind an admin check once the issue is resolved.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAuthContextFromRequest } from '@/lib/server-auth'
import { resolveOrgType, isBancoOrg } from '@/lib/org-type'

export const dynamic = 'force-dynamic'
export const runtime  = 'nodejs'

async function testBridge(label: string, sql: string, params: (string|number|null)[] = []) {
  const url    = process.env.BRIDGE_URL
  const secret = process.env.BRIDGE_SECRET

  if (!url || !secret) {
    return { label, ok: false, error: 'BRIDGE_URL or BRIDGE_SECRET not set', rows: null }
  }

  try {
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json', 'X-Bridge-Key': secret },
      body:    JSON.stringify({ sql, params }),
      cache:   'no-store',
      signal:  AbortSignal.timeout(10_000),
    })

    const text = await res.text()
    let json: unknown
    try { json = JSON.parse(text) } catch { json = text }

    if (!res.ok) {
      return { label, ok: false, error: `Bridge HTTP ${res.status}`, raw: text.slice(0, 500), rows: null }
    }

    const j = json as { success: boolean; data: unknown; error: string | null }
    if (!j.success) {
      return { label, ok: false, error: j.error ?? 'Bridge success=false', rows: null }
    }

    return { label, ok: true, error: null, rows: j.data }
  } catch (err) {
    return { label, ok: false, error: String(err), rows: null }
  }
}

export async function GET(request: NextRequest) {
  const auth = await getAuthContextFromRequest(request)
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const orgType       = resolveOrgType(auth.email, auth.customerId)
  const isBanco       = isBancoOrg(auth.email)
  const bancoDomains  = process.env.BANCO_EMAIL_DOMAINS ?? '(not set)'
  const bridgeUrl     = process.env.BRIDGE_URL     ? '✓ set' : '✗ MISSING'
  const bridgeSecret  = process.env.BRIDGE_SECRET  ? '✓ set' : '✗ MISSING'

  const now = new Date()
  const from = new Date(now.getTime() - 30 * 86_400_000)
  const fmt  = (d: Date) => d.toISOString().replace('T', ' ').replace(/\.\d+Z$/, '')

  const [t1, t2, t3] = await Promise.all([
    // Test 1: simple banco_users count (no date params)
    testBridge(
      'banco_users COUNT',
      'SELECT COUNT(*) AS total FROM coach_app.banco_users'
    ),

    // Test 2: saved_reports count for the last 30 days
    testBridge(
      'saved_reports (30d)',
      `SELECT COUNT(*) AS total FROM coach_app.saved_reports
       WHERE banco_user_id > 0 AND date_created BETWEEN ? AND ?`,
      [fmt(from), fmt(now)]
    ),

    // Test 3: score extraction via SUBSTRING_INDEX
    testBridge(
      'score extraction (SUBSTRING_INDEX)',
      `SELECT
         sr.id,
         CAST(TRIM(SUBSTRING_INDEX(SUBSTRING_INDEX(sro.retro, 'Total score:</strong> ', -1), '<', 1)) AS UNSIGNED) AS score
       FROM coach_app.saved_reports sr
       JOIN coach_app.saved_reports_options sro ON sro.saved_report_id = sr.id
       WHERE sr.banco_user_id > 0
         AND sro.retro LIKE '%Total score:</strong>%'
       LIMIT 3`
    ),
  ])

  return NextResponse.json({
    auth: {
      email:      auth.email,
      customerId: auth.customerId,
      orgType,
      isBanco,
    },
    env: {
      BANCO_EMAIL_DOMAINS: bancoDomains,
      BRIDGE_URL:          bridgeUrl,
      BRIDGE_SECRET:       bridgeSecret,
    },
    tests: [t1, t2, t3],
  })
}
