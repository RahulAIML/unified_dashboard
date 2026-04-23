"use client"

import { useEffect } from "react"
import { useDashboardStore } from "@/lib/store"
import { getClientBrand } from "@/lib/client-config"
import { useTheme } from "@/components/ThemeProvider"

/**
 * Applies client branding to CSS variables.
 *
 * This keeps UI components free of hardcoded colors:
 * - --primary expects an HSL triple (used by shadcn/tailwind tokens)
 * - --brand-accent is a full CSS color string (used sparingly as an accent)
 */
export function ClientBrandProvider() {
  const clientId = useDashboardStore((s) => s.clientId)
  const brand = getClientBrand(clientId)
  const { theme } = useTheme()

  useEffect(() => {
    const root = document.documentElement

    root.style.setProperty("--primary", theme === "dark" ? brand.primaryHslDark : brand.primaryHslLight)
    root.style.setProperty("--ring", `hsl(${theme === "dark" ? brand.primaryHslDark : brand.primaryHslLight})`)

    // Accent stays constant across light/dark; keep it for small accents only.
    root.style.setProperty("--brand-accent", `hsl(${brand.accentHsl})`)
  }, [brand.primaryHslLight, brand.primaryHslDark, brand.accentHsl, theme])

  return null
}
