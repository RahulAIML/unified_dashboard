"use client"

import { useState, useEffect, useCallback } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import { motion } from "framer-motion"
import {
  LayoutDashboard, BookOpen, BrainCircuit, Gamepad2,
  BadgeCheck, Database, Sun, Moon, Settings, LogOut
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useTheme } from "./ThemeProvider"
import { useT } from "@/lib/lang-store"
import { useClientBrand } from "@/lib/hooks/useClientBrand"
import { useAuthContext } from "./AuthProvider"

function LogoImage() {
  const brand = useClientBrand()
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <div className="shrink-0 w-32 h-12 rounded-xl border border-sidebar-border bg-sidebar-accent flex items-center justify-center px-2">
        <div className="w-10 h-10 rounded-lg flex items-center justify-center text-sidebar-primary-foreground font-extrabold text-lg bg-sidebar-primary">
          {brand.name.charAt(0)}
        </div>
      </div>
    )
  }

  return (
    <div className="shrink-0 w-32 h-12 rounded-xl border border-sidebar-border bg-sidebar-accent flex items-center justify-center px-2 overflow-hidden">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={brand.logo}
        alt={brand.logoAlt}
        className="max-h-10 max-w-[120px] object-contain"
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
  const { clearAuth } = useAuthContext()
  const [mobileOpen, setMobileOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

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

  const nav = [
    { href: "/",              label: t.navOverview,      icon: LayoutDashboard },
    { href: "/lms",           label: t.navLms,           icon: BookOpen        },
    { href: "/coach",         label: t.navCoach,         icon: BrainCircuit    },
    { href: "/simulator",     label: t.navSimulator,     icon: Gamepad2        },
    { href: "/certification", label: t.navCertification, icon: BadgeCheck      },
    { href: "/second-brain",  label: t.navSecondBrain,   icon: Database        },
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
          <p className="text-sm font-extrabold tracking-tight leading-tight truncate text-sidebar-foreground">
            {brand.name}
          </p>
          <p className="text-[10px] text-sidebar-foreground/50 leading-tight">Analytics Dashboard</p>
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
      <aside className="hidden md:flex w-64 shrink-0 bg-sidebar border-r border-sidebar-border flex-col">
        {sidebarContent}
      </aside>

      {/* Mobile drawer overlay */}
      {mobileOpen && (
        <div
          className="fixed inset-0 bg-black/50 z-[45] md:hidden"
          onClick={() => setMobileOpen(false)}
        />
      )}

      {/* Mobile drawer */}
      <motion.aside
        initial={false}
        animate={{ x: mobileOpen ? 0 : -256 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
        className="fixed left-0 top-0 bottom-0 w-64 bg-sidebar border-r border-sidebar-border flex flex-col z-[50] md:hidden"
      >
        {sidebarContent}
      </motion.aside>

      {/* Mobile header with hamburger — always on top (z-[60]) */}
      <div className="md:hidden fixed top-0 left-0 right-0 z-[60] bg-sidebar border-b border-sidebar-border flex items-center justify-between px-4 h-16">
        <button
          onClick={() => setMobileOpen(!mobileOpen)}
          className="p-2 rounded-lg hover:bg-sidebar-accent transition-colors"
          aria-label="Toggle menu"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        <div className="text-sm font-semibold text-sidebar-foreground">{brand.name}</div>
        <div className="w-5" /> {/* Spacer for alignment */}
      </div>
    </>
  )
}
