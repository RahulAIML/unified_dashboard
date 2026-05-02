"use client"

import { motion } from "framer-motion"
import {
  ResponsiveContainer, AreaChart, Area, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend
} from "recharts"
import type { TimeSeriesPoint } from "@/lib/types"

interface Props {
  data: TimeSeriesPoint[]
  label?: string
  label2?: string
  color?: string
  color2?: string
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
        <div key={p.name ?? String(i)} className="flex items-center gap-2 text-muted-foreground">
          <span 
            className="w-2 h-2 rounded-full" 
            style={{ backgroundColor: p.color }}
          />
          <span className="font-medium" style={{ color: p.color }}>{p.value}</span>
          <span className="text-xs">{p.name}</span>
        </div>
      ))}
    </div>
  )
}

export function ActivityLineChart({
  data,
  label = "Sessions",
  label2,
  color  = "var(--chart-1)",
  color2 = "var(--chart-5)",
}: Props) {
  const formatted = data.map(d => ({
    ...d,
    date: d.date.slice(5), // MM-DD
  }))

  // Adapt tick interval to data density so labels are never hidden on small sets
  const xInterval = data.length <= 8 ? 0 : data.length <= 20 ? 2 : 4

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6, ease: [0.25, 0.1, 0.25, 1] }}
      className="w-full h-72 sm:h-80"
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={formatted} margin={{ top: 10, right: 10, left: -10, bottom: 5 }}>
          <defs>
            <linearGradient id="grad1" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={color}  stopOpacity={0.25} />
              <stop offset="95%" stopColor={color}  stopOpacity={0}   />
            </linearGradient>
            <linearGradient id="grad2" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={color2} stopOpacity={0.25} />
              <stop offset="95%" stopColor={color2} stopOpacity={0}   />
            </linearGradient>
          </defs>
          <CartesianGrid 
            strokeDasharray="4 4" 
            stroke="currentColor" 
            strokeOpacity={0.04}
            vertical={false}
          />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 12, fill: "currentColor", opacity: 0.45, fontWeight: 500 }}
            axisLine={false}
            tickLine={false}
            interval={xInterval}
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
            cursor={{ stroke: "currentColor", strokeOpacity: 0.1, strokeWidth: 2 }}
          />
          {label2 && <Legend wrapperStyle={{ paddingTop: 16 }} />}
          <Area
            type="monotone"
            dataKey="value"
            name={label}
            stroke={color}
            fill="url(#grad1)"
            strokeWidth={2.5}
            dot={false}
            activeDot={{ 
              r: 5, 
              strokeWidth: 2, 
              stroke: "var(--background)",
              fill: color
            }}
          />
          {label2 && (
            <Area
              type="monotone"
              dataKey="value2"
              name={label2}
              stroke={color2}
              fill="url(#grad2)"
              strokeWidth={2.5}
              dot={false}
              activeDot={{ 
                r: 5, 
                strokeWidth: 2, 
                stroke: "var(--background)",
                fill: color2
              }}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </motion.div>
  )
}
