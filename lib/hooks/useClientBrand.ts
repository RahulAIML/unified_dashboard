"use client"

import { useDashboardStore } from "@/lib/store"
import { getClientBrand, type ClientBrand } from "@/lib/client-config"

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
export function useClientBrand(): ClientBrand {
  const clientId = useDashboardStore((s) => s.clientId)
  return getClientBrand(clientId)
}
