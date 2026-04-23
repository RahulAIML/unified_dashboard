"use client"

import { useEffect, useState } from "react"
import { motion } from "framer-motion"
import { Calendar, Filter } from "lucide-react"
import { useDashboardStore } from "@/lib/store"
import { useLangStore, useT } from "@/lib/lang-store"
import { useClientBrand } from "@/lib/hooks/useClientBrand"
import { DateRangePicker } from "@/components/DateRangePicker"
import { cn } from "@/lib/utils"
import type { Module } from "@/lib/types"

const MODULES: { id: Module; label: string }[] = [
  { id: "lms",           label: "LMS"          },
  { id: "coach",         label: "Coach"        },
  { id: "simulator",     label: "Simulator"    },
  { id: "certification", label: "Certification"},
  { id: "second-brain",  label: "Second Brain" },
]

const DATE_PRESETS = [
  { label: "7d",  days: 7  },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
]

interface Props {
  title:             string
  subtitle?:         string
  showModuleFilter?: boolean
}

export function DashboardHeader({ title, subtitle, showModuleFilter = false }: Props) {
  const { selectedSolution, setSolution, setDateRange, setClientId } = useDashboardStore()
  const { lang, toggle: toggleLang } = useLangStore()
  const t     = useT()
  const brand = useClientBrand()

  // "custom" means the DateRangePicker was last used — no preset is active
  const [activeDays, setActiveDays] = useState<number | "custom">(30)

  // ── Read ?client= from URL on mount and sync to store ──────────────────────
  useEffect(() => {
    if (typeof window === "undefined") return
    const params   = new URLSearchParams(window.location.search)
    const clientId = params.get("client")
    if (clientId) setClientId(clientId)
  }, [setClientId])

  function applyPreset(days: number) {
    setActiveDays(days)
    const to   = new Date()
    const from = new Date()
    from.setDate(from.getDate() - days)
    setDateRange({ from, to })
  }

  function applyCustomRange(from: Date, to: Date) {
    setActiveDays("custom")
    setDateRange({ from, to })
  }

  return (
    <div className="border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-10">
      {/* Brand gradient accent bar */}
      <div
        className="h-[3px] w-full"
        style={{ background: `linear-gradient(90deg, ${brand.primaryColor}, ${brand.accentColor})` }}
      />

      <div className="px-6 py-4">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight" style={{ color: brand.primaryColor }}>
              {title}
            </h1>
            {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>

          <div className="flex items-center gap-2">
            {/* EN / ES toggle */}
            <button
              onClick={toggleLang}
              className="px-2.5 py-1 rounded-lg text-xs font-semibold border border-border bg-muted hover:bg-muted/70 transition-colors tabular-nums"
              aria-label="Toggle language"
            >
              {lang === "en" ? "ES" : "EN"}
            </button>

            {/* Date presets + custom range */}
            <div className="flex items-center gap-1 bg-muted rounded-lg p-1">
              <Calendar className="w-3.5 h-3.5 text-muted-foreground ml-1" />

              {DATE_PRESETS.map(({ label, days }) => (
                <button
                  key={days}
                  onClick={() => applyPreset(days)}
                  className={cn(
                    "px-3 py-1 rounded-md text-xs font-semibold transition-all",
                    activeDays !== days && "text-muted-foreground hover:text-foreground"
                  )}
                  style={
                    activeDays === days
                      ? { background: brand.primaryColor, color: "#fff" }
                      : {}
                  }
                >
                  {label}
                </button>
              ))}

              {/* Custom date range picker */}
              <DateRangePicker onApply={applyCustomRange} />
            </div>
          </div>
        </div>

        {/* Solution filter — single-select */}
        {showModuleFilter && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1">
              <Filter className="w-3 h-3" /> {t.filterSolutions}
            </span>

            {/* "All" pill */}
            <motion.button
              onClick={() => setSolution(null)}
              whileTap={{ scale: 0.95 }}
              className={cn(
                "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-all",
                !selectedSolution
                  ? "text-white border-transparent"
                  : "border-border text-muted-foreground hover:border-foreground/30"
              )}
              style={!selectedSolution ? { background: brand.primaryColor } : {}}
            >
              <span
                className="w-1.5 h-1.5 rounded-full shrink-0"
                style={{ background: !selectedSolution ? brand.accentColor : "#9ca3af" }}
              />
              {t.filterAll}
            </motion.button>

            {MODULES.map(({ id, label }) => {
              const active = selectedSolution === id
              return (
                <motion.button
                  key={id}
                  onClick={() => setSolution(id)}
                  whileTap={{ scale: 0.95 }}
                  className={cn(
                    "flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-all",
                    !active && "border-border text-muted-foreground hover:border-foreground/30"
                  )}
                  style={
                    active
                      ? { background: brand.primaryColor, color: "#fff", borderColor: "transparent" }
                      : {}
                  }
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ background: active ? brand.accentColor : "#9ca3af" }}
                  />
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
