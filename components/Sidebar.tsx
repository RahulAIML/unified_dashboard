"use client"

import { useState } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { motion } from "framer-motion"
import {
  LayoutDashboard, BookOpen, BrainCircuit, Gamepad2,
  BadgeCheck, Database, Sun, Moon, Settings
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useTheme } from "./ThemeProvider"
import { useT } from "@/lib/lang-store"
import { useClientBrand } from "@/lib/hooks/useClientBrand"

function LogoImage() {
  const brand = useClientBrand()
  const [failed, setFailed] = useState(false)

  if (failed) {
    return (
      <div
        className="w-10 h-10 rounded-lg flex items-center justify-center text-sidebar-primary-foreground font-extrabold text-lg shrink-0 bg-sidebar-primary"
      >
        {brand.name.charAt(0)}
      </div>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={brand.logo}
      alt={brand.logoAlt}
      width={40}
      height={40}
      className="rounded-lg object-contain shrink-0"
      onError={() => setFailed(true)}
    />
  )
}

export function Sidebar() {
  const pathname = usePathname()
  const { theme, toggle } = useTheme()
  const t     = useT()
  const brand = useClientBrand()

  const nav = [
    { href: "/",              label: t.navOverview,      icon: LayoutDashboard },
    { href: "/lms",           label: t.navLms,           icon: BookOpen        },
    { href: "/coach",         label: t.navCoach,         icon: BrainCircuit    },
    { href: "/simulator",     label: t.navSimulator,     icon: Gamepad2        },
    { href: "/certification", label: t.navCertification, icon: BadgeCheck      },
    { href: "/second-brain",  label: t.navSecondBrain,   icon: Database        },
    { href: "/settings",      label: t.navSettings,      icon: Settings        },
  ]

  return (
    <aside className="w-64 shrink-0 bg-sidebar border-r border-sidebar-border flex flex-col">

      {/* Brand header */}
      <div className="relative h-20 flex items-center gap-3 px-5 border-b border-sidebar-border overflow-hidden">
        {/* Brand top gradient stripe — matches drilldown/header stripe */}
        <div
          className="absolute top-0 left-0 right-0 h-[3px]"
          style={{ background: `linear-gradient(90deg, hsl(var(--primary)), var(--brand-accent, hsl(var(--primary))))` }}
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
      <div className="px-4 py-4 border-t border-sidebar-border">
        <button
          onClick={toggle}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors"
        >
          {theme === "dark" ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          {theme === "dark" ? t.lightMode : t.darkMode}
        </button>
        <p className="text-xs text-sidebar-foreground/30 mt-2 px-3">{t.phaseLabel}</p>
      </div>
    </aside>
  )
}
