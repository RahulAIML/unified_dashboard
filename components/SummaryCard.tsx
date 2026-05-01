"use client"

import { motion } from "framer-motion"
import { TrendingUp, TrendingDown, Minus } from "lucide-react"
import { cn, deltaColor } from "@/lib/utils"
import type { KpiCard } from "@/lib/types"
import { useT } from "@/lib/lang-store"

interface Props {
  kpi: KpiCard
  index?: number
  icon?: React.ReactNode
}

export function SummaryCard({ kpi, index = 0, icon }: Props) {
  const t = useT()
  const { labelKey, label, value, delta, unit } = kpi
  const displayLabel = t[labelKey] ?? label
  const isPositive = delta > 0
  const isNegative = delta < 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.3, ease: "easeOut" }}
      whileHover={{ y: -2, transition: { duration: 0.15 } }}
      className="relative w-full overflow-hidden rounded-xl border border-border bg-card shadow-sm hover:shadow-md transition-shadow"
    >
      {/* Gradient top stripe — brand primary → accent */}
      <div
        className="h-[3px] w-full"
        style={{ background: "linear-gradient(90deg, hsl(var(--primary)), hsl(var(--accent)))" }}
      />

      <div className="p-5">
        {/* Label row */}
        <div className="flex items-start justify-between gap-2 mb-4">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.07em] leading-none mt-0.5 select-none">
            {displayLabel}
          </span>
          {icon && (
            <div className="w-7 h-7 shrink-0 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
              {icon}
            </div>
          )}
        </div>

        {/* KPI value — 30px, bold, tabular-nums */}
        <div className="flex items-end gap-1.5 mb-2.5">
          <span className="kpi-value text-[30px] leading-none font-bold text-foreground">
            {typeof value === "number" ? value.toLocaleString() : value}
          </span>
          {unit && (
            <span className="text-sm font-medium text-muted-foreground mb-0.5">{unit}</span>
          )}
        </div>

        {/* Delta + comparison label */}
        <div className="flex items-center gap-1.5">
          {delta !== 0 ? (
            <span className={cn("inline-flex items-center gap-0.5 text-[11px] font-semibold leading-none", deltaColor(delta))}>
              {isPositive  && <TrendingUp   className="w-3 h-3 shrink-0" />}
              {isNegative  && <TrendingDown  className="w-3 h-3 shrink-0" />}
              {!isPositive && !isNegative && <Minus className="w-3 h-3 shrink-0" />}
              {isPositive ? "+" : ""}{delta}%
            </span>
          ) : (
            <span className="inline-flex items-center gap-0.5 text-[11px] font-medium text-muted-foreground leading-none">
              <Minus className="w-3 h-3 shrink-0" />
              0%
            </span>
          )}
          <span className="text-[11px] text-muted-foreground/70 leading-none">{t.vsPrior}</span>
        </div>
      </div>
    </motion.div>
  )
}
