'use client'

import Link from 'next/link'
import { motion } from 'framer-motion'
import {
  BarChart3, Brain, TrendingUp, FileDown, Palette, Zap,
  ShieldCheck, ArrowRight, CheckCircle, BookOpen, Gamepad2,
  BrainCircuit, BadgeCheck, Database, Users
} from 'lucide-react'
import { APP_NAME } from '@/lib/constants'

// ── Animation helpers ─────────────────────────────────────────────────────────
const fadeUp = (delay = 0) => ({
  initial:    { opacity: 0, y: 20 },
  animate:    { opacity: 1, y: 0 },
  transition: { duration: 0.55, delay, ease: "easeInOut" as const },
})

const fadeIn = (delay = 0) => ({
  initial:    { opacity: 0 },
  whileInView:{ opacity: 1 },
  viewport:   { once: true },
  transition: { duration: 0.5, delay },
})

const slideUp = (delay = 0) => ({
  initial:    { opacity: 0, y: 24 },
  whileInView:{ opacity: 1, y: 0 },
  viewport:   { once: true },
  transition: { duration: 0.5, delay, ease: "easeInOut" as const },
})

// ── Mock dashboard preview ────────────────────────────────────────────────────
function DashboardPreview() {
  const bars = [65, 80, 55, 90, 72, 88, 60, 95, 70, 85]
  return (
    <div className="relative rounded-2xl border border-slate-200/80 bg-white shadow-2xl overflow-hidden">
      {/* Gradient top bar */}
      <div className="h-1.5 w-full bg-gradient-to-r from-red-500 to-blue-500" />

      {/* Header row */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-red-400" />
          <div className="w-2.5 h-2.5 rounded-full bg-amber-400" />
          <div className="w-2.5 h-2.5 rounded-full bg-green-400" />
        </div>
        <div className="h-2 w-32 rounded bg-slate-100" />
        <div className="h-2 w-12 rounded bg-slate-100" />
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-4 gap-2 p-3">
        {[
          { label: 'Sessions',   value: '2,847', color: 'text-red-600'  },
          { label: 'Pass Rate',  value: '78%',   color: 'text-blue-600' },
          { label: 'Avg Score',  value: '84 pts', color: 'text-teal-600' },
          { label: 'Certified',  value: '1,203', color: 'text-violet-600' },
        ].map(({ label, value, color }) => (
          <div key={label} className="rounded-lg border border-slate-100 bg-slate-50 p-2">
            <p className="text-[9px] text-slate-400 mb-1 uppercase tracking-wide">{label}</p>
            <p className={`text-sm font-bold tabular-nums ${color}`}>{value}</p>
            <div className="mt-1.5 h-0.5 w-full bg-slate-200 rounded">
              <div className={`h-full rounded bg-current ${color}`} style={{ width: '65%', opacity: 0.4 }} />
            </div>
          </div>
        ))}
      </div>

      {/* Chart area */}
      <div className="px-3 pb-3">
        <div className="rounded-xl border border-slate-100 bg-slate-50 p-3">
          <div className="flex items-center justify-between mb-3">
            <div className="h-2 w-24 rounded bg-slate-200" />
            <div className="flex gap-2">
              <div className="h-1.5 w-1.5 rounded-full bg-red-400" />
              <div className="h-1.5 w-1.5 rounded-full bg-blue-400" />
            </div>
          </div>
          {/* Bar chart */}
          <div className="flex items-end gap-1 h-16">
            {bars.map((h, i) => (
              <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                <div
                  className="w-full rounded-sm"
                  style={{
                    height: `${h * 0.6}%`,
                    background: i % 3 === 0
                      ? 'linear-gradient(180deg, #EF4444 0%, #DC2626 100%)'
                      : 'linear-gradient(180deg, #60A5FA 0%, #3B82F6 100%)',
                    opacity: 0.85,
                  }}
                />
              </div>
            ))}
          </div>
          {/* X axis */}
          <div className="flex gap-1 mt-1">
            {bars.map((_, i) => (
              <div key={i} className="flex-1 h-1 rounded bg-slate-200" />
            ))}
          </div>
        </div>
      </div>

      {/* Live badge */}
      <div className="absolute top-8 right-4 flex items-center gap-1.5 bg-green-50 border border-green-200 rounded-full px-2.5 py-1 text-[10px] font-semibold text-green-700">
        <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
        Live
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export function LandingPage() {
  return (
    <div className="w-screen min-h-screen bg-white overflow-x-hidden">

      {/* ── Sticky Header ──────────────────────────────────────────────────── */}
      <header className="w-full border-b border-slate-200/80 bg-white/95 backdrop-blur-sm sticky top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-3.5 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div
              className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-white text-sm shadow-sm"
              style={{ background: 'linear-gradient(135deg, #DC2626 0%, #3B82F6 100%)' }}
            >
              RP
            </div>
            <span className="font-bold text-slate-900 text-[15px]">{APP_NAME} <span className="font-light text-slate-400">Analytics</span></span>
          </div>
          <nav className="hidden sm:flex items-center gap-1">
            <a href="#features" className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-50 transition-colors">Features</a>
            <a href="#modules" className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-50 transition-colors">Modules</a>
            <a href="#how-it-works" className="px-3 py-1.5 text-sm text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-50 transition-colors">How it works</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link
              href="/auth/login"
              className="px-4 py-2 text-sm font-medium text-slate-700 hover:text-slate-900 rounded-lg hover:bg-slate-50 transition-colors hidden sm:block"
            >
              Sign In
            </Link>
            <Link
              href="/auth/register"
              className="px-4 py-2 text-sm font-semibold rounded-lg text-white shadow-sm transition-all hover:shadow-md hover:opacity-90"
              style={{ background: 'linear-gradient(135deg, #DC2626 0%, #3B82F6 100%)' }}
            >
              Get Started
            </Link>
          </div>
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-white">
        {/* Background grid */}
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{
            backgroundImage: `linear-gradient(#64748b 1px, transparent 1px), linear-gradient(to right, #64748b 1px, transparent 1px)`,
            backgroundSize: '40px 40px',
          }}
        />
        {/* Gradient blobs */}
        <div className="absolute -top-24 -right-24 w-96 h-96 bg-red-500/8 rounded-full blur-3xl" />
        <div className="absolute -bottom-24 -left-24 w-96 h-96 bg-blue-500/8 rounded-full blur-3xl" />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-20 sm:pt-24 sm:pb-28">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">

            {/* Left: copy */}
            <motion.div {...fadeUp(0)}>
              {/* Badge */}
              <div className="inline-flex items-center gap-2 bg-gradient-to-r from-red-50 to-blue-50 border border-red-100 rounded-full px-3.5 py-1.5 mb-6">
                <span className="w-2 h-2 rounded-full bg-gradient-to-r from-red-500 to-blue-500" />
                <span className="text-xs font-semibold text-slate-700">AI-Powered Analytics Platform</span>
              </div>

              <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-slate-900 mb-5 leading-[1.1]">
                Analytics that power{' '}
                <span
                  className="bg-gradient-to-r from-red-600 to-blue-600 bg-clip-text text-transparent"
                >
                  smarter learning
                </span>
              </h1>

              <p className="text-lg text-slate-600 mb-8 leading-relaxed max-w-lg">
                Real-time dashboards for LMS, coaching, certification, and simulators.
                Turn raw session data into clear insights — automatically.
              </p>

              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 mb-8">
                <Link
                  href="/auth/register"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-white shadow-sm hover:shadow-md transition-all hover:opacity-90 text-sm"
                  style={{ background: 'linear-gradient(135deg, #DC2626 0%, #3B82F6 100%)' }}
                >
                  Start for Free
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <Link
                  href="/auth/login"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-slate-700 border border-slate-200 hover:border-slate-300 hover:bg-slate-50 transition-all text-sm"
                >
                  Sign in to dashboard
                </Link>
              </div>

              {/* Trust bullets */}
              <div className="flex flex-col gap-2">
                {[
                  'Multi-tenant — each company sees only their data',
                  'No setup required — works with your existing platform',
                  'AI insights powered by Claude',
                ].map(t => (
                  <div key={t} className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-500 shrink-0" />
                    <span className="text-sm text-slate-600">{t}</span>
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Right: mock dashboard */}
            <motion.div
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.7, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
              className="relative"
            >
              <DashboardPreview />
              {/* Floating stat chips */}
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.6 }}
                className="absolute -left-6 top-1/4 bg-white rounded-xl border border-slate-200 shadow-lg px-3 py-2 hidden lg:flex items-center gap-2"
              >
                <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center">
                  <TrendingUp className="w-4 h-4 text-green-600" />
                </div>
                <div>
                  <p className="text-[10px] text-slate-400">Pass Rate</p>
                  <p className="text-sm font-bold text-green-600">↑ 14%</p>
                </div>
              </motion.div>
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.75 }}
                className="absolute -right-4 bottom-1/4 bg-white rounded-xl border border-slate-200 shadow-lg px-3 py-2 hidden lg:flex items-center gap-2"
              >
                <div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center">
                  <Users className="w-4 h-4 text-blue-600" />
                </div>
                <div>
                  <p className="text-[10px] text-slate-400">Active Users</p>
                  <p className="text-sm font-bold text-blue-600">2,847</p>
                </div>
              </motion.div>
            </motion.div>

          </div>
        </div>
      </section>

      {/* ── Stats bar ──────────────────────────────────────────────────────── */}
      <section className="border-y border-slate-100 bg-slate-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 sm:gap-10">
            {[
              { value: '100K+',    label: 'Data Points Processed', color: 'from-red-500 to-red-600'   },
              { value: 'Real-time', label: 'Dashboard Updates',    color: 'from-blue-500 to-blue-600' },
              { value: '7',        label: 'Learning Modules',      color: 'from-teal-500 to-teal-600' },
              { value: '99.9%',   label: 'Uptime SLA',             color: 'from-violet-500 to-violet-600' },
            ].map((stat, i) => (
              <motion.div key={i} {...slideUp(i * 0.08)} className="text-center">
                <p className={`text-2xl sm:text-3xl font-extrabold bg-gradient-to-r ${stat.color} bg-clip-text text-transparent`}>
                  {stat.value}
                </p>
                <p className="text-sm text-slate-500 mt-1">{stat.label}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Features ───────────────────────────────────────────────────────── */}
      <section id="features" className="py-20 sm:py-28 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div {...fadeIn()} className="text-center mb-14">
            <div className="inline-flex items-center gap-2 bg-blue-50 border border-blue-100 rounded-full px-3.5 py-1.5 mb-4">
              <Zap className="w-3.5 h-3.5 text-blue-600" />
              <span className="text-xs font-semibold text-blue-700">Platform Features</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
              Everything you need to understand<br className="hidden sm:block" /> your learning platform
            </h2>
            <p className="text-lg text-slate-500 max-w-2xl mx-auto">
              From raw session data to executive-ready insights — in one unified dashboard.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {[
              {
                icon: BarChart3, color: 'bg-red-50 text-red-600',
                title: 'Real-time KPIs',
                description: 'Live pass rates, average scores, session counts, and trend indicators — always up to date.',
              },
              {
                icon: Zap, color: 'bg-blue-50 text-blue-600',
                title: 'Multi-Module Support',
                description: 'LMS, coaching, certification, simulators, second brain — all in one unified dashboard.',
              },
              {
                icon: Brain, color: 'bg-violet-50 text-violet-600',
                title: 'AI-Powered Insights',
                description: 'Get intelligent recommendations powered by Claude to improve learning outcomes and identify gaps.',
              },
              {
                icon: TrendingUp, color: 'bg-teal-50 text-teal-600',
                title: 'Session Drilldown',
                description: 'Click any session to see every field, score, and AI-generated feedback for that evaluation.',
              },
              {
                icon: FileDown, color: 'bg-amber-50 text-amber-600',
                title: 'One-click CSV Export',
                description: 'Export any table or all solutions at once in CSV format for further analysis and reporting.',
              },
              {
                icon: Palette, color: 'bg-pink-50 text-pink-600',
                title: 'Brand Customization',
                description: 'Upload your logo and pick from curated themes or set custom colors — white-label ready.',
              },
            ].map((f, i) => (
              <motion.div
                key={i}
                {...slideUp(i * 0.07)}
                className="group rounded-2xl border border-slate-200 bg-white p-6 hover:border-blue-200 hover:shadow-lg transition-all duration-300"
              >
                <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-4 ${f.color}`}>
                  <f.icon className="w-5 h-5" />
                </div>
                <h3 className="font-semibold text-slate-900 mb-2 text-[15px]">{f.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed">{f.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Modules ────────────────────────────────────────────────────────── */}
      <section id="modules" className="py-20 sm:py-28 bg-slate-50 border-y border-slate-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div {...fadeIn()} className="text-center mb-14">
            <div className="inline-flex items-center gap-2 bg-red-50 border border-red-100 rounded-full px-3.5 py-1.5 mb-4">
              <BarChart3 className="w-3.5 h-3.5 text-red-600" />
              <span className="text-xs font-semibold text-red-700">Supported Modules</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
              One platform for all your<br className="hidden sm:block" /> learning solutions
            </h2>
            <p className="text-lg text-slate-500 max-w-xl mx-auto">
              Whether you run a single module or the full suite, every data source is unified.
            </p>
          </motion.div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
            {[
              { icon: BrainCircuit, label: 'AI Coach',       color: 'bg-red-100 text-red-700'      },
              { icon: BookOpen,     label: 'LMS',            color: 'bg-blue-100 text-blue-700'    },
              { icon: Gamepad2,     label: 'Simulator',      color: 'bg-teal-100 text-teal-700'    },
              { icon: BadgeCheck,   label: 'Certification',  color: 'bg-violet-100 text-violet-700'},
              { icon: Database,     label: 'Second Brain',   color: 'bg-amber-100 text-amber-700'  },
              { icon: Brain,        label: 'Custom AI',      color: 'bg-pink-100 text-pink-700'    },
            ].map((m, i) => (
              <motion.div
                key={i}
                {...slideUp(i * 0.06)}
                className="flex flex-col items-center gap-3 bg-white rounded-2xl border border-slate-200 p-5 hover:border-slate-300 hover:shadow-sm transition-all"
              >
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${m.color}`}>
                  <m.icon className="w-6 h-6" />
                </div>
                <span className="text-sm font-semibold text-slate-700 text-center">{m.label}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ───────────────────────────────────────────────────── */}
      <section id="how-it-works" className="py-20 sm:py-28 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <motion.div {...fadeIn()} className="text-center mb-14">
            <div className="inline-flex items-center gap-2 bg-teal-50 border border-teal-100 rounded-full px-3.5 py-1.5 mb-4">
              <CheckCircle className="w-3.5 h-3.5 text-teal-600" />
              <span className="text-xs font-semibold text-teal-700">Simple Setup</span>
            </div>
            <h2 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-4">
              Up and running in minutes
            </h2>
            <p className="text-lg text-slate-500 max-w-xl mx-auto">
              No complex integration required. Your data is already there.
            </p>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 relative">
            {/* Connector line */}
            <div className="hidden sm:block absolute top-10 left-1/3 right-1/3 h-0.5 bg-gradient-to-r from-red-200 via-blue-200 to-teal-200" />

            {[
              {
                step: '01',
                title: 'Create your account',
                description: 'Register with your company email. Your organization is automatically detected from your domain — no manual setup.',
                color: 'from-red-500 to-red-600',
              },
              {
                step: '02',
                title: 'Your data is connected',
                description: 'We connect to your existing session database. No migration, no import — everything is already live.',
                color: 'from-blue-500 to-blue-600',
              },
              {
                step: '03',
                title: 'Start exploring insights',
                description: 'Browse KPIs, drill into sessions, export reports, and ask the AI assistant for recommendations.',
                color: 'from-teal-500 to-teal-600',
              },
            ].map((s, i) => (
              <motion.div key={i} {...slideUp(i * 0.1)} className="text-center">
                <div className={`w-20 h-20 rounded-2xl mx-auto mb-5 flex items-center justify-center bg-gradient-to-br ${s.color} shadow-md`}>
                  <span className="text-2xl font-extrabold text-white">{s.step}</span>
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-2">{s.title}</h3>
                <p className="text-sm text-slate-500 leading-relaxed max-w-xs mx-auto">{s.description}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Security badge strip ────────────────────────────────────────────── */}
      <section className="border-y border-slate-100 bg-slate-50 py-10">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-center gap-6 sm:gap-10">
            {[
              { icon: ShieldCheck, label: 'Multi-tenant isolation' },
              { icon: ShieldCheck, label: 'bcrypt password hashing' },
              { icon: ShieldCheck, label: 'JWT httpOnly cookies'    },
              { icon: ShieldCheck, label: 'HTTPS / TLS encryption'  },
              { icon: ShieldCheck, label: 'GDPR-ready data controls'},
            ].map(({ icon: Icon, label }) => (
              <div key={label} className="flex items-center gap-2 text-sm text-slate-600">
                <Icon className="w-4 h-4 text-green-500 shrink-0" />
                <span>{label}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ────────────────────────────────────────────────────────────── */}
      <section className="py-20 sm:py-28 relative overflow-hidden">
        <div
          className="absolute inset-0"
          style={{ background: 'linear-gradient(135deg, #DC2626 0%, #7C3AED 50%, #2563EB 100%)' }}
        />
        {/* Mesh overlay */}
        <div className="absolute inset-0 opacity-10"
          style={{
            backgroundImage: `radial-gradient(circle at 2px 2px, white 1px, transparent 0)`,
            backgroundSize: '32px 32px',
          }}
        />
        <div className="relative max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <motion.div {...fadeIn()}>
            <h2 className="text-3xl sm:text-5xl font-extrabold text-white mb-5 leading-tight">
              Ready to see your data<br className="hidden sm:block" /> in a new light?
            </h2>
            <p className="text-lg text-red-100 mb-10 max-w-xl mx-auto">
              Join organizations already using {APP_NAME} Analytics to drive better learning outcomes.
            </p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/auth/register"
                className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl font-bold text-red-600 bg-white hover:bg-red-50 transition-all hover:shadow-xl text-sm"
              >
                Create Free Account
                <ArrowRight className="w-4 h-4" />
              </Link>
              <Link
                href="/auth/login"
                className="inline-flex items-center gap-2 px-8 py-3.5 rounded-xl font-semibold text-white border border-white/30 hover:bg-white/10 transition-all text-sm"
              >
                Sign In
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="border-t border-slate-200 bg-white py-14">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-10 mb-10">

            {/* Brand */}
            <div className="sm:col-span-2 lg:col-span-1">
              <div className="flex items-center gap-2 mb-4">
                <div
                  className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-white text-sm"
                  style={{ background: 'linear-gradient(135deg, #DC2626 0%, #3B82F6 100%)' }}
                >
                  RP
                </div>
                <span className="font-bold text-slate-900">{APP_NAME}</span>
              </div>
              <p className="text-sm text-slate-500 mb-4 leading-relaxed">
                AI-powered analytics platform for learning &amp; coaching solutions.
              </p>
              <div className="flex gap-2.5">
                <a href="https://www.linkedin.com/company/rolplay" target="_blank" rel="noopener noreferrer"
                  className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-blue-100 flex items-center justify-center transition-colors" aria-label="LinkedIn">
                  <svg className="w-4 h-4 text-slate-600" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433a2.062 2.062 0 01-2.063-2.065 2.064 2.064 0 112.063 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z"/>
                  </svg>
                </a>
                <a href="https://www.facebook.com/rolplay" target="_blank" rel="noopener noreferrer"
                  className="w-8 h-8 rounded-lg bg-slate-100 hover:bg-blue-100 flex items-center justify-center transition-colors" aria-label="Facebook">
                  <svg className="w-4 h-4 text-slate-600" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/>
                  </svg>
                </a>
              </div>
            </div>

            {/* Platform links */}
            <div>
              <h4 className="font-semibold text-slate-900 mb-4 text-sm">Platform</h4>
              <ul className="space-y-2.5">
                <li><Link href="/auth/login"    className="text-sm text-slate-500 hover:text-slate-900 transition-colors">Sign In</Link></li>
                <li><Link href="/auth/register" className="text-sm text-slate-500 hover:text-slate-900 transition-colors">Create Account</Link></li>
                <li><a href="#features"         className="text-sm text-slate-500 hover:text-slate-900 transition-colors">Features</a></li>
                <li><a href="#modules"          className="text-sm text-slate-500 hover:text-slate-900 transition-colors">Modules</a></li>
              </ul>
            </div>

            {/* Contact */}
            <div>
              <h4 className="font-semibold text-slate-900 mb-4 text-sm">Contact</h4>
              <ul className="space-y-2.5">
                <li><a href="https://rolplay.ai" target="_blank" rel="noopener noreferrer" className="text-sm text-slate-500 hover:text-red-600 transition-colors">rolplay.ai</a></li>
                <li><a href="mailto:info@rolplay.ai" className="text-sm text-slate-500 hover:text-red-600 transition-colors">info@rolplay.ai</a></li>
                <li><a href="tel:+525550937376" className="text-sm text-slate-500 hover:text-red-600 transition-colors">+52 (55) 5093 7376</a></li>
              </ul>
            </div>

            {/* Locations */}
            <div>
              <h4 className="font-semibold text-slate-900 mb-4 text-sm">Locations</h4>
              <ul className="space-y-2">
                <li className="text-sm text-slate-500">Toronto, Canada</li>
                <li className="text-sm text-slate-500">Monterrey, Mexico</li>
                <li className="text-sm text-slate-500">Mexico City, Mexico</li>
              </ul>
            </div>

          </div>

          <div className="border-t border-slate-100 pt-8 flex flex-col sm:flex-row justify-between items-center gap-4">
            <p className="text-xs text-slate-400">© 2026 {APP_NAME}. All rights reserved.</p>
            <div className="flex items-center gap-5">
              <Link href="/privacy" className="text-xs text-slate-400 hover:text-slate-600 transition-colors">Privacy Policy</Link>
              <Link href="/terms"   className="text-xs text-slate-400 hover:text-slate-600 transition-colors">Terms of Service</Link>
              <a href="mailto:info@rolplay.ai" className="text-xs text-slate-400 hover:text-slate-600 transition-colors">Support</a>
            </div>
          </div>
        </div>
      </footer>

    </div>
  )
}
