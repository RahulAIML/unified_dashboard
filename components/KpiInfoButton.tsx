"use client"

import { useEffect, useRef, useState } from "react"
import { Info } from "lucide-react"
import { cn } from "@/lib/utils"

interface Props {
  /** Plain-language definition + formula, e.g. "% of sessions scoring 70 or
   *  above. Formula: passed sessions / sessions with a result x 100." */
  definition: string
  className?: string
}

/**
 * The "eye button" every KPI tile gets: a small info affordance that shows
 * its definition/formula on hover or click. Click-to-toggle (not just
 * hover) so it also works on touch devices, and closes on an outside click
 * or Escape so it never lingers over other content.
 */
export function KpiInfoButton({ definition, className }: Props) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onOutside)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onOutside)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  return (
    <div ref={ref} className={cn("relative inline-flex shrink-0", className)}>
      <button
        type="button"
        aria-label="What does this metric mean?"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        className="text-muted-foreground/70 hover:text-foreground transition-colors"
      >
        <Info className="w-3.5 h-3.5" />
      </button>
      {open && (
        <div
          role="tooltip"
          className="absolute z-50 top-full right-0 mt-2 w-60 rounded-lg border border-border bg-popover px-3 py-2.5 text-left text-xs leading-relaxed text-popover-foreground shadow-lg"
        >
          {definition}
        </div>
      )}
    </div>
  )
}
