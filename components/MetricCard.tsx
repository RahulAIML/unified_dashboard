"use client"

import { motion } from "framer-motion"
import { cn } from "@/lib/utils"

interface Props {
  label: string
  value: string | number
  unit?: string
  icon?: React.ReactNode
  hint?: string
  className?: string
}

export function MetricCard({ label, value, unit, icon, hint, className }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.25, ease: "easeOut" }}
      className={cn(
        "relative w-full min-h-[120px] overflow-hidden rounded-xl border border-border bg-card shadow-sm",
        "hover:shadow-md transition-shadow",
        className
      )}
    >
      <div className="h-[3px] w-full bg-primary" />
      <div className="absolute inset-0 pointer-events-none bg-primary/5" />

      <div className="relative p-4 md:p-5">
        <div className="flex items-start justify-between mb-3">
          <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
            {label}
          </span>
          {icon && <span className="text-muted-foreground/60">{icon}</span>}
        </div>

        <div className="flex items-end justify-between gap-3">
          <span className="text-2xl md:text-3xl font-bold tracking-tight text-primary">
            {typeof value === "number" ? value.toLocaleString() : value}
            {unit && <span className="text-base md:text-lg ml-1 text-primary/60">{unit}</span>}
          </span>
        </div>

        {hint && <p className="text-[11px] text-muted-foreground mt-1">{hint}</p>}
      </div>
    </motion.div>
  )
}

