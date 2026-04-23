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
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-lg text-sm">
      <p className="font-medium mb-1 text-foreground">{label}</p>
      {payload.map((p, i) => (
        <p key={p.name ?? String(i)} className="text-muted-foreground">
          <span style={{ color: p.color }} className="font-semibold">{p.value}</span>
          {" "}{p.name}
        </p>
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
  const xInterval = data.length <= 10 ? 0 : data.length <= 30 ? 2 : 6

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="w-full h-64"
    >
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={formatted} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="grad1" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={color}  stopOpacity={0.3} />
              <stop offset="95%" stopColor={color}  stopOpacity={0}   />
            </linearGradient>
            <linearGradient id="grad2" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor={color2} stopOpacity={0.3} />
              <stop offset="95%" stopColor={color2} stopOpacity={0}   />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.06} />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 11, fill: "currentColor", opacity: 0.5 }}
            axisLine={false}
            tickLine={false}
            interval={xInterval}
          />
          <YAxis
            tick={{ fontSize: 11, fill: "currentColor", opacity: 0.5 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip content={<CustomTooltip />} />
          {label2 && <Legend />}
          <Area
            type="monotone"
            dataKey="value"
            name={label}
            stroke={color}
            fill="url(#grad1)"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
          {label2 && (
            <Area
              type="monotone"
              dataKey="value2"
              name={label2}
              stroke={color2}
              fill="url(#grad2)"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </motion.div>
  )
}
