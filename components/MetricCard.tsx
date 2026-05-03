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
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
      whileHover={{ y: -3, transition: { duration: 0.2 } }}
      className={cn(
        "relative w-full overflow-hidden rounded-[16px] border border-border/50 bg-card",
        "shadow-[0_1px_3px_rgba(0,0,0,0.05),0_1px_2px_rgba(0,0,0,0.02)]",
        "hover:shadow-[0_12px_20px_-5px_rgba(0,0,0,0.08),0_4px_8px_-4px_rgba(0,0,0,0.05)]",
        "transition-all duration-300 ease-out",
        className
      )}
    >
      <div
        className="h-[3px] w-full"
        style={{ background: "linear-gradient(90deg, hsl(var(--primary)), hsl(var(--accent)))" }}
      />

      <div className="p-5 sm:p-6">
        <div className="flex items-center justify-between gap-3 mb-4">
          <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
            {label}
          </span>
          {icon && (
            <div 
              className="w-9 h-9 rounded-xl flex items-center justify-center text-primary"
              style={{ 
                background: "linear-gradient(135deg, hsl(var(--primary)/0.12), hsl(var(--accent)/0.08))",
              }}
            >
              {icon}
            </div>
          )}
        </div>

        <div className="flex items-baseline gap-2">
          <span className="kpi-value text-[32px] sm:text-[36px] leading-none font-bold text-foreground tracking-tight">
            {typeof value === "number" ? value.toLocaleString() : value}
          </span>
          {unit && (
            <span className="text-sm font-medium text-muted-foreground">{unit}</span>
          )}
        </div>

        {hint && <p className="text-xs text-muted-foreground mt-2">{hint}</p>}
      </div>
    </motion.div>
  )
}
