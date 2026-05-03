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
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05, duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
      whileHover={{ y: -3, transition: { duration: 0.2 } }}
      className="relative w-full overflow-hidden rounded-[16px] border border-border/50 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.05),0_1px_2px_rgba(0,0,0,0.02)] hover:shadow-[0_12px_20px_-5px_rgba(0,0,0,0.08),0_4px_8px_-4px_rgba(0,0,0,0.05)] transition-all duration-300 ease-out"
    >
      {/* Gradient top stripe — brand primary → accent */}
      <div
        className="h-[3px] w-full"
        style={{ background: "linear-gradient(90deg, hsl(var(--primary)), hsl(var(--accent)))" }}
      />

      <div className="p-5 sm:p-6">
        {/* Label row */}
        <div className="flex items-center justify-between gap-3 mb-4">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider leading-none select-none">
            {displayLabel}
          </span>
          {icon && (
            <div 
              className="w-9 h-9 shrink-0 rounded-xl flex items-center justify-center text-primary"
              style={{ 
                background: "linear-gradient(135deg, hsl(var(--primary)/0.12), hsl(var(--accent)/0.08))",
              }}
            >
              {icon}
            </div>
          )}
        </div>

        {/* KPI value — larger, bold, tabular-nums */}
        <div className="flex items-baseline gap-2 mb-3">
          <span className="kpi-value text-[32px] sm:text-[36px] leading-none font-bold text-foreground tracking-tight">
            {typeof value === "number" ? value.toLocaleString() : value}
          </span>
          {unit && (
            <span className="text-sm font-medium text-muted-foreground">{unit}</span>
          )}
        </div>

        {/* Delta + comparison label */}
        <div className="flex items-center gap-2">
          <div className={cn(
            "inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs font-semibold",
            isPositive 
              ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" 
              : isNegative
                ? "bg-rose-500/10 text-rose-600 dark:text-rose-400"
                : "bg-muted text-muted-foreground"
          )}>
            {isPositive && <TrendingUp className="w-3 h-3" />}
            {isNegative && <TrendingDown className="w-3 h-3" />}
            {!isPositive && !isNegative && <Minus className="w-3 h-3" />}
            <span>{isPositive ? "+" : ""}{delta}%</span>
          </div>
          <span className="text-xs text-muted-foreground/70">{t.vsPrior}</span>
        </div>
      </div>
    </motion.div>
  )
}
