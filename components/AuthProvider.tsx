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

  // Check auth on mount (page refresh / direct URL visit)
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch('/api/auth/me', { credentials: 'include' })
        if (response.ok) {
          const data = await response.json()
          setState({ user: data.data.user, isLoading: false, isAuthenticated: true })
        } else {
          setState({ user: null, isLoading: false, isAuthenticated: false })
        }
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
