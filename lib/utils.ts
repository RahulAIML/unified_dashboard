import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function fmt(value: number | string, unit?: string): string {
  if (value === '—' || value === null || value === undefined) return '—'
  const n = typeof value === 'string' ? parseFloat(value) : value
  if (isNaN(n)) return '—'
  const formatted = n >= 1000 ? n.toLocaleString() : String(n)
  return unit ? `${formatted}${unit}` : formatted
}

export function deltaColor(delta: number): string {
  if (delta > 0)  return 'text-emerald-500'
  if (delta < 0)  return 'text-rose-500'
  return 'text-muted-foreground'
}

export function deltaSymbol(delta: number): string {
  if (delta > 0) return '↑'
  if (delta < 0) return '↓'
  return '→'
}
