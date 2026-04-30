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

const PUBLIC_PAGE_ROUTES = ['/auth/login', '/auth/register']

function isPublicPage(pathname: string) {
  return PUBLIC_PAGE_ROUTES.some((r) => pathname.startsWith(r))
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Never gate API routes in middleware (API handlers do auth)
  if (pathname.startsWith('/api/')) return NextResponse.next()

  // Allow Next internals/static
  if (pathname.startsWith('/_next/')) return NextResponse.next()

  const token = request.cookies.get('accessToken')?.value ?? null
  const isAuthed = token ? Boolean(await verifyAccessToken(token)) : false

  // Redirect authenticated users away from auth pages
  if (isPublicPage(pathname)) {
    if (isAuthed) return NextResponse.redirect(new URL('/', request.url))
    return NextResponse.next()
  }

  // Protect all non-auth pages
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

