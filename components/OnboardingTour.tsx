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
import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { AnimatePresence, motion, useReducedMotion } from "framer-motion"
import { X, Check, Sparkles, Target, BookOpen, BrainCircuit, Gamepad2, Trophy, ChevronLeft, ChevronRight } from "lucide-react"
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

const LAST_STEP = STEPS.length - 1

/** The persistent mini-map across the top: every stage at a glance, done /
 *  active / upcoming, connected by a line — the "visual connection between
 *  stages" the tour is meant to convey, always visible rather than only
 *  implied by a step counter. */
function JourneyMap({ current }: { current: number }) {
  return (
    <div className="flex items-center mb-6" aria-hidden="true">
      {STEPS.map((s, i) => {
        const StepIcon = s.icon
        const done = i < current
        const active = i === current
        return (
          <div key={i} className={cn("flex items-center", i < LAST_STEP && "flex-1")}>
            <div
              className={cn(
                "relative shrink-0 w-8 h-8 rounded-full flex items-center justify-center border-2 transition-all duration-300",
                done && "bg-primary border-primary text-primary-foreground",
                active && "bg-primary/10 border-primary text-primary scale-110 shadow-[0_0_0_4px_hsl(var(--primary)/0.15)]",
                !done && !active && "bg-muted border-border text-muted-foreground"
              )}
            >
              {done ? <Check className="w-3.5 h-3.5" /> : <StepIcon className="w-3.5 h-3.5" />}
            </div>
            {i < LAST_STEP && (
              <div
                className={cn(
                  "h-0.5 flex-1 mx-1 rounded-full transition-colors duration-500",
                  done ? "bg-primary" : "bg-border"
                )}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

export function OnboardingTour() {
  const t = useT()
  const router = useRouter()
  const { user, markOnboardingComplete } = useAuthContext()
  const { isOpen, open, close } = useOnboardingStore()
  const { platformName } = usePlatformName()
  const prefersReducedMotion = useReducedMotion()
  const [step, setStep] = useState(0)
  // Tracks whether the last move was forward or back, so the step content
  // slides in from the matching direction instead of always the same way.
  const [direction, setDirection] = useState(1)
  const autoOpenedFor = useRef<number | null>(null)
  const primaryButtonRef = useRef<HTMLButtonElement>(null)
  const titleId = "onboarding-tour-title"

  // Auto-open exactly once per user, the first time we learn this user has
  // never dismissed the tour. Guarded by user.id so it never re-fires for
  // the same login just because some unrelated part of AuthUser re-renders.
  useEffect(() => {
    if (!user || user.onboarding_completed_at) return
    if (autoOpenedFor.current === user.id) return
    autoOpenedFor.current = user.id
    setStep(0)
    setDirection(1)
    open()
  }, [user, open])

  const dismiss = useCallback((navigateTo?: string) => {
    close()
    markOnboardingComplete()
    fetch("/api/onboarding/complete", { method: "POST", credentials: "include" }).catch(() => {})
    if (navigateTo) router.push(navigateTo)
  }, [close, markOnboardingComplete, router])

  const goNext = useCallback(() => {
    setDirection(1)
    setStep(s => Math.min(LAST_STEP, s + 1))
  }, [])

  const goBack = useCallback(() => {
    setDirection(-1)
    setStep(s => Math.max(0, s - 1))
  }, [])

  // Keyboard support: Escape skips (same as the close button); arrow keys
  // step through, without stealing focus from an input if one ever appears.
  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") { dismiss(); return }
      if (e.key === "ArrowRight") goNext()
      if (e.key === "ArrowLeft") goBack()
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [isOpen, dismiss, goNext, goBack])

  // Autofocus the primary action on every step so keyboard/screen-reader
  // users land somewhere useful without hunting for it.
  useEffect(() => {
    if (isOpen) primaryButtonRef.current?.focus()
  }, [isOpen, step])

  if (!isOpen) return null

  const current = STEPS[step]
  const Icon = current.icon
  const isLast = step === LAST_STEP

  const slideVariants = {
    enter: (dir: number) => (prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: dir > 0 ? 24 : -24 }),
    center: { opacity: 1, x: 0 },
    exit: (dir: number) => (prefersReducedMotion ? { opacity: 0 } : { opacity: 0, x: dir > 0 ? -24 : 24 }),
  }

  return (
    <AnimatePresence>
      <motion.div
        key="onboarding-backdrop"
        className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        initial={prefersReducedMotion ? false : { opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
      >
        <motion.div
          className="relative w-full max-w-md sm:max-w-lg max-h-[88vh] overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl"
          initial={prefersReducedMotion ? false : { opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 8 }}
          transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
        >
          <div className="h-[3px] w-full rounded-t-2xl bg-gradient-to-r from-primary to-accent" />

          <button
            onClick={() => dismiss()}
            aria-label={t.onboardingCloseAria}
            className="absolute top-4 right-4 p-1.5 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors z-10"
          >
            <X className="w-4 h-4" />
          </button>

          <div className="p-6 sm:p-8">
            <JourneyMap current={step} />

            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-4">
              {t.onboardingStepLabel.replace("{current}", String(step + 1)).replace("{total}", String(STEPS.length))}
            </p>

            <AnimatePresence mode="wait" custom={direction} initial={false}>
              <motion.div
                key={step}
                custom={direction}
                variants={slideVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: 0.22, ease: "easeOut" }}
              >
                <div className="relative w-12 h-12 rounded-2xl bg-gradient-to-br from-primary/15 to-accent/10 text-primary flex items-center justify-center mb-4">
                  <Icon className="w-6 h-6" />
                </div>

                <h2 id={titleId} className="text-xl font-bold text-foreground mb-2">
                  {t[current.titleKey].replace("{platform}", platformName)}
                </h2>
                <p className="text-sm text-muted-foreground leading-relaxed mb-8">
                  {t[current.bodyKey]}
                </p>
              </motion.div>
            </AnimatePresence>

            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <button
                onClick={() => dismiss()}
                className="text-xs font-medium text-muted-foreground hover:text-foreground transition-colors order-2 sm:order-1 self-start"
              >
                {t.onboardingSkip}
              </button>

              <div className="flex items-center gap-2 order-1 sm:order-2">
                {step > 0 && (
                  <button
                    onClick={goBack}
                    className="inline-flex items-center gap-1 px-3 py-2 rounded-xl border border-border bg-muted hover:bg-muted/70 text-sm font-semibold transition-colors"
                  >
                    <ChevronLeft className="w-4 h-4" />
                    {t.onboardingBack}
                  </button>
                )}
                {!isLast ? (
                  <button
                    ref={primaryButtonRef}
                    onClick={goNext}
                    className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 active:scale-[0.98] transition-all"
                  >
                    {t.onboardingNext}
                    <ChevronRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    ref={primaryButtonRef}
                    onClick={() => dismiss(current.href)}
                    className="flex-1 sm:flex-none inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 active:scale-[0.98] transition-all"
                  >
                    <Target className="w-4 h-4" />
                    {t.onboardingStartDiagnostic}
                  </button>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  )
}
