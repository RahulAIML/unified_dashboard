"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { motion } from "framer-motion"
import {
  LayoutDashboard, BookOpen, BrainCircuit, Gamepad2,
  BadgeCheck, Database, Sun, Moon, ChevronRight, Settings
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useTheme } from "./ThemeProvider"
import { useT } from "@/lib/lang-store"
import { brand } from "@/lib/brand"

export function Sidebar() {
  const pathname = usePathname()
  const { theme, toggle } = useTheme()
  const t = useT()

  const nav = [
    { href: "/",               label: t.navOverview,        icon: LayoutDashboard },
    { href: "/lms",            label: t.navLms,             icon: BookOpen        },
    { href: "/coach",          label: t.navCoach,           icon: BrainCircuit    },
    { href: "/simulator",      label: t.navSimulator,       icon: Gamepad2        },
    { href: "/certification",  label: t.navCertification,   icon: BadgeCheck      },
    { href: "/second-brain",   label: t.navSecondBrain,     icon: Database        },
    { href: "/settings",       label: t.navSettings,        icon: Settings        },
  ]

  return (
    <aside className="w-64 shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col">

      {/* Brand header — yellow accent bar on top */}
      <div className="relative h-20 flex items-center gap-3 px-5 border-b border-sidebar-border overflow-hidden">
        {/* Coppel yellow top stripe */}
        <div className="absolute top-0 left-0 right-0 h-[3px]" style={{ background: brand.accentColor }} />

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={brand.logo}
          alt={brand.logoAlt}
          width={52}
          height={52}
          className="rounded-lg object-contain shrink-0 shadow-sm"
          style={{ border: `2px solid ${brand.accentColor}` }}
        />
        <div className="min-w-0">
          {/* "Coppel" in blue, "Analytics" in yellow */}
          <p className="text-sm font-extrabold tracking-tight leading-tight truncate">
            <span style={{ color: brand.primaryColor }}>Coppel </span>
            <span style={{ color: brand.accentColor }}>Analytics</span>
          </p>
          <p className="text-[10px] text-muted-foreground/60 leading-tight">Analytics Dashboard</p>
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
                    ? "text-white"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                )}
                style={active ? { background: brand.primaryColor } : {}}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{label}</span>
                {active && (
                  <span
                    className="ml-auto w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: brand.accentColor }}
                  />
                )}
              </motion.div>
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-sidebar-border">
        <button
          onClick={toggle}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
        >
          {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          {theme === "dark" ? t.lightMode : t.darkMode}
        </button>
        <p className="text-xs text-muted-foreground/50 mt-2 px-3">{t.phaseLabel}</p>
      </div>
    </aside>
  )
}
