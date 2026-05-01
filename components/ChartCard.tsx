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
    <div className={cn("rounded-xl border border-border bg-card shadow-sm overflow-hidden", className)}>
      {/* Brand left accent bar */}
      <div className="flex">
        <div className="w-[3px] shrink-0 bg-primary" />
        <div className="flex-1 p-5">
          <div className="mb-4">
            <h3 className="text-sm font-bold text-primary">{title}</h3>
            {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
          </div>
          <div className="w-full max-w-full overflow-x-auto">
            <div className="min-w-[300px] md:min-w-full">
              {children}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
