'use client'

import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react'

export interface AuthUser {
  id: number
  email: string
  full_name: string
  company_id: string
  role: 'user' | 'admin'
}

interface AuthContextType {
  user: AuthUser | null
  isLoading: boolean
  isAuthenticated: boolean
  /** Call this immediately after a successful login/register response */
  setAuthenticated: (user: AuthUser) => void
  /** Call this on logout */
  clearAuth: () => void
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{
    user: AuthUser | null
    isLoading: boolean
    isAuthenticated: boolean
  }>({
    user: null,
    isLoading: true,
    isAuthenticated: false,
  })

  // Check auth on mount (page refresh / direct URL visit).
  // If access token is expired, automatically attempts a silent refresh
  // using the refresh token cookie before giving up.
  useEffect(() => {
    const checkAuth = async () => {
      try {
        // ── 1. Try with current access token ────────────────────────
        const meRes = await fetch('/api/auth/me', { credentials: 'include' })

        if (meRes.ok) {
          const data = await meRes.json()
          setState({ user: data.data.user, isLoading: false, isAuthenticated: true })
          return
        }

        // ── 2. Access token expired/missing — try silent refresh ─────
        if (meRes.status === 401) {
          const refreshRes = await fetch('/api/auth/refresh', {
            method: 'POST',
            credentials: 'include',
          })

          if (refreshRes.ok) {
            // New access token is now in cookie — retry /me
            const meRes2 = await fetch('/api/auth/me', { credentials: 'include' })
            if (meRes2.ok) {
              const data2 = await meRes2.json()
              setState({ user: data2.data.user, isLoading: false, isAuthenticated: true })
              return
            }
          }
        }

        // ── 3. Both attempts failed — not authenticated ──────────────
        setState({ user: null, isLoading: false, isAuthenticated: false })

      } catch {
        setState({ user: null, isLoading: false, isAuthenticated: false })
      }
    }
    checkAuth()
  }, [])

  // Called by login/register pages after a successful API response
  // Updates context immediately — no page reload needed
  const setAuthenticated = useCallback((user: AuthUser) => {
    setState({ user, isLoading: false, isAuthenticated: true })
  }, [])

  // Called by logout
  const clearAuth = useCallback(() => {
    setState({ user: null, isLoading: false, isAuthenticated: false })
  }, [])

  return (
    <AuthContext.Provider value={{ ...state, setAuthenticated, clearAuth }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuthContext() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuthContext must be used within AuthProvider')
  }
  return context
}
