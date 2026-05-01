"use client"

import { useState } from "react"
import { CalendarRange } from "lucide-react"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/lang-store"

const DEFAULT_TODAY = new Date()
const DEFAULT_TODAY_STR = DEFAULT_TODAY.toISOString().slice(0, 10)
const DEFAULT_LAST30_STR = new Date(DEFAULT_TODAY.getTime() - 30 * 86_400_000).toISOString().slice(0, 10)

interface Props {
  onApply:      (from: Date, to: Date) => void
  /** Seed the picker with the currently-active range so it stays in sync with presets */
  initialFrom?: Date
  initialTo?:   Date
  className?:   string
}

/**
 * Custom date range picker using native <input type="date"> elements.
 * Requires no third-party date library.
 *
 * Calls onApply(from, to) when the user clicks "Apply".
 * Validates that from ≤ to before calling onApply.
 */
export function DateRangePicker({ onApply, initialFrom, initialTo, className }: Props) {
  const t = useT()
  const [open,  setOpen]  = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Initialise from the currently-active range (falls back to last 30d → today)
  const today  = DEFAULT_TODAY_STR
  const last30 = DEFAULT_LAST30_STR

  const [fromStr, setFromStr] = useState(
    initialFrom ? initialFrom.toISOString().slice(0, 10) : last30
  )
  const [toStr,   setToStr]   = useState(
    initialTo ? initialTo.toISOString().slice(0, 10) : today
  )

  function handleApply() {
    setError(null)
    const from = new Date(fromStr)
    const to   = new Date(toStr)

    // Set to end of day so the day is fully included
    to.setHours(23, 59, 59, 999)

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      setError("Please select valid dates.")
      return
    }
    if (from > to) {
      setError("Start date must be before end date.")
      return
    }

    onApply(from, to)
    setOpen(false)
  }

  return (
    <div className={cn("relative", className)}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold border transition-all",
          open
            ? "bg-primary text-primary-foreground border-transparent"
            : "border-border text-muted-foreground hover:text-foreground bg-muted"
        )}
        aria-label="Custom date range"
      >
        <CalendarRange className="w-3.5 h-3.5" />
        {t.custom}
      </button>

      {/* Dropdown panel */}
      {open && (
        <div
          className={cn(
            // Mobile: fixed sheet to avoid expanding header / overlapping layout
            "fixed inset-x-3 top-20 z-[80] sm:absolute sm:inset-auto sm:top-full sm:mt-2 sm:z-[80]",
            "bg-card border border-border rounded-xl shadow-lg",
            "w-[min(28rem,calc(100vw-1.5rem))] sm:w-72 max-w-[calc(100vw-2rem)]",
            "left-0 sm:left-auto sm:right-0",
            "overflow-visible"
          )}
        >
          <p className="px-4 pt-4 text-xs font-semibold text-foreground">
            {t.custom}
          </p>

          <div className="space-y-3 p-4 max-h-[calc(100vh-12rem)] overflow-auto">
            {/* From */}
            <div>
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide block mb-1">
                From
              </label>
              <input
                type="date"
                value={fromStr}
                max={toStr}
                onChange={(e) => { setFromStr(e.target.value); setError(null) }}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* To */}
            <div>
              <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide block mb-1">
                To
              </label>
              <input
                type="date"
                value={toStr}
                min={fromStr}
                max={DEFAULT_TODAY_STR}
                onChange={(e) => { setToStr(e.target.value); setError(null) }}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-border bg-background text-foreground focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* Error */}
            {error && (
              <p className="text-[10px] text-destructive">{error}</p>
            )}

            {/* Actions */}
            <div className="sticky bottom-0 -mx-4 -mb-4 mt-4 bg-card p-4 border-t border-border z-[1]">
              <div className="flex gap-2">
                <button
                  onClick={() => { setOpen(false); setError(null) }}
                  className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-border bg-muted hover:bg-muted/70 transition-colors"
                >
                  {t.cancel}
                </button>
                <button
                  onClick={handleApply}
                  className="flex-1 px-3 py-1.5 text-xs rounded-lg bg-primary text-primary-foreground font-semibold transition-colors hover:bg-primary/90"
                >
                  {t.apply}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
