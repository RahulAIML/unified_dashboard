"use client"

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
    <div className="bg-card/95 backdrop-blur-sm border border-border/60 rounded-xl px-4 py-3 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.1)] text-sm">
      <div className="flex items-center gap-2 mb-1">
        <span 
          className="w-3 h-3 rounded-full" 
          style={{ backgroundColor: c }}
        />
        <span style={{ color: c }} className="font-semibold">{payload[0].name}</span>
      </div>
      <p className="text-muted-foreground text-xs pl-5">{payload[0].value} evaluations</p>
    </div>
  )
}

export function DonutChart({ data }: { data: Segment[] }) {
  const total = data.reduce((sum, item) => sum + item.value, 0)

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
      className="w-full h-72 sm:h-80"
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="45%"
            cy="50%"
            innerRadius={60}
            outerRadius={85}
            paddingAngle={2}
            dataKey="value"
            strokeWidth={0}
          >
            {data.map((entry, i) => (
              <Cell 
                key={i} 
                fill={entry.color ?? PALETTE[i % PALETTE.length]}
                className="transition-all duration-200"
              />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend
            verticalAlign="middle"
            align="right"
            layout="vertical"
            iconType="circle"
            iconSize={10}
            wrapperStyle={{ 
              fontSize: 12, 
              paddingLeft: 16,
              lineHeight: '24px'
            }}
          />
        </PieChart>
      </ResponsiveContainer>
      {/* Center total display */}
      <div className="absolute inset-0 flex items-center justify-start pointer-events-none" style={{ paddingLeft: '18%' }}>
        <div className="text-center">
          <p className="text-xs text-muted-foreground font-medium">Total</p>
          <p className="text-xl font-bold text-foreground kpi-value">{total.toLocaleString()}</p>
        </div>
      </div>
    </motion.div>
  )
}
