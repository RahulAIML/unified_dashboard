'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Eye, EyeOff, AlertCircle } from 'lucide-react'
import { detectCompanyFromEmail, getCompanyDisplayName } from '@/lib/company-mapping'

export default function LoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')
  const [companyHint, setCompanyHint] = useState<string | null>(null)

  // Show company hint as user types email
  useEffect(() => {
    if (!email) {
      setCompanyHint(null)
      return
    }

    const company = detectCompanyFromEmail(email)
    if (company) {
      setCompanyHint(getCompanyDisplayName(company))
    } else {
      setCompanyHint(null)
    }
  }, [email])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    // Basic validation
    if (!email || !password) {
      setError('Email and password are required')
      setIsLoading(false)
      return
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError('Please enter a valid email address')
      setIsLoading(false)
      return
    }

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ email, password }),
        credentials: 'include',
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.data?.message || 'Login failed. Please try again.')
        setIsLoading(false)
        return
      }

      // Success - redirect to dashboard
      router.push('/')
    } catch (err) {
      setError('An error occurred. Please try again.')
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center px-4 py-12">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-md"
      >
        {/* Logo */}
        <div className="flex items-center justify-center mb-8">
          <div
            className="w-12 h-12 rounded-lg flex items-center justify-center font-bold text-white text-lg"
            style={{ background: 'linear-gradient(135deg, #DC2626 0%, #3B82F6 100%)' }}
          >
            RP
          </div>
          <span className="ml-3 font-bold text-xl text-slate-900">RolPlay</span>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-slate-900 mb-2">Welcome Back</h1>
            <p className="text-sm text-slate-600">
              Sign in to your account to access the analytics dashboard
            </p>
          </div>

          {/* Error Banner */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 flex items-start gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </motion.div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Email Address
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition-colors"
              />
              {companyHint && (
                <p className="mt-2 text-xs text-blue-600 font-medium">
                  🏢 Logging into <strong>{companyHint}</strong>
                </p>
              )}
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent transition-colors"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700 transition-colors"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Forgot Password Link */}
            <div className="text-right">
              <Link
                href="#"
                className="text-xs font-medium text-red-600 hover:text-red-700 transition-colors"
              >
                Forgot password?
              </Link>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 rounded-lg font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

          {/* Divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-300" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="px-2 bg-white text-slate-600">New to RolPlay?</span>
            </div>
          </div>

          {/* Sign Up Link */}
          <Link
            href="/auth/register"
            className="block w-full py-2.5 rounded-lg font-semibold text-center border border-slate-300 text-slate-900 hover:bg-slate-50 transition-colors"
          >
            Create Account
          </Link>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-slate-600 mt-6">
          By signing in, you agree to our{' '}
          <a href="#" className="font-medium text-red-600 hover:text-red-700">
            Terms of Service
          </a>
          {' '}and{' '}
          <a href="#" className="font-medium text-red-600 hover:text-red-700">
            Privacy Policy
          </a>
        </p>
      </motion.div>
    </div>
  )
}
