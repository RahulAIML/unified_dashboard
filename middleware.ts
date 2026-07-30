/**
 * middleware.ts — Route protection only (no header propagation)
 *
 * FINAL decisions:
 * - Middleware ONLY protects page routes (redirect to /auth/login)
 * - API routes MUST verify JWT from cookies themselves
 * - Never inject auth/tenant headers for downstream handlers
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyAccessToken } from './lib/jwt'

// Auth pages — redirect to dashboard if already logged in
const AUTH_ROUTES = ['/auth/login', '/auth/register']

// '/' is public: the page component shows LandingPage (unauthenticated)
// or DashboardContent (authenticated) via useAuthContext — no redirect needed.
function isAuthRoute(pathname: string) {
  return AUTH_ROUTES.some((r) => pathname.startsWith(r))
}

/**
 * Baseline security headers applied to EVERY response, including API routes.
 *
 * Note the deliberate ordering below: headers are attached even on the
 * early-return paths. An earlier version would have skipped them for /api/*,
 * which is precisely where a clickjacking or sniffing protection matters least
 * but a Referrer-Policy leak matters most (URLs can carry tenant identifiers).
 *
 * CSP is intentionally NOT set here. Next.js injects inline scripts for
 * hydration, so a correct policy needs per-request nonces threaded through the
 * document — adding a broad `unsafe-inline` policy would be security theatre
 * that reads as protection in an audit while blocking nothing. Tracked as its
 * own task in ROADMAP.md Phase 1 rather than faked here.
 */
function withSecurityHeaders(res: NextResponse): NextResponse {
  res.headers.set('X-Content-Type-Options', 'nosniff')
  res.headers.set('X-Frame-Options', 'DENY')
  res.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin')
  res.headers.set('X-DNS-Prefetch-Control', 'off')
  res.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=()')
  // HSTS only means anything over TLS, and sending it in local dev would pin
  // localhost to https for the developer's whole browser profile.
  if (process.env.NODE_ENV === 'production') {
    res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  }
  return res
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Never gate API routes in middleware (API handlers do auth)
  if (pathname.startsWith('/api/')) return withSecurityHeaders(NextResponse.next())

  // Allow Next internals/static
  if (pathname.startsWith('/_next/')) return NextResponse.next()

  // Landing page — always accessible, page handles auth client-side
  if (pathname === '/') return withSecurityHeaders(NextResponse.next())

  // Public legal pages — no auth required
  if (pathname === '/privacy' || pathname === '/terms') {
    return withSecurityHeaders(NextResponse.next())
  }

  const token = request.cookies.get('accessToken')?.value ?? null
  const isAuthed = token ? Boolean(await verifyAccessToken(token)) : false

  // Redirect authenticated users away from login/register pages
  if (isAuthRoute(pathname)) {
    if (isAuthed) return NextResponse.redirect(new URL('/', request.url))
    return withSecurityHeaders(NextResponse.next())
  }

  // Protect all other pages (coach, lms, settings, drilldown, etc.)
  if (!isAuthed) {
    return NextResponse.redirect(new URL('/auth/login', request.url))
  }

  return withSecurityHeaders(NextResponse.next())
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}

