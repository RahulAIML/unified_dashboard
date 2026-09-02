export interface AuthUser {
  id: number
  email: string
  full_name: string
  customer_id: number
  role: 'user' | 'admin'
  created_at: string
  /** NULL = the first-time guided tour has not been dismissed (completed or
   *  skipped) yet, so it should auto-show once. Non-null = don't auto-show
   *  again; "Replay guided tour" in Settings re-opens it client-side without
   *  touching this field until it's dismissed again. */
  onboarding_completed_at: string | null
}

export interface JwtClaims {
  user_id: number
  email: string
  customer_id: number
  jti: string
  iat: number
  exp: number
}

export interface AccessStatus {
  /** User has DB records (coach_app) */
  hasCoachData: boolean
  /** User has Second Brain API records */
  hasSecondBrainData: boolean
  /** Overall: user has access to at least one module */
  hasAnyAccess: boolean
}

