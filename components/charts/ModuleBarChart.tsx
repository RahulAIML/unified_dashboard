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
    <div className="bg-card/95 backdrop-blur-sm border border-border/60 rounded-xl px-4 py-3 shadow-[0_10px_15px_-3px_rgba(0,0,0,0.1)] text-sm">
      <p className="font-semibold mb-2 text-foreground">{label}</p>
      {payload.map((p, i) => (
        <div key={p.name ?? String(i)} className="flex items-center gap-2 mb-1 last:mb-0">
          <span 
            className="w-2 h-2 rounded-sm" 
            style={{ backgroundColor: p.color }}
          />
          <span style={{ color: p.color }} className="font-medium">{p.value}</span>
          <span className="text-xs text-muted-foreground">{p.name}</span>
        </div>
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
  passedColor   = "var(--chart-2)",
}: Props) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1] }}
      className="w-full h-72 sm:h-80"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 10, right: 16, left: -10, bottom: 5 }}>
          <CartesianGrid 
            strokeDasharray="4 4" 
            stroke="currentColor" 
            strokeOpacity={0.04}
            vertical={false} 
          />
          <XAxis
            dataKey="module"
            tick={{ fontSize: 12, fill: "currentColor", opacity: 0.45, fontWeight: 500 }}
            axisLine={false}
            tickLine={false}
            dy={8}
          />
          <YAxis
            tick={{ fontSize: 12, fill: "currentColor", opacity: 0.45, fontWeight: 500 }}
            axisLine={false}
            tickLine={false}
            dx={-4}
          />
          <Tooltip 
            content={<CustomTooltip />}
            cursor={{ fill: "currentColor", opacity: 0.04 }}
          />
          <Legend 
            wrapperStyle={{ paddingTop: 16, fontSize: 12 }}
            iconType="square"
            iconSize={10}
          />
          <Bar 
            dataKey="sessions" 
            name="Total Sessions" 
            fill={sessionsColor} 
            radius={[6, 6, 0, 0]}
            maxBarSize={48}
          />
          <Bar 
            dataKey="passed"   
            name="Passed"         
            fill={passedColor}
            radius={[6, 6, 0, 0]}
            maxBarSize={48}
          />
        </BarChart>
      </ResponsiveContainer>
    </motion.div>
  )
}
