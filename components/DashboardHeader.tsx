"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import { Calendar, Filter } from "lucide-react"
import { useDashboardStore } from "@/lib/store"
import { useLangStore, useT } from "@/lib/lang-store"
import { cn } from "@/lib/utils"
import type { Module } from "@/lib/types"

const MODULES: { id: Module; label: string; color: string }[] = [
  { id: "lms",           label: "LMS",           color: "bg-blue-500"   },
  { id: "coach",         label: "Coach",         color: "bg-violet-500" },
  { id: "simulator",     label: "Simulator",     color: "bg-emerald-500"},
  { id: "certification", label: "Certification", color: "bg-amber-500"  },
  { id: "second-brain",  label: "Second Brain",  color: "bg-pink-500"   },
]

const DATE_PRESETS = [
  { label: "7d",  days: 7   },
  { label: "30d", days: 30  },
  { label: "90d", days: 90  },
]

interface Props {
  title: string
  subtitle?: string
  showModuleFilter?: boolean
}

export function DashboardHeader({ title, subtitle, showModuleFilter = false }: Props) {
  const { selectedModules, toggleModule, dateRange, setDateRange } = useDashboardStore()
  const { lang, toggle: toggleLang } = useLangStore()
  const t = useT()
  const [activeDays, setActiveDays] = useState(30)

  function applyPreset(days: number) {
    setActiveDays(days)
    const to   = new Date()
    const from = new Date()
    from.setDate(from.getDate() - days)
    setDateRange({ from, to })
  }

  return (
    <div className="border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-10">
      <div className="px-6 py-4">
        {/* Title row */}
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
            {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>

          {/* Controls row */}
          <div className="flex items-center gap-2">
            {/* EN / ES toggle */}
            <button
              onClick={toggleLang}
              className="px-2.5 py-1 rounded-lg text-xs font-semibold border border-border bg-muted hover:bg-muted/70 transition-colors tabular-nums"
              aria-label="Toggle language"
            >
              {lang === 'en' ? 'ES' : 'EN'}
            </button>

          {/* Date presets */}
          <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
            <Calendar className="w-3.5 h-3.5 text-muted-foreground ml-1" />
            {DATE_PRESETS.map(({ label, days }) => (
              <button
                key={days}
                onClick={() => applyPreset(days)}
                className={cn(
                  "px-3 py-1 rounded-md text-xs font-medium transition-colors",
                  activeDays === days
                    ? "bg-background shadow-sm text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>
          </div>
        </div>

        {/* Module filter */}
        {showModuleFilter && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Filter className="w-3 h-3" /> {t.filterSolutions}
            </span>
            {MODULES.map(({ id, label, color }) => {
              const active = selectedModules.includes(id)
              return (
                <motion.button
                  key={id}
                  onClick={() => toggleModule(id)}
                  whileTap={{ scale: 0.95 }}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors",
                    active
                      ? "border-transparent bg-foreground/10 text-foreground"
                      : "border-border text-muted-foreground hover:border-foreground/30"
                  )}
                >
                  <span className={cn("w-1.5 h-1.5 rounded-full", active ? color : "bg-muted-foreground/30")} />
                  {label}
                </motion.button>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
