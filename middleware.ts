/**
 * middleware.ts — Route protection and JWT verification (simplified for edge runtime)
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyAccessToken, extractTokenFromHeader } from './lib/auth'

const PUBLIC_ROUTES = ['/auth/login', '/auth/register', '/api/auth/login', '/api/auth/register', '/api/health', '/']
const PROTECTED_ROUTES = ['/settings', '/certification', '/coach', '/lms', '/simulator', '/second-brain']

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow public routes
  if (PUBLIC_ROUTES.some((route) => pathname.startsWith(route))) {
    // Redirect authenticated users away from auth pages
    if (pathname.startsWith('/auth/')) {
      const token = request.cookies.get('accessToken')?.value
      if (token && verifyAccessToken(token)) {
        return NextResponse.redirect(new URL('/', request.url))
      }
    }
    return NextResponse.next()
  }

  // Check for protected routes
  const isProtectedRoute = PROTECTED_ROUTES.some((route) => pathname === route)

  if (isProtectedRoute) {
    // Get token from cookie or header
    let token: string | null = request.cookies.get('accessToken')?.value ?? null
    if (!token) {
      const authHeader = request.headers.get('authorization')
      token = extractTokenFromHeader(authHeader)
    }

    // No token, redirect to login
    if (!token) {
      return NextResponse.redirect(new URL('/auth/login', request.url))
    }

    // Verify token
    const payload = verifyAccessToken(token)
    if (!payload) {
      return NextResponse.redirect(new URL('/auth/login', request.url))
    }

    // Token is valid, allow request
    const response = NextResponse.next()
    response.headers.set('x-user-id', payload.user_id.toString())
    response.headers.set('x-user-company', payload.company_id)
    return response
  }

  // For API routes, verify token if not public
  if (pathname.startsWith('/api/')) {
    let token: string | null = request.cookies.get('accessToken')?.value ?? null
    if (!token) {
      const authHeader = request.headers.get('authorization')
      token = extractTokenFromHeader(authHeader)
    }

    if (token) {
      const payload = verifyAccessToken(token)
      if (payload) {
        const response = NextResponse.next()
        response.headers.set('x-user-id', payload.user_id.toString())
        response.headers.set('x-user-company', payload.company_id)
        return response
      }
    }

    // For protected API routes, return 401
    if (!PUBLIC_ROUTES.includes(pathname)) {
      return NextResponse.json({ success: false, data: { message: 'Unauthorized' }, meta: {} }, { status: 401 })
    }
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico (favicon file)
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
}
