/**
 * middleware.ts — Route protection, JWT verification, and company_id validation
 *
 * CRITICAL SECURITY: Every request to protected routes validates:
 * 1. JWT token is valid and not expired
 * 2. company_id is present in token
 * 3. company_id is passed to downstream handlers via headers
 */

import { NextRequest, NextResponse } from 'next/server'
import { verifyAccessToken, extractTokenFromHeader } from './lib/auth'
import { sanitizeCompanyId, logSecurityEvent } from './lib/multi-tenant'

// Public routes that don't require authentication
const PUBLIC_ROUTES = ['/auth/login', '/auth/register', '/api/auth/login', '/api/auth/register', '/api/health']
// Protected dashboard routes that require authentication
const PROTECTED_ROUTES = ['/settings', '/certification', '/coach', '/lms', '/simulator', '/second-brain', '/drilldown']

function isPublicRoute(pathname: string): boolean {
  // Home page (/) is public but handled separately
  if (pathname === '/') return true
  // Check if pathname starts with any public API route
  return PUBLIC_ROUTES.some((route) => pathname.startsWith(route))
}

function isProtectedRoute(pathname: string): boolean {
  // Check if pathname starts with any protected route
  return PROTECTED_ROUTES.some((route) => pathname.startsWith(route))
}

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Allow public routes (home, auth pages, public APIs)
  if (isPublicRoute(pathname)) {
    // Redirect authenticated users away from auth pages
    if (pathname.startsWith('/auth/')) {
      const token = request.cookies.get('accessToken')?.value
      if (token && verifyAccessToken(token)) {
        return NextResponse.redirect(new URL('/', request.url))
      }
    }
    return NextResponse.next()
  }

  // Check for protected routes (dashboard routes)
  if (isProtectedRoute(pathname)) {
    // Get token from cookie or header
    let token: string | null = request.cookies.get('accessToken')?.value ?? null
    if (!token) {
      const authHeader = request.headers.get('authorization')
      token = extractTokenFromHeader(authHeader)
    }

    // No token, redirect to login
    if (!token) {
      logSecurityEvent('access_denied', {
        reason: 'missing_token',
        pathname,
      })
      return NextResponse.redirect(new URL('/auth/login', request.url))
    }

    // Verify token and validate company_id
    const payload = verifyAccessToken(token)
    if (!payload) {
      logSecurityEvent('access_denied', {
        reason: 'invalid_token',
        pathname,
      })
      return NextResponse.redirect(new URL('/auth/login', request.url))
    }

    // CRITICAL: Validate company_id is present and valid
    const sanitized = sanitizeCompanyId(payload.company_id)
    if (!sanitized) {
      logSecurityEvent('access_denied', {
        reason: 'invalid_company_id_format',
        pathname,
        company_id: payload.company_id,
      })
      return NextResponse.redirect(new URL('/auth/login', request.url))
    }

    // Token is valid with valid company_id, allow request
    const response = NextResponse.next()
    response.headers.set('x-user-id', payload.user_id.toString())
    response.headers.set('x-user-company', payload.company_id)
    response.headers.set('x-user-company-id', sanitized)
    return response
  }

  // For all other routes, check if they're protected API routes
  if (pathname.startsWith('/api/')) {
    let token: string | null = request.cookies.get('accessToken')?.value ?? null
    if (!token) {
      const authHeader = request.headers.get('authorization')
      token = extractTokenFromHeader(authHeader)
    }

    if (token) {
      const payload = verifyAccessToken(token)
      if (payload) {
        // CRITICAL: Validate company_id is present and valid
        const sanitized = sanitizeCompanyId(payload.company_id)
        if (!sanitized) {
          logSecurityEvent('access_denied', {
            reason: 'invalid_company_id_in_api',
            pathname,
            company_id: payload.company_id,
          })
          return NextResponse.json(
            { success: false, data: { message: 'Invalid company ID' }, meta: {} },
            { status: 401 }
          )
        }

        const response = NextResponse.next()
        response.headers.set('x-user-id', payload.user_id.toString())
        response.headers.set('x-user-company', payload.company_id)
        response.headers.set('x-user-company-id', sanitized)
        return response
      }
    }

    // For protected API routes, return 401
    if (!isPublicRoute(pathname)) {
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
