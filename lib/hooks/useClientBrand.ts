"use client"

import { useDashboardStore } from "@/lib/store"
import { getClientBrand, type ClientBrand } from "@/lib/client-config"

export interface ResolvedClientBrand extends ClientBrand {
  /** Use in inline styles when needed (prefer Tailwind tokens where possible). */
  primaryColor: string
  /** Use sparingly for accents (dots/stripes), not full backgrounds. */
  accentColor: string
  /** CSS-variable palette for charts (no hardcoded hex arrays). */
  chartColors: string[]
}

/**
 * Returns the active client brand config from the global store.
 *
 * The clientId is set by DashboardHeader on first render by reading
 * the ?client= URL query param. All components that need brand values
 * (colours, logo, name) should use this hook instead of importing
 * the static `brand` object from lib/brand.ts.
 *
 * Falls back to the rolplay default brand when no client is set.
 *
 * @example
 *   const brand = useClientBrand()
 *   <div style={{ color: brand.primaryColor }}>...</div>
 */
export function useClientBrand(): ResolvedClientBrand {
  const clientId = useDashboardStore((s) => s.clientId)
  const brand = getClientBrand(clientId)

  return {
    ...brand,
    primaryColor: "hsl(var(--primary))",
    accentColor:  "var(--brand-accent)",
    chartColors:  [
      "var(--chart-1)",
      "var(--chart-2)",
      "var(--chart-3)",
      "var(--chart-4)",
      "var(--chart-5)",
    ],
  }
}
