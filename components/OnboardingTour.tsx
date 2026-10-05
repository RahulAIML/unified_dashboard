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
 * Guided, not just an intro: the middle steps (Diagnostic/Learn/Practice/
 * Simulate) spotlight the REAL sidebar nav item they describe (via
 * NAV_TOUR_TARGETS' data-tour hooks in Sidebar.tsx) on desktop, where the
 * sidebar is always on screen — rather than a plain centered card describing
 * a page you can't see. Each of those steps is skipped entirely for a
 * tenant that doesn't actually have that module (useAvailableModules /
 * hasJourney) or nav item to point at (see STEPS_ORDER filtering below); a
 * step must never point at UI that doesn't exist for this tenant. The
 * welcome and closing steps stay as a centered card (nothing to point at),
 * and the whole tour falls back to that same centered card on any viewport
 * where the sidebar itself isn't visible (below md — it's a slide-out drawer
 * there, not a fixture on screen).
 *
 * "Diagnostic" is presented as the mandatory first step per spec, but there
 * is no dedicated diagnostic-taking route in this platform today (see
 * app/api/dashboard/journey-bookends/route.ts's own docstring — real mode
 * never fabricates one). The CTA instead opens /journey, the real page where
 * the Initial Diagnostic bookend is shown, rather than inventing a new route.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { useReducedMotion } from "framer-motion"
import { X, Check, Sparkles, Target, BookOpen, BrainCircuit, Gamepad2, Trophy, ChevronLeft, ChevronRight } from "lucide-react"
import { useT } from "@/lib/lang-store"
import { useAuthContext } from "@/components/AuthProvider"
import { useOnboardingStore } from "@/lib/onboarding-store"
import { usePlatformName } from "@/lib/hooks/usePlatformName"
import { useAvailableModules } from "@/lib/hooks/useAvailableModules"
import { hasJourney } from "@/lib/journey"
import { NAV_TOUR_TARGETS } from "@/lib/nav-tour-targets"
import { cn } from "@/lib/utils"
import type { TranslationKey } from "@/lib/translations"
import type { Module } from "@/lib/types"

interface Step {
  icon: React.ComponentType<{ className?: string }>
  titleKey: TranslationKey
  bodyKey: TranslationKey
  /** Real route this stage lives at — undefined for the welcome/closing steps. */
  href?: string
  /** Module gate: skip this step entirely if the tenant doesn't have it. */
  moduleGate?: Module
  /** true = gate on hasJourney() instead of a module. */
  journeyGate?: boolean
  /** true = spotlight the matching sidebar nav item (NAV_TOUR_TARGETS[href])
   *  instead of rendering as a centered card, on viewports where the sidebar
   *  is actually visible. */
  spotlight?: boolean
}

const ALL_STEPS: Step[] = [
  { icon: Sparkles,      titleKey: "onboardingWelcomeTitle",    bodyKey: "onboardingWelcomeBody" },
  { icon: Target,        titleKey: "onboardingDiagnosticTitle", bodyKey: "onboardingDiagnosticBody", href: "/journey",   journeyGate: true,             spotlight: true },
  { icon: BookOpen,      titleKey: "onboardingLearnTitle",      bodyKey: "onboardingLearnBody",      href: "/lms",       moduleGate: "lms",             spotlight: true },
  { icon: BrainCircuit,  titleKey: "onboardingPracticeTitle",   bodyKey: "onboardingPracticeBody",   href: "/coach",     moduleGate: "coach",           spotlight: true },
  { icon: Gamepad2,      titleKey: "onboardingSimulateTitle",   bodyKey: "onboardingSimulateBody",   href: "/simulator", moduleGate: "simulator",       spotlight: true },
  { icon: Trophy,        titleKey: "onboardingProgressTitle",   bodyKey: "onboardingProgressBody",   href: "/journey",   journeyGate: true },
]

/** Recomputed whenever the tenant's real modules/journey change — a step
 *  must never survive into the walk pointing at UI this tenant doesn't have. */
function useVisibleSteps(): Step[] {
  const { modules } = useAvailableModules()
  const journeyOk = hasJourney(modules)
  return useMemo(
    () => ALL_STEPS.filter(s => {
      if (s.moduleGate) return modules.includes(s.moduleGate)
      if (s.journeyGate) return journeyOk
      return true
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [modules.join(","), journeyOk]
  )
}

/** md breakpoint (Tailwind) — matches Sidebar.tsx's own `hidden md:flex`, the
 *  point at which the sidebar is a fixture on screen rather than a drawer. */
function useIsDesktopViewport(): boolean {
  const [isDesktop, setIsDesktop] = useState(
    () => typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches
  )
  useEffect(() => {
    const mql = window.matchMedia("(min-width: 768px)")
    const onChange = () => setIsDesktop(mql.matches)
    mql.addEventListener("change", onChange)
    return () => mql.removeEventListener("change", onChange)
  }, [])
  return isDesktop
}

interface TargetRect { top: number; left: number; width: number; height: number }

/** Tracks the on-screen position of the current step's real nav item (by its
 *  data-tour hook), so the spotlight/tooltip can follow it through scroll,
 *  resize, and sidebar re-renders (e.g. a capability probe changing which
 *  nav items exist). Returns null whenever there's nothing to point at —
 *  callers fall back to the centered-card layout rather than pointing at
 *  empty space. */
function useSpotlightTarget(dataTourKey: string | undefined, active: boolean): TargetRect | null {
  const [rect, setRect] = useState<TargetRect | null>(null)

  useEffect(() => {
    if (!active || !dataTourKey) {
      setRect(null)
      return
    }

    let raf = 0
    const measure = () => {
      const el = document.querySelector<HTMLElement>(`[data-tour="${dataTourKey}"]`)
      // offsetParent is null for a display:none element (e.g. the mobile
      // drawer's copy of the sidebar while it's closed) — never spotlight
      // something the user can't actually see.
      if (!el || el.offsetParent === null) {
        setRect(null)
        return
      }
      const r = el.getBoundingClientRect()
      setRect({ top: r.top, left: r.left, width: r.width, height: r.height })
    }

    const scheduleMeasure = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(measure)
    }

    scheduleMeasure()
    window.addEventListener("resize", scheduleMeasure)
    window.addEventListener("scroll", scheduleMeasure, true)
    // The sidebar's own nav list can change size (capability probes resolving
    // after mount), shifting every item below it — a plain resize/scroll
    // listener wouldn't catch that.
    const ro = new ResizeObserver(scheduleMeasure)
    const nav = document.querySelector(`[data-tour="${dataTourKey}"]`)?.closest("nav")
    if (nav) ro.observe(nav)

    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener("resize", scheduleMeasure)
      window.removeEventListener("scroll", scheduleMeasure, true)
      ro.disconnect()
    }
  }, [dataTourKey, active])

  return rect
}

/** The persistent mini-map across the top: every stage at a glance, done /
 *  active / upcoming, connected by a line — the "visual connection between
 *  stages" the tour is meant to convey, always visible rather than only
 *  implied by a step counter. */
function JourneyMap({ steps, current }: { steps: Step[]; current: number }) {
  const lastStep = steps.length - 1
  return (
    <div className="flex items-center mb-6" aria-hidden="true">
      {steps.map((s, i) => {
        const StepIcon = s.icon
        const done = i < current
        const active = i === current
        return (
          <div key={i} className={cn("flex items-center", i < lastStep && "flex-1")}>
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
            {i < lastStep && (
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
  const isDesktop = useIsDesktopViewport()
  const steps = useVisibleSteps()
  const lastStep = steps.length - 1
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

  // The tenant's real modules can resolve (or the viewport can cross the
  // md breakpoint) after the tour is already open, changing `steps.length` —
  // clamp so `step` never points past the end of a walk that just got shorter.
  useEffect(() => {
    setStep(s => Math.min(s, lastStep))
  }, [lastStep])

  const dismiss = useCallback((navigateTo?: string) => {
    close()
    markOnboardingComplete()
    fetch("/api/onboarding/complete", { method: "POST", credentials: "include" }).catch(() => {})
    if (navigateTo) router.push(navigateTo)
  }, [close, markOnboardingComplete, router])

  const goNext = useCallback(() => {
    setStep(s => {
      if (s >= lastStep) return s
      setDirection(1)
      return s + 1
    })
  }, [lastStep])

  const goBack = useCallback(() => {
    setStep(s => {
      if (s <= 0) return s
      setDirection(-1)
      return s - 1
    })
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

  const current = steps[step]
  const Icon = current?.icon
  const isLast = step === lastStep

  const spotlightKey = current?.spotlight && current.href ? NAV_TOUR_TARGETS[current.href] : undefined
  const targetRect = useSpotlightTarget(spotlightKey, isOpen && isDesktop)
  // Only actually spotlight once we have real, on-screen coordinates to
  // point at — otherwise this step just renders as the centered card, same
  // as welcome/closing, rather than a dark screen with nothing highlighted.
  const showSpotlight = isDesktop && Boolean(spotlightKey) && targetRect !== null

  if (!isOpen || !current) return null

  const titleNode = (
    <h2 id={titleId} className="text-xl font-bold text-foreground mb-2">
      {/* Chrome's translate feature "corrects" brand names it doesn't
          recognize (Rolplay -> Roleplay) unless the element carries
          translate="no" -- see components/HtmlLangSync.tsx's docstring.
          Only the welcome step interpolates {platform} at all; the
          split+span keeps that protection scoped to just the brand name,
          not the whole (already-translated) sentence around it. */}
      {t[current.titleKey].includes("{platform}")
        ? t[current.titleKey].split("{platform}").map((part, i, arr) => (
            <span key={i}>
              {part}
              {i < arr.length - 1 && <span translate="no">{platformName}</span>}
            </span>
          ))
        : t[current.titleKey]}
    </h2>
  )

  const navButtons = (
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
            {/* "Start Diagnostic" only reads correctly when this really is
                the closing "Progress" step (journeyGate) landing on /journey
                -- if that step got filtered out (tenant has no Journey) and a
                different step ends up last instead, its own href is still a
                real, useful page to land on, just not a "diagnostic". */}
            {current.journeyGate ? <Target className="w-4 h-4" /> : <Check className="w-4 h-4" />}
            {current.journeyGate ? t.onboardingStartDiagnostic : t.onboardingFinish}
          </button>
        )}
      </div>
    </div>
  )

  const stepBody = (
    <div
      key={step}
      className={!prefersReducedMotion ? (direction > 0 ? "animate-step-in-right" : "animate-step-in-left") : undefined}
    >
      <div className="relative w-12 h-12 rounded-2xl bg-gradient-to-br from-primary/15 to-accent/10 text-primary flex items-center justify-center mb-4">
        <Icon className="w-6 h-6" />
      </div>
      {titleNode}
      <p className="text-sm text-muted-foreground leading-relaxed mb-8">
        {t[current.bodyKey]}
      </p>
    </div>
  )

  // Deliberately plain conditional rendering + CSS keyframes, NOT
  // framer-motion's AnimatePresence, anywhere in this component. Two real
  // bugs traced back to it, confirmed live in the browser (not just in
  // mocked tests):
  //  1) A production crash ("Failed to execute 'insertBefore' ... not a
  //     child of this node") whenever an unrelated re-render (a theme
  //     toggle, a route change from a sidebar click) landed while
  //     framer-motion still held a reference to a node it was mid-exit on
  //     -- traced to gating the whole modal's presence with a bare
  //     `if (!isOpen) return null` above an AnimatePresence, which unmounts
  //     it directly via React instead of letting it manage its own exit.
  //  2) `AnimatePresence mode="wait"` around the step content (title/icon/
  //     body) desynced from the step counter and nav buttons on the very
  //     first transition, every time, independent of nesting or click
  //     speed -- confirmed by removing AnimatePresence entirely and seeing
  //     the same content update correctly on every click. Whatever the
  //     exact framer-motion/React interaction is, it isn't reliable here.
  // Plain `key`-based remounts (proven correct above) plus the
  // `.animate-step-in-left/right` and `.animate-fade-in` CSS keyframes
  // (app/globals.css) give the same visual polish without either failure
  // mode: no framer-motion node to leak on close, no exit/enter choreography
  // to get stuck mid-cycle.

  if (showSpotlight && targetRect) {
    // Guided step: dim the whole page, cut a hole around the real sidebar
    // item this step describes, and float the card next to it — this is
    // the actual point of a "guided" tour vs. a plain intro dialog. The
    // click-blocker below carries the dialog semantics (role/aria-modal);
    // the spotlight cutout is purely visual (box-shadow can't be clicked),
    // and it alone would leave the rest of the page interactive.
    const PAD = 6
    const cardTop = Math.min(Math.max(targetRect.top - 8, 16), Math.max(window.innerHeight - 200, 16))
    return (
      <>
        <div
          className="fixed inset-0 z-[70]"
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
        />
        <div
          className="fixed z-[71] rounded-xl pointer-events-none transition-[top,left,width,height] duration-200"
          style={{
            top: targetRect.top - PAD,
            left: targetRect.left - PAD,
            width: targetRect.width + PAD * 2,
            height: targetRect.height + PAD * 2,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.6)",
          }}
        />
        <div
          className={cn(
            "fixed z-[72] w-[calc(100vw-2rem)] max-w-sm rounded-2xl border border-border bg-card shadow-2xl overflow-hidden",
            !prefersReducedMotion && "animate-fade-in"
          )}
          style={{ top: cardTop, left: targetRect.left + targetRect.width + 16, maxHeight: "calc(100vh - 32px)" }}
        >
          <div className="h-[3px] w-full bg-gradient-to-r from-primary to-accent" />
          <div className="p-5 overflow-y-auto" style={{ maxHeight: "calc(100vh - 40px)" }}>
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              {t.onboardingStepLabel.replace("{current}", String(step + 1)).replace("{total}", String(steps.length))}
            </p>
            {stepBody}
            {navButtons}
          </div>
        </div>
      </>
    )
  }

  return (
      <div
        className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div
          className={cn(
            "relative w-full max-w-md sm:max-w-lg max-h-[88vh] overflow-y-auto rounded-2xl border border-border bg-card shadow-2xl",
            !prefersReducedMotion && "animate-fade-in"
          )}
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
            <JourneyMap steps={steps} current={step} />

            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-4">
              {t.onboardingStepLabel.replace("{current}", String(step + 1)).replace("{total}", String(steps.length))}
            </p>

            {stepBody}
            {navButtons}
          </div>
        </div>
      </div>
  )
}
