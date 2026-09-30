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
    <div className="min-h-screen bg-gradient-to-br from-rose-950 to-slate-900 flex items-center justify-center px-4 py-12">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="w-full max-w-md"
      >
        {/* Logo */}
        <div className="flex justify-center mb-8">
          <img src="/logo_rolplay.png" alt="Rolplay" className="h-12 object-contain" />
        </div>

        {/* Card */}
        <div className="bg-slate-800/50 backdrop-blur rounded-2xl shadow-[0_1px_3px_rgba(0,0,0,0.05),0_1px_2px_rgba(0,0,0,0.02)] border border-rose-400/20 p-8">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-white mb-2">{t.loginTitle}</h1>
            <p className="text-sm text-slate-300">{t.loginSubtitle}</p>
          </div>

          {/* Error Banner */}
          {error && (
            <motion.div
              role="alert"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </motion.div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email */}
            <div>
              <label htmlFor="login-email" className="block text-sm font-medium text-foreground mb-2">
                {t.loginEmailLabel}
              </label>
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t.loginEmailPh}
                className="w-full rounded-lg border border-rose-400/30 bg-slate-700/50 px-4 py-2.5 text-sm text-white placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 focus:ring-rose-500"
              />
            </div>

            {/* Password */}
            <div>
              <label htmlFor="login-password" className="block text-sm font-medium text-foreground mb-2">
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
                  className="w-full rounded-lg border border-rose-400/30 bg-slate-700/50 px-4 py-2.5 pr-10 text-sm text-white placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? t.loginHidePassword : t.loginShowPassword}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
                >
                  {showPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 rounded-lg font-semibold text-white bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-600 hover:to-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? t.loginSubmitting : t.loginSubmit}
            </button>
          </form>

          {/* Divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="px-2 bg-card text-muted-foreground">{t.loginNewTo} <span translate="no">{APP_NAME}</span>?</span>
            </div>
          </div>

          {/* Sign Up Link */}
          <Link
            href="/auth/register"
            className="block w-full py-2.5 rounded-lg font-semibold text-center border border-border/60 text-foreground hover:bg-muted transition-colors"
          >
            {t.loginCreateAccount}
          </Link>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-muted-foreground mt-6">
          {t.loginTermsText}{' '}
          <a href="#" className="font-medium text-primary hover:underline">
            {t.loginTermsService}
          </a>
          {' '}{t.loginAnd}{' '}
          <Link href="/privacy" className="font-medium text-primary hover:underline">
            {t.loginPrivacyPolicy}
          </Link>
        </p>
      </motion.div>
    </div>
  )
}
