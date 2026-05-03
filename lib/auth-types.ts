export interface AuthUser {
  id: number
  email: string
  full_name: string
  customer_id: number
  role: 'user' | 'admin'
  created_at: string
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

