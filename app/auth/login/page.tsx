'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Eye, EyeOff, AlertCircle } from 'lucide-react'
import { useAuthContext } from '@/components/AuthProvider'
import { APP_NAME } from '@/lib/constants'
import { useT } from '@/lib/lang-store'

export default function LoginPage() {
  const router = useRouter()
  const { setAuthenticated } = useAuthContext()
  const t = useT()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    // Basic validation
    if (!email || !password) {
      setError(t.loginErrRequired)
      setIsLoading(false)
      return
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError(t.loginErrInvalidEmail)
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
        setError(data.data?.message || t.loginErrFailed)
        setIsLoading(false)
        return
      }

      // Update auth context immediately — no page reload needed
      if (data.data?.user) {
        setAuthenticated(data.data.user)
      }
      // Redirect to dashboard
      router.push('/')
    } catch {
      setError(t.loginErrOccurred)
      setIsLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center px-4 py-12" style={{ background: 'linear-gradient(135deg, #0f1c3f 0%, #162040 50%, #1a2744 100%)' }}>
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-md"
      >
        {/* Logo */}
        <div className="flex justify-center mb-10">
          <img src="/logo_rolplay.png" alt="Rolplay" className="h-16 object-contain" />
        </div>

        {/* Card */}
        <div className="rounded-xl shadow-2xl p-8" style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', backdropFilter: 'blur(10px)' }}>
          <div className="mb-7">
            <h1 className="text-2xl font-bold text-white mb-1">{t.loginTitle}</h1>
            <p className="text-sm text-slate-400">{t.loginSubtitle}</p>
          </div>

          {/* Error Banner */}
          {error && (
            <motion.div
              role="alert"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-5 flex items-start gap-3 rounded-lg p-3 text-sm text-red-400"
              style={{ background: 'rgba(220,38,38,0.1)', border: '1px solid rgba(220,38,38,0.3)' }}
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </motion.div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email */}
            <div>
              <label htmlFor="login-email" className="block text-sm font-medium text-slate-300 mb-1.5">
                {t.loginEmailLabel}
              </label>
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t.loginEmailPh}
                className="w-full rounded-lg px-4 py-2.5 text-sm text-white placeholder:text-slate-500 transition-all focus:outline-none focus:ring-2 focus:ring-red-500"
                style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)' }}
              />
            </div>

            {/* Password */}
            <div>
              <label htmlFor="login-password" className="block text-sm font-medium text-slate-300 mb-1.5">
                {t.loginPasswordLabel}
              </label>
              <div className="relative">
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-lg px-4 py-2.5 pr-10 text-sm text-white placeholder:text-slate-500 transition-all focus:outline-none focus:ring-2 focus:ring-red-500"
                  style={{ background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.15)' }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? t.loginHidePassword : t.loginShowPassword}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-white transition-colors"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 rounded-lg font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              style={{ background: 'linear-gradient(135deg, #cc1f1f 0%, #e53e3e 100%)' }}
            >
              {isLoading ? t.loginSubmitting : t.loginSubmit}
            </button>
          </form>

          {/* Divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full" style={{ borderTop: '1px solid rgba(255,255,255,0.1)' }} />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="px-2 text-slate-400" style={{ background: 'transparent' }}>{t.loginNewTo} <span translate="no">{APP_NAME}</span>?</span>
            </div>
          </div>

          {/* Sign Up Link */}
          <Link
            href="/auth/register"
            className="block w-full py-2.5 rounded-lg font-semibold text-center text-slate-300 hover:text-white transition-colors"
            style={{ border: '1px solid rgba(255,255,255,0.15)' }}
          >
            {t.loginCreateAccount}
          </Link>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-slate-500 mt-6">
          {t.loginTermsText}{' '}
          <a href="#" className="font-medium text-red-400 hover:text-red-300 hover:underline">
            {t.loginTermsService}
          </a>
          {' '}{t.loginAnd}{' '}
          <Link href="/privacy" className="font-medium text-red-400 hover:text-red-300 hover:underline">
            {t.loginPrivacyPolicy}
          </Link>
        </p>
      </motion.div>
    </div>
  )
}
