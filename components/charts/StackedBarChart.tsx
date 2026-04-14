"use client"

import { motion } from "framer-motion"
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis,
  CartesianGrid, Tooltip, Legend
} from "recharts"
import type { TimeSeriesPoint } from "@/lib/types"
import { brand } from "@/lib/brand"

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-lg text-sm">
      <p className="font-medium mb-1">{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.fill }} className="font-medium">
          {p.value} {p.name}
        </p>
      ))}
    </div>
  )
}

export function StackedBarChart({ data }: { data: TimeSeriesPoint[] }) {
  const formatted = data.map(d => ({ ...d, date: d.date.slice(5) }))
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.5 }}
      className="w-full h-64"
    >
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={formatted} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="currentColor" strokeOpacity={0.06} vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 11, fill: "currentColor", opacity: 0.5 }} axisLine={false} tickLine={false} interval={6} />
          <YAxis tick={{ fontSize: 11, fill: "currentColor", opacity: 0.5 }} axisLine={false} tickLine={false} />
          <Tooltip content={<CustomTooltip />} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          <Bar dataKey="value"  name="Passed" stackId="a" fill={brand.chartColors[0]} radius={[0, 0, 0, 0]} />
          <Bar dataKey="value2" name="Failed" stackId="a" fill={brand.chartColors[1]} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </motion.div>
  )
}
