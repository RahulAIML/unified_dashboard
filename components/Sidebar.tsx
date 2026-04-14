"use client"

import Image from "next/image"
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

      {/* Brand logo */}
      <div className="h-16 flex items-center gap-3 px-5 border-b border-sidebar-border">
        <div className="relative h-10 w-10 shrink-0 rounded-md overflow-hidden bg-muted">
          <Image
            src={brand.logo}
            alt={brand.logoAlt}
            fill
            sizes="40px"
            className="object-contain"
            priority
          />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-bold tracking-tight leading-tight truncate text-sidebar-foreground">
            {brand.appName}
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
