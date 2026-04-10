"use client"

import { motion } from "framer-motion"
import { TrendingUp, TrendingDown, Minus } from "lucide-react"
import { cn, deltaColor, fmt } from "@/lib/utils"
import type { KpiCard } from "@/lib/types"
import { useT } from "@/lib/lang-store"

interface Props {
  kpi: KpiCard
  index?: number
  icon?: React.ReactNode
  accent?: string
}

export function SummaryCard({ kpi, index = 0, icon, accent = "from-blue-500/10 to-violet-500/10" }: Props) {
  const t = useT()
  const { labelKey, label, value, delta, unit, tier } = kpi
  const displayLabel = t[labelKey] ?? label
  const isPositive = delta > 0
  const isNegative = delta < 0

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06, duration: 0.35, ease: "easeOut" }}
      whileHover={{ y: -2, transition: { duration: 0.15 } }}
      className={cn(
        "relative overflow-hidden rounded-xl border border-border bg-card p-5 shadow-sm",
        "hover:shadow-md transition-shadow"
      )}
    >
      {/* Gradient accent */}
      <div className={cn("absolute inset-0 bg-gradient-to-br opacity-40 pointer-events-none", accent)} />

      <div className="relative">
        <div className="flex items-start justify-between mb-3">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {displayLabel}
          </span>
          <div className="flex items-center gap-2">
            {/* Tier badge */}
            <span className={cn(
              "text-[10px] font-bold px-1.5 py-0.5 rounded",
              tier === 'A' ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : "bg-blue-500/15 text-blue-600 dark:text-blue-400"
            )}>
              T{tier}
            </span>
            {icon && <span className="text-muted-foreground/60">{icon}</span>}
          </div>
        </div>

        <div className="flex items-end justify-between">
          <span className="text-3xl font-bold tracking-tight">
            {typeof value === 'number' ? value.toLocaleString() : value}
            {unit && <span className="text-lg text-muted-foreground ml-1">{unit}</span>}
          </span>

          {delta !== 0 && (
            <div className={cn("flex items-center gap-1 text-sm font-medium", deltaColor(delta))}>
              {isPositive && <TrendingUp className="w-3.5 h-3.5" />}
              {isNegative && <TrendingDown className="w-3.5 h-3.5" />}
              {!isPositive && !isNegative && <Minus className="w-3.5 h-3.5" />}
              <span>{isPositive ? "+" : ""}{delta}%</span>
            </div>
          )}
        </div>

        <p className="text-[11px] text-muted-foreground mt-1">{t.vsPrior}</p>
      </div>
    </motion.div>
  )
}
