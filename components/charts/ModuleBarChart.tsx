"use client"

import { motion } from "framer-motion"
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend
} from "recharts"
interface DataPoint {
  module: string
  sessions: number
  passed: number
}

type TooltipItem = {
  name?: string
  value?: number | string
  color?: string
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean
  payload?: TooltipItem[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-lg text-sm">
      <p className="font-medium mb-1">{label}</p>
      {payload.map((p, i) => (
        <p key={p.name ?? String(i)} style={{ color: p.color }} className="font-medium">
          {p.value} {p.name}
        </p>
      ))}
    </div>
  )
}

interface Props {
  data:          DataPoint[]
  sessionsColor?: string
  passedColor?:  string
}

export function ModuleBarChart({
  data,
  sessionsColor = "var(--chart-1)",
  passedColor   = "var(--chart-3)",
}: Props) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, delay: 0.1 }}
      className="w-full h-64"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.06} vertical={false} />
          <XAxis
            dataKey="module"
            tick={{ fontSize: 11, fill: "currentColor", opacity: 0.5 }}
            axisLine={false}
            tickLine={false}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "currentColor", opacity: 0.5 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="sessions" name="Total Sessions" fill={sessionsColor} radius={[4, 4, 0, 0]} />
          <Bar dataKey="passed"   name="Passed"         fill={passedColor}  radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </motion.div>
  )
}
