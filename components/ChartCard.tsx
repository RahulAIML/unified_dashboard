"use client"

import { cn } from "@/lib/utils"

interface Props {
  title: string
  subtitle?: string
  children: React.ReactNode
  className?: string
  headerAction?: React.ReactNode
}

export function ChartCard({ title, subtitle, children, className, headerAction }: Props) {
  return (
    <div className={cn(
      "relative overflow-hidden rounded-[16px] border border-border/50 bg-card",
      "shadow-[0_1px_3px_rgba(0,0,0,0.05),0_1px_2px_rgba(0,0,0,0.02)]",
      "hover:shadow-[0_12px_20px_-5px_rgba(0,0,0,0.08),0_4px_8px_-4px_rgba(0,0,0,0.05)]",
      "transition-all duration-300 ease-out",
      className
    )}>
      {/* Gradient top stripe — consistent with SummaryCard */}
      <div
        className="h-[3px] w-full"
        style={{ background: "linear-gradient(90deg, hsl(var(--primary)), hsl(var(--accent)))" }}
      />

      {/* Header */}
      <div className="px-5 sm:px-6 pt-5 sm:pt-6 pb-0 flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <h3 className="text-base sm:text-lg font-semibold text-foreground leading-tight tracking-tight">
            {title}
          </h3>
          {subtitle && (
            <p className="text-xs sm:text-sm text-muted-foreground mt-1 leading-relaxed">{subtitle}</p>
          )}
        </div>
        {headerAction && (
          <div className="shrink-0">
            {headerAction}
          </div>
        )}
      </div>

      {/* Chart area */}
      <div className="px-4 sm:px-6 pt-4 sm:pt-5 pb-4 sm:pb-6">
        <div className="w-full max-w-full overflow-hidden">
          <div className="min-w-0">
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
