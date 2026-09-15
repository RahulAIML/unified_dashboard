'use client'

/**
 * Public, unauthenticated landing page. Deliberately styled after
 * hub.rolplay.ai (the company's own marketing site) rather than the app's
 * per-tenant theme system -- a visitor hasn't picked/entered a tenant yet,
 * so there is no branding to apply. Fixed dark + red, like the reference
 * site defaults to, not wired to ThemeProvider (this page never was).
 */
import Link from 'next/link'
import { motion } from 'framer-motion'
import { ArrowRight, Check, RefreshCw } from 'lucide-react'
import { APP_NAME } from '@/lib/constants'
import { useT, useLangStore } from '@/lib/lang-store'
import { RolplayLogo } from '@/components/RolplayLogo'

const fadeUp = (delay = 0) => ({
  initial:    { opacity: 0, y: 20 },
  animate:    { opacity: 1, y: 0 },
  transition: { duration: 0.55, delay, ease: "easeInOut" as const },
})

const slideUp = (delay = 0) => ({
  initial:    { opacity: 0, y: 24 },
  whileInView:{ opacity: 1, y: 0 },
  viewport:   { once: true },
  transition: { duration: 0.5, delay, ease: "easeInOut" as const },
})

// ── Header ─────────────────────────────────────────────────────────────────────
function Header() {
  const t = useT()
  const { lang, toggle } = useLangStore()

  return (
    <header className="sticky top-0 z-50 w-full border-b border-white/10 bg-black/90 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-2 shrink-0">
          <RolplayLogo className="h-5 w-auto text-white" />
        </Link>

        <nav className="hidden md:flex items-center gap-1">
          <a href="#journey"       className="px-3 py-1.5 text-sm text-white/70 hover:text-white rounded-lg transition-colors">{t.landingNavJourney}</a>
          <a href="#conversations" className="px-3 py-1.5 text-sm text-white/70 hover:text-white rounded-lg transition-colors">{t.landingNavConversations}</a>
          <a href="#progress"      className="px-3 py-1.5 text-sm text-white/70 hover:text-white rounded-lg transition-colors">{t.landingNavProgress}</a>
        </nav>

        <div className="flex items-center gap-2">
          <button
            onClick={toggle}
            className="px-2.5 py-1.5 text-xs font-semibold rounded-full border border-white/15 text-white/70 hover:text-white hover:border-white/30 transition-colors"
            aria-label="Toggle language"
          >
            {lang === "en" ? "ES" : "EN"}
          </button>
          <Link
            href="/auth/login"
            className="px-4 sm:px-5 py-2 text-sm font-semibold rounded-lg text-white shadow-sm hover:opacity-90 transition-opacity"
            style={{ background: '#E51F26' }}
          >
            {t.landingNavSignIn}
          </Link>
        </div>
      </div>
    </header>
  )
}

// ── Hero: real KPI dashboard mock ─────────────────────────────────────────────
// Illustrative only (this is a public, unauthenticated page -- there is no
// real tenant to fetch for), but the tile labels and shape mirror an actual
// generated dashboard's "Resumen" page (see app/api/dashboard/overview and
// the Dashboard Builder's own preview), not invented KPI names.
function DashboardMock() {
  const t = useT()
  const tiles = [
    { label: t.landingChatCoachLabel, value: '1,890' },
    { label: t.landingChatUserLabel,  value: '360'   },
    { label: t.landingChatMsg1,       value: '78%'   },
    { label: t.landingChatMsg2,       value: '43.66' },
  ]
  const bars = [55, 72, 60, 88, 65, 90, 78, 95, 70, 84]

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: '#E51F26' }}>
            <RolplayLogo className="h-3.5 w-auto text-white" />
          </div>
          <span className="font-semibold text-white text-sm">{t.landingChatCoachName}</span>
        </div>
        <span className="flex items-center gap-1.5 text-xs text-white/50">
          <span className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ background: '#E51F26' }} />
          {t.landingChatStatus}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 p-5">
        {tiles.map(tile => (
          <div key={tile.label} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <p className="text-[10px] text-white/40 uppercase tracking-wide mb-1">{tile.label}</p>
            <p className="text-xl font-bold text-white tabular-nums">{tile.value}</p>
          </div>
        ))}
      </div>

      <div className="px-5 pb-5">
        <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3 flex items-end gap-1 h-16">
          {bars.map((h, i) => (
            <div key={i} className="flex-1 rounded-sm" style={{ height: `${h}%`, background: '#E51F26', opacity: 0.5 + (h / 200) }} />
          ))}
        </div>
      </div>

      <div className="flex items-center gap-2 px-5 py-3.5 border-t border-white/10 text-xs text-white/50">
        <RefreshCw className="w-3.5 h-3.5" />
        {t.landingChatListening}
      </div>
    </div>
  )
}

// ── Journey timeline ───────────────────────────────────────────────────────────
function JourneySection() {
  const t = useT()
  const steps = [
    { title: t.landingJourneyStep1Title, desc: t.landingJourneyStep1Desc },
    { title: t.landingJourneyStep2Title, desc: t.landingJourneyStep2Desc },
    { title: t.landingJourneyStep3Title, desc: t.landingJourneyStep3Desc },
    { title: t.landingJourneyStep4Title, desc: t.landingJourneyStep4Desc },
  ]
  return (
    <section id="journey" className="py-20 sm:py-28 bg-black">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div {...slideUp()} className="mb-14">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-3">{t.landingJourneyTitle}</h2>
          <p className="text-lg text-white/50">{t.landingJourneySub}</p>
        </motion.div>

        <div className="space-y-0">
          {steps.map((s, i) => (
            <motion.div key={i} {...slideUp(i * 0.08)} className="flex gap-6">
              <div className="flex flex-col items-center shrink-0">
                <div
                  className="w-11 h-11 rounded-full flex items-center justify-center font-bold text-white shrink-0"
                  style={{ background: '#E51F26' }}
                >
                  {i + 1}
                </div>
                {i < steps.length - 1 && <div className="w-0.5 flex-1 my-1" style={{ background: '#E51F26', opacity: 0.35 }} />}
              </div>
              <div className={i < steps.length - 1 ? "pb-10" : ""}>
                <h3 className="text-xl font-bold text-white mb-2 pt-1.5">{s.title}</h3>
                <p className="text-white/55 leading-relaxed max-w-xl">{s.desc}</p>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Two conversations (full-bleed red) ────────────────────────────────────────
function ConversationsSection() {
  const t = useT()
  const cards = [
    {
      label: t.landingConvCoachLabel, title: t.landingConvCoachTitle, desc: t.landingConvCoachDesc,
      bullets: [t.landingConvCoachBullet1, t.landingConvCoachBullet2, t.landingConvCoachBullet3],
    },
    {
      label: t.landingConvSimLabel, title: t.landingConvSimTitle, desc: t.landingConvSimDesc,
      bullets: [t.landingConvSimBullet1, t.landingConvSimBullet2, t.landingConvSimBullet3],
    },
  ]
  return (
    <section id="conversations" className="py-20 sm:py-28" style={{ background: '#E51F26' }}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8">
        <motion.div {...slideUp()} className="mb-16 max-w-2xl">
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-3">{t.landingConvTitle}</h2>
          <p className="text-lg text-white/85">{t.landingConvSub}</p>
        </motion.div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 sm:gap-16">
          {cards.map((c, i) => (
            <motion.div key={i} {...slideUp(i * 0.1)}>
              <p className="text-sm font-semibold text-white/70 mb-1">{c.label}</p>
              <h3 className="text-2xl font-bold text-white mb-4">{c.title}</h3>
              <p className="text-white/85 leading-relaxed mb-6">{c.desc}</p>
              <ul className="space-y-3">
                {c.bullets.map(b => (
                  <li key={b} className="flex items-start gap-2.5 text-sm text-white/90">
                    <Check className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

// ── Progress / mastery card ────────────────────────────────────────────────────
function ProgressSection() {
  const t = useT()
  const categories = [
    { label: t.landingProgressCatProduct,    value: 82 },
    { label: t.landingProgressCatCompliance, value: 64 },
    { label: t.landingProgressCatDiscovery,  value: 91 },
    { label: t.landingProgressCatObjections, value: 58 },
    { label: t.landingProgressCatClosing,    value: 77 },
    { label: t.landingProgressCatEthics,     value: 95 },
  ]
  const global = Math.round(categories.reduce((s, c) => s + c.value, 0) / categories.length)
  const bullets = [t.landingProgressBullet1, t.landingProgressBullet2, t.landingProgressBullet3]

  return (
    <section id="progress" className="py-20 sm:py-28 bg-black">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 grid grid-cols-1 lg:grid-cols-2 gap-14 items-start">
        <motion.div {...slideUp()}>
          <h2 className="text-3xl sm:text-4xl font-bold text-white mb-3">{t.landingProgressTitle}</h2>
          <p className="text-lg text-white/50 mb-8">{t.landingProgressSub}</p>
          <ul className="space-y-3">
            {bullets.map(b => (
              <li key={b} className="flex items-start gap-2.5 text-sm text-white/75">
                <Check className="w-4 h-4 shrink-0 mt-0.5" style={{ color: '#E51F26' }} />
                <span>{b}</span>
              </li>
            ))}
          </ul>
        </motion.div>

        <motion.div {...slideUp(0.15)} className="rounded-2xl border border-white/10 bg-white/[0.03] p-6">
          <div className="flex items-center justify-between mb-6">
            <h3 className="font-bold text-white">{t.landingProgressCardTitle}</h3>
            <span className="text-sm text-white/50">
              {t.landingProgressGlobal} <span className="font-bold" style={{ color: '#E51F26' }}>{global}%</span>
            </span>
          </div>
          <div className="space-y-4">
            {categories.map(c => (
              <div key={c.label}>
                <div className="flex items-center justify-between mb-1.5 text-sm">
                  <span className="text-white/80">{c.label}</span>
                  <span className="text-white/50 tabular-nums">{c.value}%</span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-white/10 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${c.value}%`, background: '#E51F26' }} />
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </section>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export function LandingPage() {
  const t = useT()

  return (
    <div className="w-screen min-h-screen bg-black overflow-x-hidden">
      <Header />

      {/* ── Hero ─────────────────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-black">
        <div className="absolute -top-24 -right-24 w-96 h-96 rounded-full blur-3xl" style={{ background: '#E51F26', opacity: 0.08 }} />

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pt-16 pb-20 sm:pt-24 sm:pb-28">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-16 items-center">
            <motion.div {...fadeUp(0)}>
              <h1 className="text-4xl sm:text-5xl font-bold tracking-tight text-white mb-5 leading-[1.1]">
                {t.landingHeroTitleV2}
              </h1>
              <p className="text-lg text-white/60 mb-8 leading-relaxed max-w-lg">
                {t.landingHeroParaV2}
              </p>
              <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
                <Link
                  href="/auth/login"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-white shadow-sm hover:opacity-90 transition-opacity text-sm"
                  style={{ background: '#E51F26' }}
                >
                  {t.landingNavSignIn}
                  <ArrowRight className="w-4 h-4" />
                </Link>
                <Link
                  href="/auth/register"
                  className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-white border border-white/20 hover:bg-white/5 transition-colors text-sm"
                >
                  {t.landingHeroCtaSecondary}
                </Link>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, x: 30 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.7, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
            >
              <DashboardMock />
              <p className="text-sm text-white/40 mt-4 max-w-md">{t.landingChatCaption}</p>
            </motion.div>
          </div>
        </div>
      </section>

      <JourneySection />
      <ConversationsSection />
      <ProgressSection />

      {/* ── Final CTA ──────────────────────────────────────────────────────── */}
      <section className="py-20 sm:py-28 bg-black border-t border-white/10">
        <div className="max-w-2xl mx-auto px-4 sm:px-6 text-center">
          <motion.div {...slideUp()}>
            <h2 className="text-3xl sm:text-4xl font-bold text-white mb-4">{t.landingFinalCtaTitle}</h2>
            <p className="text-lg text-white/55 mb-9">{t.landingFinalCtaSub}</p>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
              <a
                href="mailto:info@rolplay.ai"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-white shadow-sm hover:opacity-90 transition-opacity text-sm"
                style={{ background: '#E51F26' }}
              >
                {t.landingFinalCtaBtn1}
              </a>
              <Link
                href="/auth/login"
                className="inline-flex items-center gap-2 px-6 py-3 rounded-xl font-semibold text-white border border-white/20 hover:bg-white/5 transition-colors text-sm"
              >
                {t.landingFinalCtaBtn2}
              </Link>
            </div>
          </motion.div>
        </div>
      </section>

      {/* ── Footer ─────────────────────────────────────────────────────────── */}
      <footer className="border-t border-white/10 py-14" style={{ background: '#0A0A18' }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2 mb-10">
            <RolplayLogo className="h-5 w-auto text-white" />
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-8 mb-10">
            <div>
              <h4 className="font-semibold text-white mb-4 text-sm">{t.landingFooterProduct}</h4>
              <ul className="space-y-2.5">
                <li><a href="#journey"       className="text-sm text-white/50 hover:text-white transition-colors">{t.landingNavJourney}</a></li>
                <li><a href="#conversations" className="text-sm text-white/50 hover:text-white transition-colors">{t.landingNavConversations}</a></li>
                <li><a href="#progress"      className="text-sm text-white/50 hover:text-white transition-colors">{t.landingNavProgress}</a></li>
                <li><Link href="/auth/login" className="text-sm text-white/50 hover:text-white transition-colors">{t.landingNavSignIn}</Link></li>
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-white mb-4 text-sm">{t.landingFooterRolplay}</h4>
              <ul className="space-y-2.5">
                <li><a href="https://rolplay.ai" target="_blank" rel="noopener noreferrer" className="text-sm text-white/50 hover:text-white transition-colors">rolplay.ai</a></li>
                <li><a href="mailto:info@rolplay.ai" className="text-sm text-white/50 hover:text-white transition-colors">{t.landingFooterContact}</a></li>
                <li><Link href="/auth/register" className="text-sm text-white/50 hover:text-white transition-colors">{t.landingHeroCtaSecondary}</Link></li>
              </ul>
            </div>
          </div>

          <div className="border-t border-white/10 pt-8 flex flex-col sm:flex-row justify-between items-center gap-4">
            <p className="text-xs text-white/35">© 2026 <span translate="no">{APP_NAME}</span>. {t.landingFooterRights}</p>
            <div className="flex items-center gap-5">
              <Link href="/privacy" className="text-xs text-white/35 hover:text-white/60 transition-colors">{t.landingFooterPrivacy}</Link>
              <span className="text-xs text-white/35">{t.landingFooterOwnedBy}</span>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
