"use client"

import { motion } from "framer-motion"
import { TrendingUp, TrendingDown, Minus } from "lucide-react"
import { cn } from "@/lib/utils"

interface CardProps {
  title: string
  description: string
  formula: string
  footer: string
  icon?: React.ReactNode
  className?: string
  children: React.ReactNode
}

/**
 * Card anatomy for the Cesar KPI spec (Sugerencia de KPI's Cesar.xlsx):
 * title, description, formula, a body (big number or chart/list), and the
 * spec's own "Interpretation and Management Value" sentence as a footer.
 */
export function CesarKpiCard({ title, description, formula, footer, icon, className, children }: CardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
      whileHover={{ y: -3, transition: { duration: 0.2 } }}
      className={cn(
        "relative w-full overflow-hidden rounded-[16px] border border-border/50 bg-card flex flex-col",
        "shadow-[0_1px_3px_rgba(0,0,0,0.05),0_1px_2px_rgba(0,0,0,0.02)]",
        "hover:shadow-[0_12px_20px_-5px_rgba(0,0,0,0.08),0_4px_8px_-4px_rgba(0,0,0,0.05)]",
        "transition-all duration-300 ease-out",
        className,
      )}
    >
      <div
        className="h-[3px] w-full shrink-0"
        style={{ background: "linear-gradient(90deg, hsl(var(--primary)), hsl(var(--accent)))" }}
      />

      <div className="p-5 sm:p-6 flex flex-col flex-1">
        <div className="flex items-center gap-2 mb-1.5">
          {icon && (
            <div
              className="w-7 h-7 rounded-lg flex items-center justify-center text-primary shrink-0"
              style={{ background: "linear-gradient(135deg, hsl(var(--primary)/0.12), hsl(var(--accent)/0.08))" }}
            >
              {icon}
            </div>
          )}
          <h3 className="text-sm font-semibold text-foreground leading-tight">{title}</h3>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed mb-1.5">{description}</p>
        <p className="text-[11px] font-mono text-muted-foreground/70 leading-relaxed mb-4 break-words">{formula}</p>

        <div className="flex-1">{children}</div>

        <p className="text-xs text-muted-foreground/90 italic leading-relaxed border-t border-border/50 pt-3 mt-4">
          {footer}
        </p>
      </div>
    </motion.div>
  )
}

interface ValueProps {
  value: number | null
  unit?: string
  /** Same-shape value from the equal-length window immediately before this
   *  period. Omit (or pass null) when there's nothing to compare against. */
  prevValue?: number | null
  /** Whether a bigger number is the good direction, for delta coloring and
   *  goal-met logic. Default true (holds for every scalar KPI on this page). */
  higherIsBetter?: boolean
  /** Only set for KPIs with a real, spec-sourced target -- currently just
   *  Activation Rate's 80% (see Sugerencia de KPI's Cesar.xlsx, KPI-1.1).
   *  Never fabricate a goal for a KPI the spec doesn't define one for. */
  goal?: number
  goalLabel?: string
  onTrackLabel?: string
  belowGoalLabel?: string
  /** Label under the delta badge, e.g. "vs. previous period". */
  deltaLabel?: string
}

export function CesarKpiValue({
  value, unit = "%", prevValue, higherIsBetter = true,
  goal, goalLabel, onTrackLabel = "On track", belowGoalLabel = "Below goal", deltaLabel,
}: ValueProps) {
  const delta = value != null && prevValue != null ? Math.round((value - prevValue) * 10) / 10 : null
  const improved = delta != null && delta !== 0 && (higherIsBetter ? delta > 0 : delta < 0)
  const worsened = delta != null && delta !== 0 && !improved

  const goalMet = goal != null && value != null && (higherIsBetter ? value >= goal : value <= goal)
  const goalPct = goal != null && goal > 0 && value != null ? Math.min(100, Math.max(0, Math.round((value / goal) * 100))) : null

  return (
    <div className="space-y-3">
      <div className="flex items-baseline gap-2 flex-wrap">
        <span className="kpi-value text-[32px] sm:text-[36px] leading-none font-bold text-foreground tracking-tight">
          {value != null ? value.toLocaleString() : "—"}
        </span>
        {value != null && unit && <span className="text-sm font-medium text-muted-foreground">{unit}</span>}
        {delta != null && (
          <span
            className={cn(
              "inline-flex items-center gap-1 text-xs font-semibold rounded-full px-2 py-0.5",
              improved && "text-emerald-700 bg-emerald-500/10 dark:text-emerald-400",
              worsened && "text-rose-700 bg-rose-500/10 dark:text-rose-400",
              !improved && !worsened && "text-muted-foreground bg-muted",
            )}
          >
            {improved ? <TrendingUp className="w-3 h-3" /> : worsened ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
            {delta > 0 ? "+" : ""}{delta}{unit}
          </span>
        )}
      </div>

      {delta != null && deltaLabel && <p className="text-[11px] text-muted-foreground">{deltaLabel}</p>}

      {goal != null && value != null && (
        <div>
          <div className="flex items-center justify-between mb-1 gap-2">
            {goalLabel && <span className="text-[11px] text-muted-foreground">{goalLabel}</span>}
            <span
              className={cn(
                "text-[11px] font-semibold rounded-full px-1.5 py-0.5 shrink-0",
                goalMet ? "text-emerald-700 bg-emerald-500/10 dark:text-emerald-400" : "text-amber-700 bg-amber-500/10 dark:text-amber-400",
              )}
            >
              {goalMet ? onTrackLabel : belowGoalLabel}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={cn("h-full rounded-full", goalMet ? "bg-emerald-500" : "bg-amber-500")}
              style={{ width: `${goalPct ?? 0}%` }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
