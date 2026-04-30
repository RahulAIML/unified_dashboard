"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { useTheme } from "@/components/ThemeProvider"
import { useAuthContext } from "@/components/AuthProvider"
import { DEFAULT_BRANDING_SETTINGS, resolveClientBrand, type BrandingSettings, type ResolvedClientBrand } from "@/lib/branding"

interface BrandingApiEnvelope {
  data?: {
    settings?: BrandingSettings
    message?: string
  }
}

interface BrandContextValue extends ResolvedClientBrand {
  isLoading: boolean
  refreshBranding: () => Promise<void>
  saveBranding: (payload: BrandingSettings) => Promise<void>
}

interface ClientBrandProviderProps {
  children: ReactNode
}

const defaultBrand = resolveClientBrand(DEFAULT_BRANDING_SETTINGS)

const BrandContext = createContext<BrandContextValue>({
  ...defaultBrand,
  isLoading: false,
  refreshBranding: async () => undefined,
  saveBranding: async () => undefined,
})

export function ClientBrandProvider({ children }: ClientBrandProviderProps) {
  const { theme } = useTheme()
  const { isAuthenticated, isLoading: authLoading } = useAuthContext()
  const [brand, setBrand] = useState(defaultBrand)
  const [isLoading, setIsLoading] = useState(true)

  const refreshBranding = useCallback(async () => {
    if (!isAuthenticated) {
      setBrand(defaultBrand)
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    try {
      const response = await fetch("/api/branding", { credentials: "include", cache: "no-store" })
      const json = await response.json().catch(() => null) as BrandingApiEnvelope | null
      setBrand(resolveClientBrand(json?.data?.settings))
    } catch (error) {
      console.warn("[ClientBrandProvider] failed to load branding", error)
      setBrand(defaultBrand)
    } finally {
      setIsLoading(false)
    }
  }, [isAuthenticated])

  const saveBranding = useCallback(async (payload: BrandingSettings) => {
    const response = await fetch("/api/branding", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(payload),
    })

    const json = await response.json().catch(() => null) as BrandingApiEnvelope | null
    if (!response.ok) {
      throw new Error(json?.data?.message ?? "Failed to save branding")
    }

    setBrand(resolveClientBrand(json?.data?.settings))
  }, [])

  useEffect(() => {
    if (authLoading) return
    void refreshBranding()
  }, [authLoading, refreshBranding])

  useEffect(() => {
    const root = document.documentElement

    root.style.setProperty("--primary", theme === "dark" ? brand.primaryHslDark : brand.primaryHslLight)
    root.style.setProperty("--secondary", theme === "dark" ? brand.secondaryHslDark : brand.secondaryHslLight)
    root.style.setProperty("--ring", `hsl(${theme === "dark" ? brand.primaryHslDark : brand.primaryHslLight})`)
    root.style.setProperty("--brand-accent", `hsl(${brand.accentHsl})`)
    root.style.setProperty("--chart-1", brand.chartColor1)
    root.style.setProperty("--chart-2", brand.chartColor2)
  }, [brand, theme])

  const value = useMemo<BrandContextValue>(() => ({
    ...brand,
    isLoading,
    refreshBranding,
    saveBranding,
  }), [brand, isLoading, refreshBranding, saveBranding])

  return <BrandContext.Provider value={value}>{children}</BrandContext.Provider>
}

export function useBrandContext() {
  return useContext(BrandContext)
}
