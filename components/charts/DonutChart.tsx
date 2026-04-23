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
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-lg text-sm">
      <p style={c ? { color: c } : {}} className="font-semibold">{payload[0].name}</p>
      <p className="text-muted-foreground">{payload[0].value}</p>
    </div>
  )
}

export function DonutChart({ data }: { data: Segment[] }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.45 }}
      className="w-full h-64"
    >
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            cx="50%"
            cy="50%"
            innerRadius={55}
            outerRadius={90}
            paddingAngle={3}
            dataKey="value"
            strokeWidth={0}
          >
            {data.map((entry, i) => (
              <Cell key={i} fill={entry.color ?? PALETTE[i % PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip content={<CustomTooltip />} />
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 11 }}
          />
        </PieChart>
      </ResponsiveContainer>
    </motion.div>
  )
}
