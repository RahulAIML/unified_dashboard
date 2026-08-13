/**
 * Proxy to the AI dashboard-builder service.
 *
 * Keeps AI_SERVICE_URL server-side (no CORS, no mixed-content, no secret leak).
 * The builder UI calls /api/ai/... and this forwards to the FastAPI service.
 *
 * SECURITY — this proxy fronts the tenant-provisioning pipeline (company and
 * service discovery, dashboard generation, PUBLISH). It previously forwarded
 * every request with no authentication whatsoever, and middleware.ts does
 * `if (pathname.startsWith('/api/')) return NextResponse.next()`, so there was
 * no gate at either layer: an anonymous caller could provision tenants and
 * change what customers see.
 *
 * It now requires an authenticated ADMIN. Admin rather than any signed-in user
 * because these endpoints mutate tenant configuration, which is not a
 * self-service action for a tenant's own analysts.
 *
 * Rate limited independently of auth so a single compromised admin session
 * cannot drive unbounded LLM spend.
 */
import { NextRequest, NextResponse } from 'next/server'
import { requireAdminFromRequest } from '@/lib/server-auth'
import { rateLimit, rateLimitHeaders } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const AI_SERVICE_URL = process.env.AI_SERVICE_URL ?? 'http://127.0.0.1:8088'

/** Discovery and generation are expensive; this is a spend guard, not a DoS guard. */
const AI_LIMIT = 60
const AI_WINDOW_MS = 60_000

/**
 * Body cap. The AI service accepts JSON describing a tenant, never a payload of
 * this size, so anything larger is either a mistake or an attempt to use the
 * proxy as an amplifier.
 */
const MAX_BODY_BYTES = 256 * 1024

async function forward(request: NextRequest, path: string[]): Promise<NextResponse> {
  const admin = await requireAdminFromRequest(request)
  if (!admin) {
    // 403 for both unauthenticated and non-admin: distinguishing them tells an
    // attacker whether a session is valid, and this endpoint has no legitimate
    // non-admin caller to help.
    return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
  }

  const limit = rateLimit(`ai:${admin.email}`, AI_LIMIT, AI_WINDOW_MS)
  if (!limit.ok) {
    return NextResponse.json(
      { error: 'Rate limit exceeded' },
      { status: 429, headers: rateLimitHeaders(limit) },
    )
  }

  // Reject path traversal before it reaches the upstream URL. Next already
  // decodes segments, but '..' would still escape the /ai/ namespace and let a
  // caller reach arbitrary endpoints on the AI service.
  if (path.some(seg => seg === '..' || seg.includes('/') || seg.includes('\\'))) {
    return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  }

  // Everything the UI needs lives under the service's /ai/* namespace.
  const suffix = path.map(encodeURIComponent).join('/')
  const search = request.nextUrl.search
  const url = `${AI_SERVICE_URL.replace(/\/+$/, '')}/ai/${suffix}${search}`

  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  // The AI service is a public Render web service with no auth of its own
  // (CORS only constrains browser-originated calls, not a direct request to
  // its URL) — this shared secret is its only gate against being reached
  // directly, bypassing the admin check above entirely. Unset in dev, so
  // local development against a service without AI_SERVICE_SHARED_SECRET
  // configured keeps working — but it MUST match internal_shared_secret on
  // the ai-service in production.
  const internalSecret = process.env.AI_SERVICE_SHARED_SECRET
  if (internalSecret) headers['X-Internal-Auth'] = internalSecret

  const init: RequestInit = {
    method: request.method,
    headers,
    cache: 'no-store',
    signal: AbortSignal.timeout(120_000),
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const body = await request.text()
    if (body.length > MAX_BODY_BYTES) {
      return NextResponse.json({ error: 'Payload too large' }, { status: 413 })
    }
    // Must be valid JSON: the upstream expects JSON, and failing here gives a
    // clear 400 instead of an opaque upstream error.
    if (body) {
      try {
        JSON.parse(body)
      } catch {
        return NextResponse.json({ error: 'Body must be valid JSON' }, { status: 400 })
      }
    }
    init.body = body
  }

  // Audit trail: these calls provision tenants and publish dashboards, so who
  // did what must be recoverable. Path only — bodies can carry credentials.
  console.info(
    `[audit] ai-proxy admin=${admin.email} ${request.method} /ai/${suffix} ` +
    `remaining=${limit.remaining}`,
  )

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
// DELETE is required by DELETE /ai/knowledge/{slug} — the AI service's own
// endpoint for clearing a stale/wrong cached company-discovery entry. Without
// it, an admin has no way to correct a bad cache other than direct DB access,
// and this proxy previously only forwarded GET/POST.
export async function DELETE(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(request, (await ctx.params).path)
}
// PATCH is required by PATCH /ai/dashboard/{slug}/required-sections — the
// lightweight mandatory-sections edit that intentionally does NOT go through
// generate/publish (no schema re-discovery, no version bump).
export async function PATCH(request: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  return forward(request, (await ctx.params).path)
}
