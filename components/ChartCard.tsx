"use client"

import { cn } from "@/lib/utils"

interface Props {
  title: string
  subtitle?: string
  children: React.ReactNode
  className?: string
}

export function ChartCard({ title, subtitle, children, className }: Props) {
  return (
    <div className={cn("rounded-xl border border-border bg-card shadow-sm hover:shadow-md transition-shadow overflow-hidden", className)}>
      {/* Gradient top stripe — consistent with SummaryCard */}
      <div
        className="h-[3px] w-full"
        style={{ background: "linear-gradient(90deg, hsl(var(--primary)), hsl(var(--accent)))" }}
      />

      {/* Header */}
      <div className="px-5 pt-5 pb-0">
        <h3 className="text-[16px] font-semibold text-foreground leading-snug tracking-[-0.01em]">
          {title}
        </h3>
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{subtitle}</p>
        )}
      </div>

      {/* Chart area */}
      <div className="px-5 pt-4 pb-5">
        <div className="w-full max-w-full overflow-x-auto">
          <div className="min-w-[300px] md:min-w-full">
            {children}
          </div>
        </div>
      </div>
    </div>
  )
}
