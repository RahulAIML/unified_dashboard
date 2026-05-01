'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import { BarChart3, Brain, TrendingUp, FileDown, Palette, Zap } from 'lucide-react'

export function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-slate-50">
      {/* Header */}
      <header className="border-b border-slate-200">
        <div className="w-full px-4 py-4 sm:px-6 lg:px-8 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-white"
              style={{ background: 'linear-gradient(135deg, #DC2626 0%, #3B82F6 100%)' }}
            >
              RP
            </div>
            <span className="font-bold text-lg">RolPlay Analytics</span>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/auth/login"
              className="px-4 py-2 text-sm font-medium text-slate-700 hover:text-slate-900 transition-colors"
            >
              Login
            </Link>
            <Link
              href="/auth/register"
              className="px-4 py-2 text-sm font-semibold rounded-lg text-white bg-red-600 hover:bg-red-700 transition-colors"
            >
              Sign Up
            </Link>
          </div>
        </div>
      </header>

      {/* Hero Section */}
      <section className="w-full px-4 sm:px-6 lg:px-8 py-20 sm:py-32">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6 }}
          className="text-center"
        >
          <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight text-slate-900 mb-6">
            AI-Powered Analytics for
            <span className="bg-gradient-to-r from-red-600 to-blue-600 bg-clip-text text-transparent"> Learning & Coaching</span>
          </h1>
          <p className="text-lg sm:text-xl text-slate-600 mb-8 max-w-3xl mx-auto">
            Real-time insights for LMS, coaching platforms, certifications, simulators, and more. Transform your learning data into actionable intelligence with our unified dashboard.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
            <Link
              href="/auth/register"
              className="inline-flex items-center px-8 py-3 rounded-lg font-semibold text-white bg-red-600 hover:bg-red-700 transition-all hover:shadow-lg"
            >
              Get Started Free
            </Link>
            <Link
              href="/auth/login"
              className="inline-flex items-center px-8 py-3 rounded-lg font-semibold text-slate-900 border border-slate-300 hover:border-slate-400 hover:bg-slate-50 transition-all"
            >
              Sign In
            </Link>
          </div>
        </motion.div>

        {/* Stats */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="grid grid-cols-3 gap-4 sm:gap-8 mt-16 pt-16 border-t border-slate-200"
        >
          <div className="text-center">
            <div className="text-2xl sm:text-3xl font-bold text-red-600">100K+</div>
            <div className="text-sm text-slate-600 mt-1">Data Points</div>
          </div>
          <div className="text-center">
            <div className="text-2xl sm:text-3xl font-bold text-blue-600">Real-time</div>
            <div className="text-sm text-slate-600 mt-1">Analytics</div>
          </div>
          <div className="text-center">
            <div className="text-2xl sm:text-3xl font-bold text-teal-600">7 Solutions</div>
            <div className="text-sm text-slate-600 mt-1">Supported</div>
          </div>
        </motion.div>
      </section>

      {/* Features Section */}
      <section className="bg-white border-t border-slate-200 py-20 sm:py-32">
        <div className="w-full px-4 sm:px-6 lg:px-8">
          <motion.div
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            transition={{ duration: 0.6 }}
            viewport={{ once: true }}
            className="text-center mb-16"
          >
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
              Powerful Features
            </h2>
            <p className="text-lg text-slate-600 max-w-2xl mx-auto">
              Everything you need to understand your learning platform's performance
            </p>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              {
                icon: BarChart3,
                title: 'Real-time Analytics',
                description: 'Live KPI metrics and dashboard updates as your users interact with your platform',
              },
              {
                icon: Zap,
                title: 'Multi-Solution Support',
                description: 'Track LMS, coaching, certification, simulators, and more in one unified dashboard',
              },
              {
                icon: Brain,
                title: 'AI Insights',
                description: 'Get intelligent recommendations powered by Claude to improve learning outcomes',
              },
              {
                icon: TrendingUp,
                title: 'Drilldown Reports',
                description: 'Dive deep into session-level data to uncover patterns and optimize performance',
              },
              {
                icon: FileDown,
                title: 'CSV Exports',
                description: 'Download all your data in CSV format for further analysis and reporting',
              },
              {
                icon: Palette,
                title: 'Brand Customization',
                description: 'Customize colors and logos to match your company identity',
              },
            ].map((feature, idx) => (
              <motion.div
                key={idx}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.5, delay: idx * 0.1 }}
                viewport={{ once: true }}
                className="rounded-xl border border-slate-200 bg-slate-50 p-6 hover:border-blue-300 hover:shadow-md transition-all"
              >
                <feature.icon className="w-8 h-8 text-red-600 mb-4" />
                <h3 className="font-semibold text-slate-900 mb-2">{feature.title}</h3>
                <p className="text-sm text-slate-600">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Trust Section */}
      <section className="py-16 sm:py-24 bg-gradient-to-r from-slate-50 to-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 mb-8">
            Trusted by Leading Companies
          </h2>
          <p className="text-slate-600 mb-6">
            Used by organizations to transform their learning and coaching platforms
          </p>
        </div>
      </section>

      {/* CTA Section */}
      <section className="bg-gradient-to-r from-red-600 to-blue-600 py-16 sm:py-20">
        <div className="w-full px-4 sm:px-6 lg:px-8 text-center">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">
            Ready to unlock insights from your data?
          </h2>
          <p className="text-lg text-red-100 mb-8">
            Start your free account today and get real-time analytics in minutes
          </p>
          <Link
            href="/auth/register"
            className="inline-flex items-center px-8 py-3 rounded-lg font-semibold text-red-600 bg-white hover:bg-red-50 transition-all hover:shadow-lg"
          >
            Create Free Account
          </Link>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-slate-200 bg-white py-12">
        <div className="w-full px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-8 mb-10">
            {/* Brand column */}
            <div className="sm:col-span-2 lg:col-span-1">
              <div className="flex items-center gap-2 mb-4">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-white text-sm"
                  style={{ background: 'linear-gradient(135deg, #DC2626 0%, #3B82F6 100%)' }}
                >
                  RP
                </div>
                <span className="font-bold text-slate-900">RolPlay</span>
              </div>
              <p className="text-sm text-slate-600 mb-4 leading-relaxed">
                AI-powered analytics platform for learning & coaching solutions.
              </p>
              <div className="flex gap-3">
                <a
                  href="https://www.linkedin.com/company/rolplay"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-blue-100 flex items-center justify-center transition-colors"
                  aria-label="LinkedIn"
                >
                  <svg className="w-4 h-4 text-slate-600" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                  </svg>
                </a>
                <a
                  href="https://www.facebook.com/rolplay"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-blue-100 flex items-center justify-center transition-colors"
                  aria-label="Facebook"
                >
                  <svg className="w-4 h-4 text-slate-600" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                  </svg>
                </a>
              </div>
            </div>

            {/* Contact */}
            <div>
              <h4 className="font-semibold text-slate-900 mb-4">Contact</h4>
              <ul className="space-y-2.5">
                <li>
                  <a href="https://rolplay.ai" target="_blank" rel="noopener noreferrer"
                    className="text-sm text-slate-600 hover:text-red-600 transition-colors flex items-center gap-1.5">
                    rolplay.ai
                  </a>
                </li>
                <li>
                  <a href="mailto:info@rolplay.ai"
                    className="text-sm text-slate-600 hover:text-red-600 transition-colors">
                    info@rolplay.ai
                  </a>
                </li>
                <li>
                  <a href="tel:+525550937376"
                    className="text-sm text-slate-600 hover:text-red-600 transition-colors">
                    +52 (55) 5093 7376
                  </a>
                </li>
              </ul>
            </div>

            {/* Locations */}
            <div>
              <h4 className="font-semibold text-slate-900 mb-4">Locations</h4>
              <ul className="space-y-2">
                <li className="text-sm text-slate-600">Toronto, Canada</li>
                <li className="text-sm text-slate-600">Monterrey, Mexico</li>
                <li className="text-sm text-slate-600">Mexico City, Mexico</li>
              </ul>
            </div>

            {/* Platform */}
            <div>
              <h4 className="font-semibold text-slate-900 mb-4">Platform</h4>
              <ul className="space-y-2">
                <li><Link href="/auth/login" className="text-sm text-slate-600 hover:text-slate-900 transition-colors">Sign In</Link></li>
                <li><Link href="/auth/register" className="text-sm text-slate-600 hover:text-slate-900 transition-colors">Create Account</Link></li>
                <li><a href="mailto:info@rolplay.ai" className="text-sm text-slate-600 hover:text-slate-900 transition-colors">Support</a></li>
              </ul>
            </div>
          </div>

          <div className="border-t border-slate-200 pt-8 flex flex-col sm:flex-row justify-between items-center gap-4">
            <p className="text-sm text-slate-500">© 2026 RolPlay. All rights reserved.</p>
            <p className="text-xs text-slate-400">Analytics Platform · v1.0</p>
          </div>
        </div>
      </footer>
    </div>
  )
}
