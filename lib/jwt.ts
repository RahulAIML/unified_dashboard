import { SignJWT, jwtVerify } from 'jose'
import type { JwtClaims } from './auth-types'

const ACCESS_TOKEN_EXPIRY_SECONDS = 8 * 60 * 60        // 8 hours
const REFRESH_TOKEN_EXPIRY_SECONDS = 7 * 24 * 60 * 60  // 7 days

function requireEnv(name: string): string {
  const v = process.env[name]
  if (!v) throw new Error(`${name} env var is not set`)
  return v
}

function accessSecret(): Uint8Array {
  return new TextEncoder().encode(requireEnv('JWT_SECRET'))
}

function refreshSecret(): Uint8Array {
  return new TextEncoder().encode(requireEnv('REFRESH_SECRET'))
}

export function extractTokenFromHeader(authHeader: string | null | undefined): string | null {
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null
  return authHeader.slice(7)
}

function newJti(prefix: string, userId: number) {
  return `${prefix}-${userId}-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

export async function signAccessToken(input: {
  user_id: number
  email: string
  customer_id: number
}): Promise<{ token: string; jti: string; exp: number }> {
  const jti = newJti('access', input.user_id)
  const iat = Math.floor(Date.now() / 1000)
  const exp = iat + ACCESS_TOKEN_EXPIRY_SECONDS

  const token = await new SignJWT({
    user_id: input.user_id,
    email: input.email,
    customer_id: input.customer_id,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .setJti(jti)
    .sign(accessSecret())

  return { token, jti, exp }
}

export async function signRefreshToken(input: {
  user_id: number
  email: string
  customer_id: number
}): Promise<{ token: string; jti: string; exp: number }> {
  const jti = newJti('refresh', input.user_id)
  const iat = Math.floor(Date.now() / 1000)
  const exp = iat + REFRESH_TOKEN_EXPIRY_SECONDS

  const token = await new SignJWT({
    user_id: input.user_id,
    email: input.email,
    customer_id: input.customer_id,
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt(iat)
    .setExpirationTime(exp)
    .setJti(jti)
    .sign(refreshSecret())

  return { token, jti, exp }
}

export async function verifyAccessToken(token: string): Promise<JwtClaims | null> {
  try {
    const { payload } = await jwtVerify(token, accessSecret(), { algorithms: ['HS256'] })
    return payload as unknown as JwtClaims
  } catch {
    return null
  }
}

export async function verifyRefreshToken(token: string): Promise<JwtClaims | null> {
  try {
    const { payload } = await jwtVerify(token, refreshSecret(), { algorithms: ['HS256'] })
    return payload as unknown as JwtClaims
  } catch {
    return null
  }
}

export const ACCESS_TOKEN_MAX_AGE_SECONDS = ACCESS_TOKEN_EXPIRY_SECONDS
export const REFRESH_TOKEN_MAX_AGE_SECONDS = REFRESH_TOKEN_EXPIRY_SECONDS

