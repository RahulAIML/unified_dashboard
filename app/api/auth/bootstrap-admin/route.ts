/** One-time promotion for the first administrator. */
import { timingSafeEqual } from 'crypto'
import { NextRequest } from 'next/server'
import { buildApiError, buildSuccess } from '@/lib/api-utils'
import { promoteFirstAdmin, DbError } from '@/lib/db-users'
import { validateEmail } from '@/lib/password'
import { rateLimit, clientKey } from '@/lib/rate-limit'

export const runtime = 'nodejs'

const BOOTSTRAP_LIMIT = 5
const BOOTSTRAP_WINDOW_MS = 60_000

function isValidSetupSecret(provided: string | null): boolean {
  const expected = process.env.SETUP_SECRET
  if (!expected || !provided) return false
  const expectedBuffer = Buffer.from(expected)
  const providedBuffer = Buffer.from(provided)
  return expectedBuffer.length === providedBuffer.length && timingSafeEqual(expectedBuffer, providedBuffer)
}

export async function POST(request: NextRequest) {
  const limit = rateLimit(clientKey(request, 'bootstrap-admin'), BOOTSTRAP_LIMIT, BOOTSTRAP_WINDOW_MS)
  if (!limit.ok) {
    return buildApiError('Too many bootstrap attempts. Try again shortly.', 429, {
      retryAfterSeconds: limit.retryAfter,
    })
  }

  if (!isValidSetupSecret(request.headers.get('x-setup-secret'))) {
    return buildApiError('Unauthorized', 401)
  }

  let body: { email?: string }
  try {
    body = await request.json()
  } catch {
    return buildApiError('Invalid JSON in request body', 400)
  }

  const email = body.email?.toLowerCase().trim() ?? ''
  if (!validateEmail(email)) return buildApiError('A valid email address is required', 400)

  try {
    const user = await promoteFirstAdmin(email)
    if (!user) {
      return buildApiError(
        'Bootstrap unavailable: an administrator already exists, or the account is missing or inactive.',
        409,
      )
    }

    console.info(`[audit] bootstrap-admin promoted=${user.email}`)
    return buildSuccess({ user: { id: user.id, email: user.email, role: user.role } })
  } catch (error) {
    if (error instanceof DbError) {
      console.error('[/api/auth/bootstrap-admin] Auth DB error:', error.code)
      return buildApiError('Unable to bootstrap an administrator right now.', 503)
    }
    console.error('[/api/auth/bootstrap-admin] Unexpected error:', error)
    return buildApiError('Unable to bootstrap an administrator right now.', 500)
  }
}
