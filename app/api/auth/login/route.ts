/**
 * /api/auth/login — User login endpoint
 */

import { NextRequest, NextResponse } from 'next/server'
import { getUserPasswordHash, findUserByEmail, createSession, updateUserLastLogin } from '@/lib/db-users'
import { verifyPassword, generateAccessToken, generateRefreshToken } from '@/lib/auth'
import { buildSuccess, buildApiError } from '@/lib/api-utils'

export const runtime = 'nodejs'

interface LoginRequest {
  email: string
  password: string
}

interface LoginResponse {
  user: {
    id: number
    email: string
    full_name: string
    company_id: string
  }
  access_token: string
  refresh_token: string
}

export async function POST(request: NextRequest) {
  try {
    const body: LoginRequest = await request.json()
    const { email, password } = body

    // Validation
    if (!email || !password) {
      return buildApiError('Email and password are required', 400)
    }

    // Find user
    const user = await findUserByEmail(email)
    if (!user) {
      return buildApiError('Invalid email or password', 401)
    }

    // Verify password
    const passwordHash = await getUserPasswordHash(email)
    if (!passwordHash) {
      return buildApiError('Invalid email or password', 401)
    }

    const passwordValid = await verifyPassword(password, passwordHash)
    if (!passwordValid) {
      return buildApiError('Invalid email or password', 401)
    }

    // Generate tokens
    const accessToken = generateAccessToken(user)
    const refreshToken = generateRefreshToken(user)

    // Create session record
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days
    await createSession(user.id, `refresh-${user.id}-${Date.now()}`, expiresAt)

    // Update last login
    await updateUserLastLogin(user.id)

    // Response with tokens in httpOnly cookies
    const response = buildSuccess<LoginResponse>({
      user: {
        id: user.id,
        email: user.email,
        full_name: user.full_name,
        company_id: user.company_id,
      },
      access_token: accessToken,
      refresh_token: refreshToken,
    })

    // Set httpOnly cookies
    response.cookies.set('accessToken', accessToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 15 * 60, // 15 minutes
      path: '/',
    })

    response.cookies.set('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60, // 7 days
      path: '/',
    })

    return response
  } catch (error) {
    console.error('Login error:', error)
    return buildApiError('Internal server error', 500)
  }
}
