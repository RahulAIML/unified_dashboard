"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { motion } from "framer-motion"
import {
  LayoutDashboard, BookOpen, BrainCircuit, Gamepad2,
  BadgeCheck, Database, Sun, Moon, ChevronRight
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useTheme } from "./ThemeProvider"
import { useT } from "@/lib/lang-store"
import { ThemeSwitcher } from "@/components/theme-switcher"

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
  ]

  return (
    <aside className="w-64 shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col">
      {/* Logo */}
      <div className="h-16 flex items-center px-6 border-b border-sidebar-border">
        <span className="text-xl font-bold tracking-tight bg-gradient-to-r from-blue-500 to-violet-500 bg-clip-text text-transparent">
          RolplayPro
        </span>
        <span className="ml-2 text-xs text-muted-foreground font-medium">Analytics</span>
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
                    ? "bg-primary/10 text-primary"
                    : "text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground"
                )}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span>{label}</span>
                {active && <ChevronRight className="w-3 h-3 ml-auto opacity-60" />}
              </motion.div>
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="px-4 py-4 border-t border-sidebar-border space-y-3">
        <ThemeSwitcher />
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
