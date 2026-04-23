"use client"

import { useState } from "react"
import { CalendarRange } from "lucide-react"
import { useClientBrand } from "@/lib/hooks/useClientBrand"
import { cn } from "@/lib/utils"

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
  const brand = useClientBrand()
  const [open,  setOpen]  = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Initialise from the currently-active range (falls back to last 30d → today)
  const today  = new Date().toISOString().slice(0, 10)
  const last30 = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)

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
            ? "text-white border-transparent"
            : "border-border text-muted-foreground hover:text-foreground bg-muted"
        )}
        style={open ? { background: brand.primaryColor } : {}}
        aria-label="Custom date range"
      >
        <CalendarRange className="w-3.5 h-3.5" />
        Custom
      </button>

      {/* Dropdown panel */}
      {open && (
        <div className="absolute right-0 top-full mt-2 z-50 bg-card border border-border rounded-xl shadow-lg p-4 w-72">
          <p className="text-xs font-semibold mb-3 text-foreground">
            Custom Date Range
          </p>

          <div className="space-y-3">
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
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
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
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => { setToStr(e.target.value); setError(null) }}
                className="w-full px-3 py-1.5 text-xs rounded-lg border border-border bg-background focus:outline-none focus:ring-1 focus:ring-primary"
              />
            </div>

            {/* Error */}
            {error && (
              <p className="text-[10px] text-rose-500">{error}</p>
            )}

            {/* Actions */}
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => { setOpen(false); setError(null) }}
                className="flex-1 px-3 py-1.5 text-xs rounded-lg border border-border bg-muted hover:bg-muted/70 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleApply}
                className="flex-1 px-3 py-1.5 text-xs rounded-lg text-white font-semibold transition-colors"
                style={{ background: brand.primaryColor }}
              >
                Apply
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
