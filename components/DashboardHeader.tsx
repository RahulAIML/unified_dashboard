"use client"

import { useEffect, useRef, useState } from "react"
import { motion } from "framer-motion"
import { Calendar, Filter, RefreshCw } from "lucide-react"
import { useDashboardStore } from "@/lib/store"
import { useLangStore, useT } from "@/lib/lang-store"
import { useClientBrand } from "@/lib/hooks/useClientBrand"
import { DateRangePicker } from "@/components/DateRangePicker"
import { cn } from "@/lib/utils"
import type { Module } from "@/lib/types"

const MODULES: { id: Module; label: string }[] = [
  { id: "lms", label: "LMS" },
  { id: "coach", label: "Coach" },
  { id: "simulator", label: "Simulator" },
  { id: "certification", label: "Certification" },
  { id: "second-brain", label: "Second Brain" },
]

const DATE_PRESETS = [
  { label: "7d", days: 7 },
  { label: "30d", days: 30 },
  { label: "90d", days: 90 },
]

interface Props {
  title: string
  subtitle?: string
  showModuleFilter?: boolean
}

export function DashboardHeader({ title, subtitle, showModuleFilter = false }: Props) {
  const { dateRange, selectedSolution, setSolution, setSolutionDirect, setDateRange, triggerRefresh } = useDashboardStore()
  const { lang, toggle: toggleLang } = useLangStore()
  const t = useT()
  const brand = useClientBrand()

  const [activeDays, setActiveDays] = useState<number | "custom">(30)
  const [refreshing, setRefreshing] = useState(false)
  const syncingFromUrl = useRef(false)

  useEffect(() => {
    if (typeof window === "undefined") return

    function applyFromUrl() {
      syncingFromUrl.current = true
      const params = new URLSearchParams(window.location.search)

      const rawFrom = params.get("from")
      const rawTo = params.get("to")
      const from = new Date(rawFrom ?? "")
      const to = new Date(rawTo ?? "")
      if (!Number.isNaN(from.getTime()) && !Number.isNaN(to.getTime()) && from <= to) {
        setDateRange({ from, to })
        const spanDays = Math.round((to.getTime() - from.getTime()) / 86_400_000)
        if (DATE_PRESETS.some((preset) => preset.days === spanDays)) setActiveDays(spanDays)
        else setActiveDays("custom")
      }

      if (params.has("solution")) {
        const solution = params.get("solution")
        const valid = MODULES.some((module) => module.id === solution)
        setSolutionDirect(valid ? (solution as Module) : null)
      }

      syncingFromUrl.current = false
    }

    applyFromUrl()
    window.addEventListener("popstate", applyFromUrl)
    return () => window.removeEventListener("popstate", applyFromUrl)
  }, [setDateRange, setSolutionDirect])

  const fromIso = dateRange.from.toISOString()
  const toIso = dateRange.to.toISOString()

  useEffect(() => {
    if (typeof window === "undefined" || syncingFromUrl.current) return

    const params = new URLSearchParams(window.location.search)
    params.set("from", fromIso)
    params.set("to", toIso)

    if (selectedSolution) params.set("solution", selectedSolution)
    else params.delete("solution")

    const qs = params.toString()
    const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname
    window.history.replaceState(null, "", next)
  }, [fromIso, toIso, selectedSolution])

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      document.title = brand.name
    }, 300)
    return () => clearTimeout(timeoutId)
  }, [brand.name])

  function applyPreset(days: number) {
    setActiveDays(days)
    const to = new Date()
    const from = new Date()
    from.setDate(from.getDate() - days)
    setDateRange({ from, to })
  }

  function applyCustomRange(from: Date, to: Date) {
    setActiveDays("custom")
    setDateRange({ from, to })
  }

  function handleRefresh() {
    if (refreshing) return
    setRefreshing(true)
    triggerRefresh()
    setTimeout(() => setRefreshing(false), 650)
  }

  return (
    <div className="border-b border-border bg-background/80 backdrop-blur-sm sticky top-0 z-[20]">
      <div className="h-[3px] w-full" style={{ background: "linear-gradient(90deg, hsl(var(--primary)), var(--brand-accent))" }} />

      <div className="px-6 py-4">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 mb-4">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-primary">{title}</h1>
            {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>

          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2 w-full md:w-auto">
            <button
              onClick={toggleLang}
              className="px-2.5 py-1 rounded-lg text-xs font-semibold border border-border bg-muted hover:bg-muted/70 transition-colors tabular-nums"
              aria-label="Toggle language"
            >
              {lang === "en" ? "ES" : "EN"}
            </button>

            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className={cn(
                "px-2.5 py-1 rounded-lg text-xs font-semibold border border-border bg-muted hover:bg-muted/70 transition-colors",
                "inline-flex items-center gap-1.5",
                refreshing && "opacity-70 cursor-not-allowed"
              )}
              aria-label="Refresh data"
              title={t.refresh}
            >
              <RefreshCw className={cn("w-3.5 h-3.5", refreshing && "animate-spin")} />
              {t.refresh}
            </button>

            <div className="flex flex-wrap items-center gap-1 bg-muted rounded-lg p-1 w-full sm:w-auto">
              <Calendar className="w-3.5 h-3.5 text-muted-foreground ml-1 hidden sm:block" />

              {DATE_PRESETS.map(({ label, days }) => (
                <button
                  key={days}
                  onClick={() => applyPreset(days)}
                  className={cn(
                    "px-2 sm:px-3 py-1 rounded-md text-xs font-semibold transition-all",
                    activeDays === days ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {label}
                </button>
              ))}

              <DateRangePicker
                key={`${dateRange.from.getTime()}-${dateRange.to.getTime()}`}
                onApply={applyCustomRange}
                initialFrom={dateRange.from}
                initialTo={dateRange.to}
              />
            </div>
          </div>
        </div>

        {showModuleFilter && (
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs font-medium text-muted-foreground flex items-center gap-1 w-full">
              <Filter className="w-3 h-3" /> {t.filterSolutions}
            </span>

            <motion.button
              onClick={() => setSolution(null)}
              whileTap={{ scale: 0.95 }}
              className={cn(
                "flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-full text-xs font-semibold border transition-all",
                !selectedSolution ? "bg-primary text-primary-foreground border-transparent" : "border-border text-muted-foreground hover:border-foreground/30"
              )}
            >
              <span
                className={cn(
                  "w-1.5 h-1.5 rounded-full shrink-0",
                  !selectedSolution && "bg-[var(--brand-accent)]",
                  selectedSolution && "bg-muted-foreground/40"
                )}
                style={!selectedSolution ? { background: "var(--brand-accent)" } : {}}
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
                    "flex items-center gap-1.5 px-2 sm:px-2.5 py-1 rounded-full text-xs font-semibold border transition-all",
                    active ? "bg-primary text-primary-foreground border-transparent" : "border-border text-muted-foreground hover:border-foreground/30"
                  )}
                >
                  <span
                    className={cn(
                      "w-1.5 h-1.5 rounded-full shrink-0",
                      active && "bg-[var(--brand-accent)]",
                      !active && "bg-muted-foreground/40"
                    )}
                    style={active ? { background: "var(--brand-accent)" } : {}}
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
