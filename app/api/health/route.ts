import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  const bridgeUrl    = process.env.BRIDGE_URL    ?? null
  const bridgeSecret = process.env.BRIDGE_SECRET ?? null
  const useRealDb    = process.env.USE_REAL_DB    ?? '(not set — defaults true)'

  const config = {
    USE_REAL_DB:    useRealDb,
    BRIDGE_URL:     bridgeUrl    ? bridgeUrl          : '❌ NOT SET',
    BRIDGE_SECRET:  bridgeSecret ? '✅ set (hidden)'  : '❌ NOT SET',
    DB_HOST:        process.env.DB_HOST  ? '✅ set' : '(not set)',
    DB_USER:        process.env.DB_USER  ? '✅ set' : '(not set)',
    DB_NAME:        process.env.DB_NAME  ? '✅ set' : '(not set)',
  }

  // If no bridge URL, skip connectivity test
  if (!bridgeUrl) {
    return NextResponse.json({
      status: 'no_bridge',
      message: 'BRIDGE_URL is not set — set it in Render environment variables',
      config,
    }, { status: 200 })
  }

  // Test bridge connectivity
  let bridgeTest: Record<string, unknown> = {}
  let bridgeOk = false

  try {
    const res = await fetch(`${bridgeUrl}?action=test`, {
      method: 'GET',
      headers: { 'X-Bridge-Key': bridgeSecret ?? '' },
      cache: 'no-store',
    })
    const json = await res.json()
    bridgeOk = json?.success === true
    bridgeTest = { http: res.status, response: json }
  } catch (err) {
    bridgeTest = { error: String(err) }
  }

  // Test real data fetch
  let dataTest: Record<string, unknown> = {}

  if (bridgeOk) {
    try {
      const res = await fetch(`${bridgeUrl}?action=kpis`, {
        method: 'GET',
        headers: { 'X-Bridge-Key': bridgeSecret ?? '' },
        cache: 'no-store',
      })
      const json = await res.json()
      dataTest = { http: res.status, response: json }
    } catch (err) {
      dataTest = { error: String(err) }
    }
  }

  return NextResponse.json({
    status: bridgeOk ? 'ok' : 'bridge_error',
    config,
    bridge_connectivity: bridgeTest,
    data_sample: bridgeOk ? dataTest : 'skipped (bridge not reachable)',
  })
}
