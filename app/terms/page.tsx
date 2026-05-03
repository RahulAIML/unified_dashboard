import Link from 'next/link'
import { FileText } from 'lucide-react'
import { APP_NAME } from '@/lib/constants'

export const metadata = {
  title: `Terms of Service · ${APP_NAME} Analytics`,
  description: `Terms of Service for ${APP_NAME} Analytics — the AI-powered analytics platform for learning and coaching solutions.`,
}

export default function TermsPage() {
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
          <FileText className="w-8 h-8 text-blue-600 shrink-0" />
          <div>
            <h1 className="text-3xl font-bold text-slate-900">Terms of Service</h1>
            <p className="text-sm text-slate-500 mt-1">Last updated: May 1, 2026</p>
          </div>
        </div>

        <div className="space-y-8 text-slate-700">

          <p className="text-sm leading-relaxed bg-blue-50 border border-blue-100 rounded-xl px-5 py-4">
            Please read these Terms of Service carefully before using {APP_NAME} Analytics. By accessing or using the platform, you agree to be bound by these terms. If you do not agree, do not use the service.
          </p>

          {/* Section 1 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">1. Acceptance of Terms</h2>
            <p className="text-sm leading-relaxed">
              By registering an account or accessing {APP_NAME} Analytics (&quot;the Platform&quot;, &quot;we&quot;, &quot;us&quot;), you agree to these Terms of Service and our{' '}
              <Link href="/privacy" className="text-red-600 hover:underline">Privacy Policy</Link>,{' '}
              which are incorporated herein by reference. These terms apply to all users, including administrators, managers, and individual contributors.
            </p>
          </section>

          {/* Section 2 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">2. Description of Service</h2>
            <p className="text-sm leading-relaxed">
              {APP_NAME} Analytics is a B2B SaaS analytics platform that provides organizations with real-time dashboards, KPI tracking, and AI-powered insights for learning management systems (LMS), coaching platforms, certification programs, simulators, and second-brain knowledge bases.
            </p>
            <p className="mt-3 text-sm leading-relaxed">
              Access to the Platform is granted on a per-organization basis. Each user account is associated with a company domain, and data access is strictly scoped to that organization.
            </p>
          </section>

          {/* Section 3 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">3. Account Registration</h2>
            <ul className="space-y-2 text-sm list-disc list-inside">
              <li>You must provide a valid business email address to register.</li>
              <li>Your account is automatically associated with your organization based on your email domain.</li>
              <li>You are responsible for maintaining the confidentiality of your login credentials.</li>
              <li>You must notify us immediately of any unauthorized access to your account.</li>
              <li>One person or legal entity may not maintain more than one free account.</li>
              <li>You must be at least 18 years old to use the Platform.</li>
            </ul>
          </section>

          {/* Section 4 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">4. Acceptable Use</h2>
            <p className="text-sm leading-relaxed mb-3">You agree not to:</p>
            <ul className="space-y-2 text-sm list-disc list-inside">
              <li>Access or attempt to access data belonging to another organization.</li>
              <li>Reverse engineer, decompile, or disassemble any part of the Platform.</li>
              <li>Use the Platform to store or transmit malicious code, viruses, or harmful content.</li>
              <li>Attempt to circumvent authentication, authorization, or security controls.</li>
              <li>Use automated scripts or bots to scrape, overload, or abuse the Platform.</li>
              <li>Resell, sublicense, or commercially exploit the Platform without written authorization.</li>
              <li>Use the Platform for any illegal or unauthorized purpose.</li>
            </ul>
          </section>

          {/* Section 5 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">5. Data Ownership</h2>
            <p className="text-sm leading-relaxed">
              All analytics data generated by your organization&apos;s users remains your property. {APP_NAME} does not claim ownership of your organization&apos;s session data, evaluation scores, or user records.
            </p>
            <p className="mt-3 text-sm leading-relaxed">
              By using the Platform, you grant {APP_NAME} a limited, non-exclusive license to process and display your data solely for the purpose of providing the analytics service to you.
            </p>
          </section>

          {/* Section 6 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">6. Intellectual Property</h2>
            <p className="text-sm leading-relaxed">
              The Platform, including its design, code, features, logos, and content, is owned by {APP_NAME} and protected by applicable intellectual property laws. Nothing in these Terms grants you any right to use {APP_NAME}&apos;s trademarks, logos, or proprietary content without express written consent.
            </p>
          </section>

          {/* Section 7 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">7. Service Availability</h2>
            <p className="text-sm leading-relaxed">
              We strive to maintain high availability but do not guarantee uninterrupted access to the Platform. We may temporarily suspend service for maintenance, security updates, or force majeure events. We will provide reasonable advance notice of planned maintenance where possible.
            </p>
          </section>

          {/* Section 8 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">8. AI Features</h2>
            <p className="text-sm leading-relaxed">
              The Platform uses third-party AI services (including Anthropic Claude) to provide intelligent insights. AI-generated content is for informational purposes only and should not be relied upon as professional advice. {APP_NAME} does not warrant the accuracy, completeness, or fitness of AI-generated insights for any particular purpose.
            </p>
          </section>

          {/* Section 9 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">9. Disclaimer of Warranties</h2>
            <p className="text-sm leading-relaxed">
              THE PLATFORM IS PROVIDED &quot;AS IS&quot; AND &quot;AS AVAILABLE&quot; WITHOUT WARRANTIES OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, OR NON-INFRINGEMENT. WE DO NOT WARRANT THAT THE PLATFORM WILL BE ERROR-FREE OR UNINTERRUPTED.
            </p>
          </section>

          {/* Section 10 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">10. Limitation of Liability</h2>
            <p className="text-sm leading-relaxed">
              TO THE FULLEST EXTENT PERMITTED BY LAW, {APP_NAME.toUpperCase()} SHALL NOT BE LIABLE FOR ANY INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES ARISING OUT OF OR RELATING TO YOUR USE OF THE PLATFORM, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGES. OUR TOTAL LIABILITY SHALL NOT EXCEED THE AMOUNT PAID BY YOU IN THE TWELVE MONTHS PRECEDING THE CLAIM.
            </p>
          </section>

          {/* Section 11 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">11. Termination</h2>
            <p className="text-sm leading-relaxed">
              We reserve the right to suspend or terminate your account at any time if you violate these Terms. You may delete your account at any time by contacting{' '}
              <a href="mailto:info@rolplay.ai" className="text-red-600 hover:underline">info@rolplay.ai</a>.
              Upon termination, your access to the Platform will cease and your personal data will be handled in accordance with our{' '}
              <Link href="/privacy" className="text-red-600 hover:underline">Privacy Policy</Link>.
            </p>
          </section>

          {/* Section 12 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">12. Changes to Terms</h2>
            <p className="text-sm leading-relaxed">
              We may update these Terms from time to time. We will notify users of material changes via email or a prominent notice on the Platform. Continued use of the Platform after changes take effect constitutes acceptance of the updated Terms.
            </p>
          </section>

          {/* Section 13 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">13. Governing Law</h2>
            <p className="text-sm leading-relaxed">
              These Terms are governed by and construed in accordance with the laws of Mexico, without regard to its conflict of law principles. Any disputes arising from these Terms shall be subject to the exclusive jurisdiction of the courts of Mexico City, Mexico.
            </p>
          </section>

          {/* Section 14 */}
          <section>
            <h2 className="text-xl font-semibold text-slate-900 mb-3">14. Contact</h2>
            <p className="text-sm leading-relaxed">
              If you have questions about these Terms, please contact us:
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
            <Link href="/privacy" className="hover:text-slate-700 transition-colors">Privacy Policy</Link>
            <Link href="/auth/login" className="hover:text-slate-700 transition-colors">Sign In</Link>
            <a href="mailto:info@rolplay.ai" className="hover:text-slate-700 transition-colors">Contact</a>
          </div>
        </div>
      </footer>
    </div>
  )
}
