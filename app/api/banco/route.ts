/**
 * /api/banco
 *
 * Isolated Banco analytics endpoint.
 *
 * STRICT ISOLATION:
 * ✅ Uses ONLY bridge-banco.ts (not bridge-client.ts)
 * ✅ No analytics DB mixing
 * ✅ Auth-protected AND banco-org-gated (see below)
 * ✅ Returns empty state safely (no crashes)
 *
 * The org gate is load-bearing, not defence in depth. bridge-banco.ts scopes its
 * SQL by nothing but `WHERE sr.banco_user_id > 0` (bridge-banco.ts:172,218,230,256)
 * -- there is no per-tenant predicate to fall back on. Before the isBancoOrg check
 * below, "authenticated" was the ONLY requirement, so any signed-in user of any
 * tenant could read Banco's user counts, director/regional headcounts, top
 * performers and 20 recent sessions. Auth-protected is not the same as scoped.
 */

import { NextRequest, NextResponse } from 'next/server'
import { getAuthContextFromRequest } from '@/lib/server-auth'
import { resolveBancoAccess } from '@/lib/org-type'
import { bridgeBancoKpis, bridgeBancoSessions } from '@/lib/bridge-banco'

export const dynamic = 'force-dynamic'

function parseDateParam(
  params:    URLSearchParams,
  key:       string,
  fallback:  Date
): Date {
  const raw = params.get(key)
  if (!raw) return fallback
  const d = new Date(raw)
  return isNaN(d.getTime()) ? fallback : d
}

export async function GET(request: NextRequest) {
  // ── Auth ───────────────────────────────────────────────────────────────────
  const auth = await getAuthContextFromRequest(request)
  if (!auth) {
    return NextResponse.json(
      { success: false, data: null, meta: { message: 'Unauthorized' } },
      { status: 401 }
    )
  }

  // ── Tenant gate ────────────────────────────────────────────────────────────
  // 403 (not 404) because the caller IS authenticated -- they simply are not a
  // banco user. Mirrors how every other org-scoped dashboard route early-returns
  // on the wrong org type.
  // Access check, not just a domain match: a squatter on a Banco domain is
  // denied because they have no coach_users row.
  if (!(await resolveBancoAccess(auth.email))) {
    return NextResponse.json(
      { success: false, data: null, meta: { message: 'Forbidden' } },
      { status: 403 }
    )
  }

  // ── Date range ─────────────────────────────────────────────────────────────
  const sp   = request.nextUrl.searchParams
  const now  = new Date()
  const to   = parseDateParam(sp, 'to',   now)
  const from = parseDateParam(sp, 'from', new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000))

  const fromIso = from.toISOString()
  const toIso   = to.toISOString()

  // ── Banco data — strictly isolated ─────────────────────────────────────────
  try {
    const [kpisResult, sessionsResult] = await Promise.allSettled([
      bridgeBancoKpis({ fromIso, toIso }),
      bridgeBancoSessions({ fromIso, toIso, limit: 20 }),
    ])

    const kpis     = kpisResult.status     === 'fulfilled' ? kpisResult.value     : null
    const sessions = sessionsResult.status === 'fulfilled' ? sessionsResult.value  : []

    // Attach recent sessions to kpis
    if (kpis) {
      kpis.recentSessions = sessions
    }

    return NextResponse.json({
      success: true,
      data: {
        source: 'banco-isolated-pipeline',
        kpis:   kpis ?? {
          totalSessions:       0,
          activeBancoUsers:    0,
          totalBancoUsers:     0,
          directorsCount:      0,
          regionalsCount:      0,
          avgRoundsPerSession: 0,
          sessionsByPosition:  [],
          topPerformers:       [],
          recentSessions:      [],
          hasData:             false,
        },
        period: { from: fromIso, to: toIso },
      },
      meta: {
        source:    'banco-db',
        timestamp: new Date().toISOString(),
        email:     auth.email,
      },
    })
  } catch (err) {
    // Never crash — return empty state
    console.error('[/api/banco] Error:', err)
    const message = err instanceof Error ? err.message : 'Unknown error'

    return NextResponse.json({
      success: false,
      data:    null,
      meta: {
        message:   `Banco data unavailable: ${message}`,
        timestamp: new Date().toISOString(),
      },
    }, { status: 502 })
  }
}
