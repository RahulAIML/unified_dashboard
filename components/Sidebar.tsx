"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { motion } from "framer-motion"
import {
  LayoutDashboard, BookOpen, BrainCircuit, Gamepad2,
  BadgeCheck, Database, Sun, Moon, Settings, LogOut, MessageSquare,
  GitBranch, Building2, Activity, FileText, Route, Trophy, BarChart3, Sparkles, Users,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useTheme } from "./ThemeProvider"
import { useT } from "@/lib/lang-store"
import { useClientBrand } from "@/lib/hooks/useClientBrand"
import { usePlatformName } from "@/lib/hooks/usePlatformName"
import { useAuthContext } from "./AuthProvider"
import { useApi } from "@/lib/hooks/useApi"
import { useAvailableModules } from "@/lib/hooks/useAvailableModules"
import { hasJourney } from "@/lib/journey"
import type { Module } from "@/lib/types"

// Minimal capability shape from /api/auth/access-status (only the flag we need).
interface AccessCaps { hasPharmaAccess?: boolean; hasCoachData?: boolean; hasBancoAccess?: boolean; hasRolplayAppAccess?: boolean; hasBusinessLines?: boolean }

function LogoImage() {
  const brand = useClientBrand()
  const [failed, setFailed] = useState(false)

  // Shared container — white so uploaded logos (usually on white/transparent
  // backgrounds) sit correctly instead of on a dark panel that looks like an
  // extra box around the image.
  const containerCls =
    "shrink-0 w-32 h-12 rounded-xl border border-sidebar-border bg-white flex items-center justify-center px-2 overflow-hidden"

  if (failed) {
    return (
      <div className={containerCls}>
        <div className="w-10 h-10 rounded-lg flex items-center justify-center text-sidebar-primary-foreground font-extrabold text-lg bg-sidebar-primary">
          {brand.name.charAt(0)}
        </div>
      </div>
    )
  }

  return (
    <div className={containerCls}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={brand.logo}
        alt={brand.logoAlt}
        // max-h-10 = 40px tall cap; max-w-[120px] prevents wide logos from
        // overflowing the 128px container; object-contain preserves aspect ratio.
        className="max-h-10 max-w-[120px] w-auto h-auto object-contain"
        onError={() => setFailed(true)}
      />
    </div>
  )
}

export function Sidebar() {
  const pathname = usePathname()
  const router   = useRouter()
  const { theme, toggle } = useTheme()
  const t     = useT()
  const brand = useClientBrand()
  const { platformName } = usePlatformName()
  const { user, clearAuth } = useAuthContext()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  // Capability probe — used to surface analytics views only for tenants that
  // actually have that data (e.g. Conversational needs pharma objection data).
  const { data: access } = useApi<AccessCaps>(user ? "/api/auth/access-status" : null)

  // Dynamic render: which solution pages this tenant actually has.
  const { modules: availableModules } = useAvailableModules()
  const hasModule = (m: string) => availableModules.includes(m as Module)

  // Close on Escape + prevent background scroll when open (mobile)
  useEffect(() => {
    if (!mobileOpen) return

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMobileOpen(false)
    }
    window.addEventListener("keydown", onKeyDown)

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = "hidden"

    return () => {
      window.removeEventListener("keydown", onKeyDown)
      document.body.style.overflow = prevOverflow
    }
  }, [mobileOpen])

  const handleLogout = useCallback(async () => {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    } catch {
      // ignore network errors — clear client state regardless
    } finally {
      clearAuth()
      router.push('/auth/login')
    }
  }, [loggingOut, clearAuth, router])

  // Same nav for every organisation — data source is resolved server-side.
  // /admin/tenants (manual tenant wizard) is intentionally NOT listed here —
  // the AI Dashboard Builder is the primary onboarding path now. The page
  // and its API still work at their direct URL for internal admin use
  // (e.g. manually deactivating a tenant), just not surfaced in client nav.
  const nav = [
    { href: "/",              label: t.navOverview,      icon: LayoutDashboard },
    // The journey needs at least two services to be a progression; with one
    // there is nothing to sequence, so the entry hides rather than showing a
    // single lonely stage. hasJourney() owns that rule.
    ...(hasJourney(availableModules) ? [{ href: "/journey", label: t.navJourney, icon: Route }] : []),
    // Solution pages render only for modules this tenant actually has, so a
    // client never lands on an empty module page. Overview/Settings always show.
    ...(hasModule('lms')           ? [{ href: "/lms",           label: t.navLms,        icon: BookOpen     }] : []),
    ...(hasModule('coach')         ? [{ href: "/coach",         label: t.navCoach,      icon: BrainCircuit }] : []),
    ...(hasModule('simulator')     ? [{ href: "/simulator",     label: t.navSimulator,  icon: Gamepad2     }] : []),
    // Activities works for any tenant with per-activity analytics data —
    // rolplay-app tenants included, matching the reference dashboards'
    // "Actividades" nav item (docs/sanfer-dashboard-inventory.md).
    // /api/dashboard/usecase-breakdown already had a real rolplay-app branch;
    // this was purely a nav-gating omission, not a missing data path.
    ...((access?.hasCoachData || access?.hasPharmaAccess || access?.hasBancoAccess || access?.hasRolplayAppAccess)
      ? [{ href: "/activities", label: t.navActivities, icon: Activity }] : []),
    // Ranking: a dedicated leaderboard page, matching the reference
    // dashboards' "Clasificación" nav item. /api/dashboard/best-performers
    // already has a real branch for every org type (banco/pharma/rolplay-app/
    // analytics) -- same gate as Activities/Reports, not rolplay-app-only,
    // since the leaderboard itself is universal, not connector-specific.
    ...((access?.hasCoachData || access?.hasPharmaAccess || access?.hasBancoAccess || access?.hasRolplayAppAccess)
      ? [{ href: "/ranking", label: t.navRanking, icon: Trophy }] : []),
    // Conversational is pharma-only (objection-handling data). Capability-gated
    // so it appears exactly for the tenants that have it — no hardcoded list.
    ...(access?.hasPharmaAccess ? [
      { href: "/conversational", label: t.navConversational, icon: MessageSquare },
      { href: "/organization",   label: t.navOrganization,   icon: Building2     },
    ] : []),
    // Business Segments: previously shown for every pharma-sim tenant
    // regardless of whether they actually have segment data, landing tenants
    // without it (Apotex, M8, ...) on a structurally-empty page. hasBusinessLines
    // is a real per-tenant flag (Sanfer's tag1 catalog, confirmed live) — gate
    // on that specifically, not just generic pharma access.
    ...(access?.hasBusinessLines ? [
      { href: "/business-lines", label: t.navBusinessLines,  icon: GitBranch     },
    ] : []),
    ...(hasModule('certification')  ? [{ href: "/certification", label: t.navCertification, icon: BadgeCheck }] : []),
    ...(hasModule('second-brain')   ? [{ href: "/second-brain",  label: t.navSecondBrain,   icon: Database   }] : []),
    // KPIs: Sugerencia de KPI's Cesar.xlsx, rolplay-app only (the one
    // connector this spec was verified against real data for).
    ...(access?.hasRolplayAppAccess ? [{ href: "/kpis", label: t.navKpis, icon: BarChart3 }] : []),
    ...((access?.hasCoachData || access?.hasPharmaAccess || access?.hasBancoAccess || access?.hasRolplayAppAccess)
      ? [{ href: "/reports", label: t.navReports, icon: FileText }] : []),
    // Admin-only: the AI Dashboard Builder has no other discoverable entry
    // point today (layout.tsx already enforces the real admin gate
    // server-side; this is purely so an admin doesn't have to know/type the
    // URL). Role comes from the authenticated user record, never a client
    // toggle -- see layout.tsx for the actual boundary.
    ...(user?.role === 'admin'
      ? [
          { href: "/dashboard-builder", label: t.navDashboardBuilder, icon: Sparkles },
          { href: "/admin/users",       label: t.navAdminUsers,       icon: Users    },
        ] : []),
    { href: "/settings",      label: t.navSettings,      icon: Settings        },
  ]

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setMobileOpen(false)
  }, [pathname])

  const sidebarContent = (
    <>
      {/* Brand header */}
      <div className="relative h-20 flex items-center gap-3 px-5 border-b border-sidebar-border overflow-hidden">
        {/* Brand top gradient stripe — matches drilldown/header stripe */}
        <div
          className="absolute top-0 left-0 right-0 h-[3px]"
          style={{ background: `linear-gradient(90deg, hsl(var(--primary)), hsl(var(--accent)))` }}
        />

        <LogoImage />

        <div className="min-w-0">
          <p className="text-sm font-extrabold tracking-tight leading-tight break-words text-sidebar-foreground" title={platformName} translate="no">
            {platformName}
          </p>
          {/* Just "Dashboard", not "{brand.name} Dashboard". brand.name is a fixed
              constant ("Rolplay Analytics" — see DEFAULT_BRAND_NAME in
              lib/branding.ts), not the per-user platformName above it, so this line
              used to silently ignore your customization: rename the platform to
              "Acme" and the bold title updates, but this line still read "Rolplay
              Analytics Dashboard" underneath it — inconsistent with the name you
              just set. Dropping the brand name here removes that mismatch entirely. */}
          <p className="text-[10px] text-sidebar-foreground/50 leading-tight break-words" translate="no">{t.dashboardWord}</p>
        </div>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = pathname === href
          return (
            <Link key={href} href={href}>
              <motion.div
                whileHover={{ x: 2 }}
                className={cn(
                  "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                  active
                    ? "bg-sidebar-primary text-sidebar-primary-foreground"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{label}</span>
                {active && (
                  <span className="ml-auto w-1.5 h-1.5 rounded-full bg-sidebar-foreground/60 shrink-0" />
                )}
              </motion.div>
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-sidebar-border space-y-1">
        <button
          onClick={toggle}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
        >
          {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          {theme === "dark" ? t.lightMode : t.darkMode}
        </button>
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-destructive/80 hover:bg-destructive/10 hover:text-destructive transition-colors disabled:opacity-50"
        >
          <LogOut className="w-4 h-4 shrink-0" />
          {loggingOut ? '…' : t.logout}
        </button>
        <p className="text-xs text-sidebar-foreground/30 mt-1 px-3">{t.phaseLabel}</p>
      </div>
    </>
  )

  return (
    <>
      {/* Desktop sidebar - hidden on mobile, shown on md+ */}
      <aside className="hidden md:flex w-64 shrink-0 bg-sidebar border-r border-sidebar-border flex-col z-30">
        {sidebarContent}
      </aside>

      {/* Mobile drawer overlay - higher z-index than content but below drawer */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile drawer - highest z-index, full height, no content cutoff */}
      <motion.aside
        initial={{ x: "-100%" }}
        animate={{ x: mobileOpen ? 0 : "-100%" }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="fixed left-0 top-0 h-dvh w-[85vw] max-w-[320px] bg-sidebar border-r border-sidebar-border flex flex-col z-50 md:hidden shadow-2xl overflow-y-auto"
      >
        {sidebarContent}
      </motion.aside>

      {/* Mobile header with hamburger — fixed on top, larger tap targets */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-40 bg-sidebar/95 backdrop-blur-sm border-b border-sidebar-border flex items-center justify-between px-4 h-14">
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="p-3 rounded-xl hover:bg-sidebar-accent transition-colors min-w-[44px] min-h-[44px] flex items-center justify-center"
          aria-label="Toggle menu"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <div className="text-sm font-semibold text-sidebar-foreground" translate="no">{brand.name}</div>
        <div className="w-11" />
      </div>
    </>
  )
}
