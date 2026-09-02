"use client"

/**
 * First-time guided tour — shown once per user (see AuthUser.onboarding_
 * completed_at, users.onboarding_completed_at in lib/db-users.ts), replayable
 * any time from Settings ("Replay guided tour").
 *
 * Platform-wide: uses the real journey stages from lib/journey.ts (LMS,
 * Master Coach, Simulator) — never a client-specific name — and the existing
 * i18n system (lib/lang-store.ts's useT), so it reads 100% in whichever
 * language is active, for every client.
 *
 * "Diagnostic" is presented as the mandatory first step per spec, but there
 * is no dedicated diagnostic-taking route in this platform today (see
 * app/api/dashboard/journey-bookends/route.ts's own docstring — real mode
 * never fabricates one). The CTA instead opens /journey, the real page where
 * the Initial Diagnostic bookend is shown, rather than inventing a new route.
 */
import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { X, Sparkles, Target, BookOpen, BrainCircuit, Gamepad2, Trophy, ChevronLeft, ChevronRight } from "lucide-react"
import { useT } from "@/lib/lang-store"
import { useAuthContext } from "@/components/AuthProvider"
import { useOnboardingStore } from "@/lib/onboarding-store"
import { usePlatformName } from "@/lib/hooks/usePlatformName"
import { cn } from "@/lib/utils"
import type { TranslationKey } from "@/lib/translations"

interface Step {
  icon: React.ComponentType<{ className?: string }>
  titleKey: TranslationKey
  bodyKey: TranslationKey
  /** Real route this stage lives at — undefined for the welcome step. */
  href?: string
}

const STEPS: Step[] = [
  { icon: Sparkles,      titleKey: "onboardingWelcomeTitle",    bodyKey: "onboardingWelcomeBody" },
  { icon: Target,        titleKey: "onboardingDiagnosticTitle", bodyKey: "onboardingDiagnosticBody", href: "/journey" },
  { icon: BookOpen,      titleKey: "onboardingLearnTitle",      bodyKey: "onboardingLearnBody",      href: "/lms" },
  { icon: BrainCircuit,  titleKey: "onboardingPracticeTitle",   bodyKey: "onboardingPracticeBody",   href: "/coach" },
  { icon: Gamepad2,      titleKey: "onboardingSimulateTitle",   bodyKey: "onboardingSimulateBody",   href: "/simulator" },
  { icon: Trophy,        titleKey: "onboardingProgressTitle",   bodyKey: "onboardingProgressBody",   href: "/journey" },
]

export function OnboardingTour() {
  const t = useT()
  const router = useRouter()
  const { user, markOnboardingComplete } = useAuthContext()
  const { isOpen, open, close } = useOnboardingStore()
  const { platformName } = usePlatformName()
  const [step, setStep] = useState(0)
  const autoOpenedFor = useRef<number | null>(null)

  // Auto-open exactly once per user, the first time we learn this user has
  // never dismissed the tour. Guarded by user.id so it never re-fires for
  // the same login just because some unrelated part of AuthUser re-renders.
  useEffect(() => {
    if (!user || user.onboarding_completed_at) return
    if (autoOpenedFor.current === user.id) return
    autoOpenedFor.current = user.id
    setStep(0)
    open()
  }, [user, open])

  if (!isOpen) return null

  const dismiss = async (navigateTo?: string) => {
    close()
    markOnboardingComplete()
    fetch("/api/onboarding/complete", { method: "POST", credentials: "include" }).catch(() => {})
    if (navigateTo) router.push(navigateTo)
  }

  const current = STEPS[step]
  const Icon = current.icon
  const isLast = step === STEPS.length - 1

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
      role="dialog"
      aria-modal="true"
    >
      <div className="relative w-full max-w-md sm:max-w-lg max-h-[90vh] overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl">
        <div className="h-[3px] w-full rounded-t-2xl bg-gradient-to-r from-primary to-accent" />

        <button
          onClick={() => dismiss()}
          aria-label={t.onboardingCloseAria}
          className="absolute top-4 right-4 p-1.5 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="p-6 sm:p-8">
          {/* Progress dots */}
          <div className="flex items-center gap-1.5 mb-6">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={cn(
                  "h-1.5 flex-1 rounded-full transition-colors",
                  i <= step ? "bg-primary" : "bg-muted"
                )}
              />
            ))}
          </div>

          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-4">
            {t.onboardingStepLabel.replace("{current}", String(step + 1)).replace("{total}", String(STEPS.length))}
          </p>

          <div className="w-12 h-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mb-4">
            <Icon className="w-6 h-6" />
          </div>

          <h2 className="text-xl font-bold text-foreground mb-2">
            {t[current.titleKey].replace("{platform}", platformName)}
          </h2>
          <p className="text-sm text-muted-foreground leading-relaxed mb-8">
            {t[current.bodyKey]}
          </p>

          <div className="flex items-center justify-between gap-3">
            <button
              onClick={() => dismiss()}
              className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              {t.onboardingSkip}
            </button>

            <div className="flex items-center gap-2">
              {step > 0 && (
                <button
                  onClick={() => setStep(s => Math.max(0, s - 1))}
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-border bg-muted hover:bg-muted/70 text-sm font-semibold transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                  {t.onboardingBack}
                </button>
              )}
              {!isLast ? (
                <button
                  onClick={() => setStep(s => Math.min(STEPS.length - 1, s + 1))}
                  className="inline-flex items-center gap-1 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity"
                >
                  {t.onboardingNext}
                  <ChevronRight className="w-4 h-4" />
                </button>
              ) : (
                <button
                  onClick={() => dismiss(current.href)}
                  className="inline-flex items-center gap-1 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity"
                >
                  {t.onboardingStartDiagnostic}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
