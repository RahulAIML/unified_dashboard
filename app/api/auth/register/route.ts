/**
 * /api/auth/register — User registration endpoint
 */

import { NextRequest, NextResponse } from 'next/server'
import { createUser, emailExists, findUserByEmail } from '@/lib/db-users'
import {
  hashPassword,
  generateAccessToken,
  generateRefreshToken,
  validateEmail,
  validatePasswordStrength,
} from '@/lib/auth'
import { detectCompanyFromEmail } from '@/lib/company-mapping'
import { buildSuccess, buildApiError } from '@/lib/api-utils'

export const runtime = 'nodejs'

interface RegisterRequest {
  email: string
  password: string
  full_name: string
}

interface RegisterResponse {
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
    const body: RegisterRequest = await request.json()
    const { email, password, full_name } = body

    // Validation
    if (!email || !password || !full_name) {
      return buildApiError('Email, password, and full name are required', 400)
    }

    if (!validateEmail(email)) {
      return buildApiError('Invalid email format', 400)
    }

    const passwordValidation = validatePasswordStrength(password)
    if (!passwordValidation.valid) {
      return buildApiError(`Password too weak: ${passwordValidation.errors.join('; ')}`, 400)
    }

    // Check if email already exists
    const exists = await emailExists(email)
    if (exists) {
      return buildApiError('Email already registered', 409)
    }

    // Detect company from email domain
    const companyDomain = email.split('@')[1]?.toLowerCase() || email
    const companyId = detectCompanyFromEmail(email) || 'custom'

    // Hash password
    const passwordHash = await hashPassword(password)

    // Create user
    const user = await createUser(email, passwordHash, full_name, companyDomain, companyId)
    if (!user) {
      return buildApiError('Failed to create user', 500)
    }

    // Generate tokens
    const accessToken = generateAccessToken(user)
    const refreshToken = generateRefreshToken(user)

    // Response with tokens in httpOnly cookies
    const response = buildSuccess<RegisterResponse>({
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
    console.error('Register error:', error)
    return buildApiError('Internal server error', 500)
  }
}
