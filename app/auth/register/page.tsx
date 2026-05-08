'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Eye, EyeOff, AlertCircle, CheckCircle2 } from 'lucide-react'
import { useAuthContext } from '@/components/AuthProvider'
import { APP_NAME } from '@/lib/constants'
import { useT } from '@/lib/lang-store'

function PasswordStrength({ password }: { password: string }) {
  const t = useT()

  const getStrength = () => {
    if (!password) return { level: 0, label: '', color: 'bg-slate-300' }

    let strength = 0
    if (password.length >= 8) strength++
    if (/[A-Z]/.test(password)) strength++
    if (/[0-9]/.test(password)) strength++
    if (/[^a-zA-Z0-9]/.test(password)) strength++

    if (strength <= 1) return { level: 1, label: t.registerPwWeak,   color: 'bg-red-500'    }
    if (strength === 2) return { level: 2, label: t.registerPwFair,   color: 'bg-yellow-500' }
    if (strength === 3) return { level: 3, label: t.registerPwGood,   color: 'bg-blue-500'   }
    return                      { level: 4, label: t.registerPwStrong, color: 'bg-green-500'  }
  }

  const strength = getStrength()

  return (
    <div className="mt-2 space-y-2">
      <div className="flex gap-1">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i <= strength.level ? strength.color : 'bg-slate-200'
            }`}
          />
        ))}
      </div>
      {strength.label && (
        <p className="text-xs font-medium text-slate-600">
          {t.registerPwStrength}{' '}
          <span className={
            strength.color === 'bg-red-500'    ? 'text-red-600'    :
            strength.color === 'bg-yellow-500' ? 'text-yellow-600' :
            strength.color === 'bg-blue-500'   ? 'text-blue-600'   :
            'text-green-600'
          }>
            {strength.label}
          </span>
        </p>
      )}
    </div>
  )
}

export default function RegisterPage() {
  const router = useRouter()
  const { setAuthenticated } = useAuthContext()
  const t = useT()
  const [fullName, setFullName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [showConfirmPassword, setShowConfirmPassword] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState('')

  const validatePassword = () => {
    if (password.length < 8)            return t.registerErrPwLen
    if (!/[A-Z]/.test(password))        return t.registerErrPwUpper
    if (!/[0-9]/.test(password))        return t.registerErrPwNum
    if (!/[^a-zA-Z0-9]/.test(password)) return t.registerErrPwSpecial
    return null
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setIsLoading(true)

    if (!fullName.trim()) {
      setError(t.registerErrName)
      setIsLoading(false)
      return
    }

    if (!email) {
      setError(t.registerErrEmail)
      setIsLoading(false)
      return
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      setError(t.registerErrEmailValid)
      setIsLoading(false)
      return
    }

    const passwordError = validatePassword()
    if (passwordError) {
      setError(passwordError)
      setIsLoading(false)
      return
    }

    if (password !== confirmPassword) {
      setError(t.registerErrPwMatch)
      setIsLoading(false)
      return
    }

    try {
      const response = await fetch('/api/auth/register', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          full_name: fullName,
          email,
          password,
        }),
        credentials: 'include',
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.data?.message || t.registerErrFailed)
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
      setError(t.registerErrOccurred)
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
          <span className="ml-3 font-bold text-xl text-slate-900" translate="no">{APP_NAME}</span>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
          <div className="mb-8">
            <h1 className="text-2xl font-bold text-slate-900 mb-2">{t.registerTitle}</h1>
            <p className="text-sm text-slate-600">
              {t.registerSubtitle.split('{APP_NAME}')[0]}
              <span translate="no">{APP_NAME}</span>
              {t.registerSubtitle.split('{APP_NAME}')[1]}
            </p>
          </div>

          {/* Error Banner */}
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              className="mb-6 flex gap-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            >
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </motion.div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Full Name */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                {t.registerFullName}
              </label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder={t.registerFullNamePh}
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-transparent focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                {t.registerEmailLabel}
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t.loginEmailPh}
                className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-transparent focus:outline-none focus:ring-2 focus:ring-red-500"
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                {t.registerPasswordLabel}
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-transparent focus:outline-none focus:ring-2 focus:ring-red-500"
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
              {password && <PasswordStrength password={password} />}
            </div>

            {/* Confirm Password */}
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                {t.registerConfirmPwLabel}
              </label>
              <div className="relative">
                <input
                  type={showConfirmPassword ? 'text' : 'password'}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 transition-colors focus:border-transparent focus:outline-none focus:ring-2 focus:ring-red-500"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700 transition-colors"
                >
                  {showConfirmPassword ? (
                    <EyeOff className="w-4 h-4" />
                  ) : (
                    <Eye className="w-4 h-4" />
                  )}
                </button>
              </div>
              {password && confirmPassword && password === confirmPassword && (
                <p className="mt-2 flex items-center gap-1.5 text-xs text-green-600 font-medium">
                  <CheckCircle2 className="w-3.5 h-3.5" />
                  {t.registerPwMatch}
                </p>
              )}
            </div>

            {/* Submit Button */}
            <button
              type="submit"
              disabled={isLoading}
              className="w-full py-2.5 rounded-lg font-semibold text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {isLoading ? t.registerSubmitting : t.registerSubmit}
            </button>
          </form>

          {/* Divider */}
          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-300" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="px-2 bg-white text-slate-600">{t.registerAlreadyHave}</span>
            </div>
          </div>

          {/* Sign In Link */}
          <Link
            href="/auth/login"
            className="block w-full py-2.5 rounded-lg font-semibold text-center border border-slate-300 text-slate-900 hover:bg-slate-50 transition-colors"
          >
            {t.registerSignIn}
          </Link>
        </div>

        {/* Footer */}
        <p className="text-center text-xs text-slate-600 mt-6">
          {t.registerTermsText}{' '}
          <Link href="/terms" className="font-medium text-red-600 hover:text-red-700">
            {t.loginTermsService}
          </Link>
          {' '}{t.loginAnd}{' '}
          <Link href="/privacy" className="font-medium text-red-600 hover:text-red-700">
            {t.loginPrivacyPolicy}
          </Link>
        </p>
      </motion.div>
    </div>
  )
}
