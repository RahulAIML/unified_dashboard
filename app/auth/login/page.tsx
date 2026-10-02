'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import { Eye, EyeOff, AlertCircle, Loader2 } from 'lucide-react'
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
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
        credentials: 'include',
      })

      const data = await response.json()

      if (!response.ok) {
        setError(data.data?.message || t.loginErrFailed)
        setIsLoading(false)
        return
      }

      if (data.data?.user) {
        setAuthenticated(data.data.user)
      }
      router.push('/')
    } catch {
      setError(t.loginErrOccurred)
      setIsLoading(false)
    }
  }

  return (
    <div
      className="min-h-screen flex items-center justify-center px-4 py-10"
      style={{
        background: 'radial-gradient(ellipse 120% 80% at 50% 40%, rgba(180,20,30,0.07) 0%, transparent 60%), linear-gradient(160deg, #0b1424 0%, #0f1c36 45%, #111827 100%)',
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.97 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.3 }}
        className="w-full"
        style={{ maxWidth: 420 }}
      >
        {/* Logo */}
        <div className="flex justify-center" style={{ marginBottom: 36 }}>
          <img
            src="/logo_rolplay.png"
            alt="RolPlay"
            style={{ height: 48, width: 'auto', maxWidth: 160, objectFit: 'contain' }}
          />
        </div>

        {/* Card */}
        <div
          style={{
            background: 'rgba(255,255,255,0.04)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 18,
            boxShadow: '0 24px 64px rgba(0,0,0,0.45), 0 1px 0 rgba(255,255,255,0.05) inset',
            padding: '36px 36px 28px',
          }}
        >
          {/* Heading */}
          <div style={{ marginBottom: 28 }}>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#fff', margin: 0, lineHeight: 1.3 }}>
              {t.loginTitle}
            </h1>
            <p style={{ fontSize: 14, color: '#94a3b8', margin: '6px 0 0', lineHeight: 1.5 }}>
              {t.loginSubtitle}
            </p>
          </div>

          {/* Error */}
          {error && (
            <motion.div
              role="alert"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: '11px 14px',
                borderRadius: 10,
                background: 'rgba(220,38,38,0.1)',
                border: '1px solid rgba(220,38,38,0.25)',
                marginBottom: 20,
              }}
            >
              <AlertCircle size={15} style={{ color: '#f87171', flexShrink: 0, marginTop: 1 }} />
              <span style={{ fontSize: 13, color: '#f87171', lineHeight: 1.5 }}>{error}</span>
            </motion.div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} noValidate style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {/* Email */}
            <div>
              <label
                htmlFor="login-email"
                style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#cbd5e1', marginBottom: 7 }}
              >
                {t.loginEmailLabel}
              </label>
              <input
                id="login-email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t.loginEmailPh}
                disabled={isLoading}
                style={{
                  width: '100%',
                  height: 46,
                  padding: '0 14px',
                  borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.1)',
                  background: 'rgba(255,255,255,0.05)',
                  color: '#fff',
                  fontSize: 14,
                  outline: 'none',
                  boxSizing: 'border-box',
                  transition: 'border-color 0.15s, box-shadow 0.15s',
                }}
                onFocus={(e) => {
                  e.target.style.borderColor = 'rgba(220,38,38,0.6)'
                  e.target.style.boxShadow = '0 0 0 3px rgba(220,38,38,0.12)'
                }}
                onBlur={(e) => {
                  e.target.style.borderColor = 'rgba(255,255,255,0.1)'
                  e.target.style.boxShadow = 'none'
                }}
              />
            </div>

            {/* Password */}
            <div>
              <label
                htmlFor="login-password"
                style={{ display: 'block', fontSize: 13, fontWeight: 600, color: '#cbd5e1', marginBottom: 7 }}
              >
                {t.loginPasswordLabel}
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  id="login-password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  disabled={isLoading}
                  style={{
                    width: '100%',
                    height: 46,
                    padding: '0 44px 0 14px',
                    borderRadius: 10,
                    border: '1px solid rgba(255,255,255,0.1)',
                    background: 'rgba(255,255,255,0.05)',
                    color: '#fff',
                    fontSize: 14,
                    outline: 'none',
                    boxSizing: 'border-box',
                    transition: 'border-color 0.15s, box-shadow 0.15s',
                  }}
                  onFocus={(e) => {
                    e.target.style.borderColor = 'rgba(220,38,38,0.6)'
                    e.target.style.boxShadow = '0 0 0 3px rgba(220,38,38,0.12)'
                  }}
                  onBlur={(e) => {
                    e.target.style.borderColor = 'rgba(255,255,255,0.1)'
                    e.target.style.boxShadow = 'none'
                  }}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  aria-label={showPassword ? t.loginHidePassword : t.loginShowPassword}
                  disabled={isLoading}
                  style={{
                    position: 'absolute',
                    right: 14,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    padding: 0,
                    cursor: 'pointer',
                    color: '#64748b',
                    display: 'flex',
                    alignItems: 'center',
                    transition: 'color 0.15s',
                  }}
                  onMouseEnter={(e) => ((e.currentTarget as HTMLButtonElement).style.color = '#94a3b8')}
                  onMouseLeave={(e) => ((e.currentTarget as HTMLButtonElement).style.color = '#64748b')}
                >
                  {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={isLoading}
              style={{
                width: '100%',
                height: 46,
                borderRadius: 10,
                border: 'none',
                background: isLoading
                  ? 'rgba(185,28,28,0.5)'
                  : 'linear-gradient(135deg, #b91c1c 0%, #dc2626 60%, #ef4444 100%)',
                color: '#fff',
                fontSize: 15,
                fontWeight: 600,
                cursor: isLoading ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                transition: 'opacity 0.15s',
                marginTop: 4,
              }}
              onMouseEnter={(e) => { if (!isLoading) (e.currentTarget as HTMLButtonElement).style.opacity = '0.88' }}
              onMouseLeave={(e) => { if (!isLoading) (e.currentTarget as HTMLButtonElement).style.opacity = '1' }}
            >
              {isLoading ? (
                <>
                  <Loader2 size={16} style={{ animation: 'spin 0.8s linear infinite' }} />
                  {t.loginSubmitting}
                </>
              ) : (
                t.loginSubmit
              )}
            </button>
          </form>

          {/* Divider + Sign Up */}
          <div style={{ marginTop: 24, paddingTop: 20, borderTop: '1px solid rgba(255,255,255,0.07)', textAlign: 'center' }}>
            <p style={{ fontSize: 13, color: '#64748b', margin: '0 0 10px' }}>
              {t.loginNewTo} <span translate="no">{APP_NAME}</span>?
            </p>
            <Link
              href="/auth/register"
              style={{
                display: 'inline-block',
                fontSize: 13,
                fontWeight: 600,
                color: '#f87171',
                textDecoration: 'none',
              }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLAnchorElement).style.textDecoration = 'underline')}
              onMouseLeave={(e) => ((e.currentTarget as HTMLAnchorElement).style.textDecoration = 'none')}
            >
              {t.loginCreateAccount}
            </Link>
          </div>
        </div>

        {/* Footer */}
        <p style={{ textAlign: 'center', fontSize: 12, color: '#475569', marginTop: 20 }}>
          {t.loginTermsText}{' '}
          <a href="#" style={{ color: '#f87171', fontWeight: 500 }}>{t.loginTermsService}</a>
          {' '}{t.loginAnd}{' '}
          <Link href="/privacy" style={{ color: '#f87171', fontWeight: 500 }}>{t.loginPrivacyPolicy}</Link>
        </p>
      </motion.div>

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}
