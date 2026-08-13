"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Info } from "lucide-react"
import { cn } from "@/lib/utils"

interface Props {
  /** Plain-language definition + formula, e.g. "% of sessions scoring 70 or
   *  above. Formula: passed sessions / sessions with a result x 100." */
  definition: string
  className?: string
}

const POPOVER_WIDTH = 240
const VIEWPORT_MARGIN = 8

/**
 * The "eye button" every KPI tile gets: a small info affordance that shows
 * its definition/formula on hover or click.
 *
 * The popover renders through a portal at coordinates read from the
 * button's own bounding box, NOT as a normal absolutely-positioned child --
 * every KPI card clips its own content (`overflow-hidden`, for the rounded
 * corners), so a popover nested inside one gets visually cut off/corrupted
 * the moment it's taller than the sliver of card left below the icon.
 *
 * Hover handlers are only attached when the device actually reports hover
 * support. Wiring them unconditionally caused a real bug on touch: a tap
 * fires a synthetic mouseenter (opens) immediately followed by the click
 * handler's toggle (closes), so the popover flashed open and vanished
 * instead of opening.
 */
function detectHoverSupport(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false
  try {
    return window.matchMedia("(hover: hover) and (pointer: fine)").matches
  } catch {
    return false // matchMedia unavailable in this environment -- click-only is still fully functional.
  }
}

export function KpiInfoButton({ definition, className }: Props) {
  const [open, setOpen] = useState(false)
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)
  // Lazy initializer, not an effect: this never needs to match server-rendered
  // markup (it only gates which event handlers get attached, which isn't part
  // of SSR output), so there's nothing to synchronize -- just a one-time read.
  const [supportsHover] = useState(detectHoverSupport)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const reposition = () => {
      const rect = buttonRef.current?.getBoundingClientRect()
      if (!rect) return
      const left = Math.min(
        Math.max(rect.right - POPOVER_WIDTH, VIEWPORT_MARGIN),
        window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN,
      )
      setCoords({ top: rect.bottom + 6, left })
    }
    reposition()

    function onOutside(e: MouseEvent) {
      const target = e.target as Node
      if (buttonRef.current?.contains(target) || popoverRef.current?.contains(target)) return
      setOpen(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false)
    }

    document.addEventListener("mousedown", onOutside)
    document.addEventListener("keydown", onKey)
    window.addEventListener("resize", reposition)
    window.addEventListener("scroll", reposition, true)
    return () => {
      document.removeEventListener("mousedown", onOutside)
      document.removeEventListener("keydown", onKey)
      window.removeEventListener("resize", reposition)
      window.removeEventListener("scroll", reposition, true)
    }
  }, [open])

  return (
    <span className={cn("relative inline-flex shrink-0", className)}>
      <button
        ref={buttonRef}
        type="button"
        aria-label="What does this metric mean?"
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        onMouseEnter={supportsHover ? () => setOpen(true) : undefined}
        onMouseLeave={supportsHover ? () => setOpen(false) : undefined}
        className="text-muted-foreground/70 hover:text-foreground transition-colors"
      >
        <Info className="w-3.5 h-3.5" />
      </button>
      {open && coords && typeof document !== "undefined" && createPortal(
        <div
          ref={popoverRef}
          role="tooltip"
          style={{ position: "fixed", top: coords.top, left: coords.left, width: POPOVER_WIDTH }}
          className="z-50 rounded-lg border border-border bg-popover px-3 py-2.5 text-left text-xs leading-relaxed text-popover-foreground shadow-lg"
        >
          {definition}
        </div>,
        document.body,
      )}
    </span>
  )
}
