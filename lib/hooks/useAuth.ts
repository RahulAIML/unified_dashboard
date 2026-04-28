/**
 * useAuth.ts — Client-side authentication hook
 */

'use client'

import { useCallback, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'

export interface AuthUser {
  id: number
  email: string
  full_name: string
  company_id: string
  role: 'user' | 'admin'
}

interface AuthState {
  user: AuthUser | null
  isLoading: boolean
  isAuthenticated: boolean
  error: string | null
}

interface LoginCredentials {
  email: string
  password: string
}

interface RegisterCredentials {
  email: string
  password: string
  full_name: string
}

export function useAuth() {
  const router = useRouter()
  const [state, setState] = useState<AuthState>({
    user: null,
    isLoading: true,
    isAuthenticated: false,
    error: null,
  })

  // Check if user is authenticated on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch('/api/auth/me')
        if (response.ok) {
          const data = await response.json()
          setState({
            user: data.data.user,
            isLoading: false,
            isAuthenticated: true,
            error: null,
          })
        } else {
          setState({
            user: null,
            isLoading: false,
            isAuthenticated: false,
            error: null,
          })
        }
      } catch (error) {
        setState({
          user: null,
          isLoading: false,
          isAuthenticated: false,
          error: 'Failed to check authentication',
        })
      }
    }

    checkAuth()
  }, [])

  const login = useCallback(
    async (credentials: LoginCredentials) => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }))
      try {
        const response = await fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(credentials),
        })

        if (!response.ok) {
          const data = await response.json()
          setState((prev) => ({
            ...prev,
            isLoading: false,
            error: data.data.message || 'Login failed',
          }))
          return false
        }

        const data = await response.json()
        setState({
          user: data.data.user,
          isLoading: false,
          isAuthenticated: true,
          error: null,
        })
        router.push('/')
        return true
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Login failed'
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: errorMessage,
        }))
        return false
      }
    },
    [router]
  )

  const register = useCallback(
    async (credentials: RegisterCredentials) => {
      setState((prev) => ({ ...prev, isLoading: true, error: null }))
      try {
        const response = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(credentials),
        })

        if (!response.ok) {
          const data = await response.json()
          setState((prev) => ({
            ...prev,
            isLoading: false,
            error: data.data.message || 'Registration failed',
          }))
          return false
        }

        const data = await response.json()
        setState({
          user: data.data.user,
          isLoading: false,
          isAuthenticated: true,
          error: null,
        })
        router.push('/')
        return true
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Registration failed'
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: errorMessage,
        }))
        return false
      }
    },
    [router]
  )

  const logout = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true }))
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
      setState({
        user: null,
        isLoading: false,
        isAuthenticated: false,
        error: null,
      })
      router.push('/auth/login')
    } catch (error) {
      console.error('Logout failed:', error)
      setState({
        user: null,
        isLoading: false,
        isAuthenticated: false,
        error: null,
      })
      router.push('/auth/login')
    }
  }, [router])

  return {
    ...state,
    login,
    register,
    logout,
  }
}
