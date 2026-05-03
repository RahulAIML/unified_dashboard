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

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Never gate API routes in middleware (API handlers do auth)
  if (pathname.startsWith('/api/')) return NextResponse.next()

  // Allow Next internals/static
  if (pathname.startsWith('/_next/')) return NextResponse.next()

  // Landing page — always accessible, page handles auth client-side
  if (pathname === '/') return NextResponse.next()

  // Public legal pages — no auth required
  if (pathname === '/privacy' || pathname === '/terms') return NextResponse.next()

  const token = request.cookies.get('accessToken')?.value ?? null
  const isAuthed = token ? Boolean(await verifyAccessToken(token)) : false

  // Redirect authenticated users away from login/register pages
  if (isAuthRoute(pathname)) {
    if (isAuthed) return NextResponse.redirect(new URL('/', request.url))
    return NextResponse.next()
  }

  // Protect all other pages (coach, lms, settings, drilldown, etc.)
  if (!isAuthed) {
    return NextResponse.redirect(new URL('/auth/login', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}

