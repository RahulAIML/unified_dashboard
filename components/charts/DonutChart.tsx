"use client"

import { useState } from "react"
import { motion } from "framer-motion"
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from "recharts"

interface Segment { name: string; value: number; color?: string }

const PALETTE = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
]

const MAX_LABEL_LEN = 20

function truncateLabel(name: string, max = MAX_LABEL_LEN): string {
  if (name.length <= max) return name
  return name.slice(0, max - 1) + "…"
}

type DonutTooltipItem = {
  name?: string
  value?: number | string
  color?: string
  payload?: { color?: string }
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: DonutTooltipItem[] }) {
  if (!active || !payload?.length) return null
  const c = payload[0]?.payload?.color ?? payload[0]?.color
  return (
    <div className="bg-card/95 backdrop-blur-sm border border-border/60 rounded-xl px-4 py-3 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.1)] text-sm max-w-[220px]">
      <div className="flex items-center gap-2 mb-1">
        <span
          className="w-3 h-3 rounded-full shrink-0"
          style={{ backgroundColor: c }}
        />
        <span style={{ color: c }} className="font-semibold truncate">{payload[0].name}</span>
      </div>
      <p className="text-muted-foreground text-xs pl-5">{payload[0].value} evaluations</p>
    </div>
  )
}

function CustomLegend({ payload }: { payload?: Array<{ value?: string; color?: string }> }) {
  if (!payload?.length) return null
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-2 justify-center lg:flex-col lg:items-start lg:gap-y-2.5 pt-2 lg:pt-0">
      {payload.map((entry, i) => (
        <div key={i} className="flex items-center gap-2 min-w-0">
          <span
            className="w-2.5 h-2.5 rounded-full shrink-0"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-xs text-muted-foreground truncate max-w-[130px] sm:max-w-[150px]" title={entry.value}>
            {truncateLabel(entry.value ?? "")}
          </span>
        </div>
      ))}
    </div>
  )
}

export function DonutChart({ data }: { data: Segment[] }) {
  const total = data.reduce((sum, item) => sum + item.value, 0)
  const [hoveredIdx, setHoveredIdx] = useState<number | null>(null)

  // Truncate names for the chart data to prevent overflow
  const chartData = data.map(d => ({
    ...d,
    name: truncateLabel(d.name),
    fullName: d.name,
  }))

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
      className="w-full overflow-visible"
    >
      {/* Chart + Legend wrapper: stacked column on mobile, row on desktop */}
      <div className="flex flex-col lg:flex-row items-center lg:items-stretch justify-center gap-3 sm:gap-4 lg:gap-8">
        {/* Chart container - fixed size for proper centering */}
        <div className="flex flex-col items-center justify-center flex-shrink-0 w-full lg:w-auto">
          <div className="relative w-[240px] h-[240px] sm:w-[280px] sm:h-[280px] lg:w-[300px] lg:h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <defs>
                  <filter id="innerShadow">
                    <feGaussianBlur in="SourceAlpha" stdDeviation="3" result="blur" />
                    <feOffset dx="0" dy="1" />
                    <feComposite in2="SourceAlpha" operator="arithmetic" k2="-1" k3="1" />
                    <feFlood floodColor="black" floodOpacity="0.08" />
                    <feComposite in2="SourceGraphic" operator="in" />
                  </filter>
                </defs>
                <Pie
                  data={chartData}
                  cx="50%"
                  cy="50%"
                  innerRadius="55%"
                  outerRadius="80%"
                  paddingAngle={2}
                  dataKey="value"
                  strokeWidth={0}
                  onMouseEnter={(_, i) => setHoveredIdx(i)}
                  onMouseLeave={() => setHoveredIdx(null)}
                  style={{ filter: "url(#innerShadow)" }}
                >
                  {chartData.map((entry, i) => (
                    <Cell
                      key={i}
                      fill={entry.color ?? PALETTE[i % PALETTE.length]}
                      className="transition-all duration-200 cursor-pointer"
                      style={{
                        opacity: hoveredIdx !== null && hoveredIdx !== i ? 0.5 : 1,
                        transform: hoveredIdx === i ? "scale(1.04)" : "scale(1)",
                        transformOrigin: "center center",
                      }}
                    />
                  ))}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>

            {/* Center KPI — absolutely positioned in the donut hole */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="text-center">
                <p className="text-[10px] sm:text-xs text-muted-foreground font-medium uppercase tracking-wide">Total</p>
                <p className="text-2xl sm:text-3xl font-bold text-foreground">{total.toLocaleString()}</p>
              </div>
            </div>
          </div>
        </div>

        {/* Legend: centered below chart on all sizes */}
        <div className="w-full lg:w-auto lg:flex-shrink-0 flex justify-center lg:justify-start">
          <div className="max-w-full lg:max-w-xs">
            <CustomLegend payload={chartData.map((d, i) => ({
              value: d.fullName ?? d.name,
              color: d.color ?? PALETTE[i % PALETTE.length],
            }))} />
          </div>
        </div>
      </div>
    </motion.div>
  )
}
