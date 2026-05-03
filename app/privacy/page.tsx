import Link from 'next/link'
import { ShieldCheck } from 'lucide-react'
import { APP_NAME } from '@/lib/constants'

export const metadata = {
  title: `Privacy Policy · ${APP_NAME} Analytics`,
  description: `How ${APP_NAME} Analytics collects, uses, and protects your data.`,
}

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-slate-50">
      {/* Header */}
      <header className="w-full border-b border-slate-200 bg-white sticky top-0 z-50">
        <div className="w-full px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-white text-sm"
              style={{ background: 'linear-gradient(135deg, #DC2626 0%, #3B82F6 100%)' }}
            >
              RP
            </div>
            <span className="font-bold text-lg text-slate-900">{APP_NAME}</span>
          </Link>
          <Link
            href="/auth/login"
            className="px-4 py-2 text-sm font-medium text-slate-700 hover:text-slate-900 transition-colors"
          >
            Sign In
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="w-full max-w-3xl mx-auto px-4 sm:px-6 py-12 sm:py-20">
        {/* Title */}
        <div className="flex items-center gap-3 mb-8">
          <ShieldCheck className="w-8 h-8 text-red-600 shrink-0" />
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Privacy Policy</h1>
            <p className="text-sm text-slate-500 mt-1">Last updated: May 1, 2026</p>
          </div>
        </div>

        <div className="prose prose-slate max-w-none space-y-8 text-slate-700">

          {/* Section 1 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">1. Information We Collect</h2>
            <p className="text-sm leading-relaxed">
              When you register or use {APP_NAME} Analytics, we collect the following types of information:
            </p>
            <ul className="mt-3 space-y-2 text-sm list-disc list-inside">
              <li><strong>Account information:</strong> your name, email address, and hashed password.</li>
              <li><strong>Company domain:</strong> derived automatically from your email address to associate your account with your organization.</li>
              <li><strong>Usage data:</strong> aggregated analytics interactions such as date range filters, page visits, and export actions — used solely to improve the platform.</li>
              <li><strong>Session tokens:</strong> short-lived JWT tokens stored in httpOnly cookies for authentication purposes.</li>
            </ul>
          </section>

          {/* Section 2 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">2. How We Use Your Information</h2>
            <p className="text-sm leading-relaxed">We use the information we collect to:</p>
            <ul className="mt-3 space-y-2 text-sm list-disc list-inside">
              <li>Authenticate you and provide access to your organization's analytics dashboard.</li>
              <li>Display metrics and reports scoped exclusively to your company's data.</li>
              <li>Send transactional emails (e.g., password reset) when requested.</li>
              <li>Improve platform performance and fix bugs.</li>
            </ul>
            <p className="mt-3 text-sm leading-relaxed">
              <strong>We never sell your personal data</strong> to third parties, and we never use your information for advertising purposes.
            </p>
          </section>

          {/* Section 3 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">3. Data Isolation & Security</h2>
            <p className="text-sm leading-relaxed">
              All analytics data is strictly isolated by organization. Your account only has access to data associated with your company's <code className="bg-slate-100 px-1 rounded text-xs">customer_id</code>. Cross-organization data access is technically prevented at the database query level.
            </p>
            <p className="mt-3 text-sm leading-relaxed">
              We protect your data with industry-standard security measures including:
            </p>
            <ul className="mt-3 space-y-2 text-sm list-disc list-inside">
              <li>bcrypt password hashing (no plain-text passwords stored).</li>
              <li>Short-lived JWT access tokens (15-minute TTL) with httpOnly cookies.</li>
              <li>Encrypted connections (HTTPS/TLS) for all data in transit.</li>
              <li>Server-side session invalidation on logout.</li>
            </ul>
          </section>

          {/* Section 4 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">4. Data Retention</h2>
            <p className="text-sm leading-relaxed">
              Analytics data (session records, scores, evaluations) is retained as long as your organization has an active account. You may request deletion of your account and associated personal information by contacting us at{' '}
              <a href="mailto:info@rolplay.ai" className="text-red-600 hover:underline">info@rolplay.ai</a>.
            </p>
            <p className="mt-3 text-sm leading-relaxed">
              Session tokens are automatically expired and cleaned from the database after 7 days.
            </p>
          </section>

          {/* Section 5 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">5. Third-Party Services</h2>
            <p className="text-sm leading-relaxed">
              {APP_NAME} Analytics may interact with the following third-party services on your behalf:
            </p>
            <ul className="mt-3 space-y-2 text-sm list-disc list-inside">
              <li><strong>Second Brain API</strong> (second-brain-shz8.onrender.com) — provides live member and coaching session data for organizations using the Second Brain module.</li>
              <li><strong>Anthropic Claude</strong> — used for AI-powered insights within the platform. No personally identifiable information is sent to Claude.</li>
            </ul>
          </section>

          {/* Section 6 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">6. Your Rights</h2>
            <p className="text-sm leading-relaxed">You have the right to:</p>
            <ul className="mt-3 space-y-2 text-sm list-disc list-inside">
              <li><strong>Access</strong> the personal data we hold about you.</li>
              <li><strong>Correct</strong> inaccurate personal information.</li>
              <li><strong>Delete</strong> your account and associated personal data.</li>
              <li><strong>Export</strong> your organization's analytics data via the CSV export feature.</li>
              <li><strong>Object</strong> to any processing of your data for purposes beyond the ones described here.</li>
            </ul>
            <p className="mt-3 text-sm leading-relaxed">
              To exercise any of these rights, contact us at{' '}
              <a href="mailto:info@rolplay.ai" className="text-red-600 hover:underline">info@rolplay.ai</a>.
            </p>
          </section>

          {/* Section 7 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">7. Cookies</h2>
            <p className="text-sm leading-relaxed">
              We use only strictly necessary cookies — specifically httpOnly authentication cookies for managing your login session. We do not use tracking, advertising, or analytics cookies.
            </p>
          </section>

          {/* Section 8 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">8. Contact</h2>
            <p className="text-sm leading-relaxed">
              If you have questions about this Privacy Policy or how we handle your data, please reach out:
            </p>
            <address className="mt-3 not-italic text-sm space-y-1">
              <p><strong>{APP_NAME}</strong></p>
              <p>
                <a href="mailto:info@rolplay.ai" className="text-red-600 hover:underline">info@rolplay.ai</a>
              </p>
              <p>
                <a href="https://rolplay.ai" target="_blank" rel="noopener noreferrer" className="text-red-600 hover:underline">rolplay.ai</a>
              </p>
              <p>Toronto · Monterrey · Mexico City</p>
            </address>
          </section>

        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-6">
        <div className="w-full px-4 sm:px-6 lg:px-8 flex flex-col sm:flex-row justify-between items-center gap-4 text-xs text-slate-500">
          <p>© 2026 {APP_NAME}. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <Link href="/" className="hover:text-slate-700 transition-colors">Home</Link>
            <Link href="/terms" className="hover:text-slate-700 transition-colors">Terms of Service</Link>
            <Link href="/auth/login" className="hover:text-slate-700 transition-colors">Sign In</Link>
            <a href="mailto:info@rolplay.ai" className="hover:text-slate-700 transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
