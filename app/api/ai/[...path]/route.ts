/**
 * Proxy to the AI dashboard-builder service.
 *
 * Keeps AI_SERVICE_URL server-side (no CORS, no mixed-content, no secret leak).
 * The builder UI calls /api/ai/... and this forwards to the FastAPI service.
 */
import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const AI_SERVICE_URL = process.env.AI_SERVICE_URL ?? 'http://127.0.0.1:8088'

async function forward(request: NextRequest, path: string[]): Promise<NextResponse> {
  // Everything the UI needs lives under the service's /ai/* namespace.
  const suffix = path.join('/')
  const search = request.nextUrl.search
  const url = `${AI_SERVICE_URL.replace(/\/+$/, '')}/ai/${suffix}${search}`

  const init: RequestInit = {
    method: request.method,
    headers: { 'Content-Type': 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(120_000),
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.text()
  }

  try {
    const res = await fetch(url, init)
    const text = await res.text()
    return new NextResponse(text, {
      status: res.status,
      headers: { 'Content-Type': res.headers.get('content-type') ?? 'application/json' },
    })
  } catch (err) {
    return NextResponse.json(
      { error: `AI service unreachable: ${(err as Error).message}` },
      { status: 502 },
    )
  }
}

export async function GET(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(request, (await ctx.params).path)
}
export async function POST(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(request, (await ctx.params).path)
}
