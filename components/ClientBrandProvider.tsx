"use client"

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react"
import { useTheme } from "@/components/ThemeProvider"
import { useAuthContext } from "@/components/AuthProvider"
import { DEFAULT_BRANDING_SETTINGS, resolveClientBrand, type BrandingSettings, type ResolvedClientBrand } from "@/lib/branding"

const DARK_CANVAS_HEX = "#0B0B0B"
const WHITE_TEXT_HEX = "#FFFFFF"
const MIN_UI_CONTRAST = 3
const MIN_TEXT_CONTRAST = 4.5

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

function hexToRgb(hex: string) {
  const normalized = hex.trim().replace("#", "")
  if (!/^[0-9a-fA-F]{6}$/.test(normalized)) return null
  const value = Number.parseInt(normalized, 16)
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  }
}

function relativeLuminance(rgb: { r: number; g: number; b: number }) {
  const toLinear = (c: number) => {
    const v = c / 255
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4
  }
  const r = toLinear(rgb.r)
  const g = toLinear(rgb.g)
  const b = toLinear(rgb.b)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

function contrastRatio(hexA: string, hexB: string) {
  const a = hexToRgb(hexA)
  const b = hexToRgb(hexB)
  if (!a || !b) return null
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  const lighter = Math.max(la, lb)
  const darker = Math.min(la, lb)
  return (lighter + 0.05) / (darker + 0.05)
}

function safeHexOrFallback(
  hex: string,
  fallbackHex: string,
  checks: Array<{ against: string; min: number }>
) {
  for (const check of checks) {
    const ratio = contrastRatio(hex, check.against)
    if (!ratio || ratio < check.min) return fallbackHex
  }
  return hex
}

function parseHslTriple(value: string) {
  const parts = value
    .trim()
    .replace(/%/g, "")
    .split(/\s+/)
    .map((p) => p.trim())
    .filter(Boolean)

  if (parts.length < 3) return null

  const h = Number(parts[0])
  const s = Number(parts[1])
  const l = Number(parts[2])
  if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(l)) return null

  return { h, s, l }
}

function shadeHslTriple(value: string, direction: "lighter" | "darker") {
  const parsed = parseHslTriple(value)
  if (!parsed) return value
  const { h, s } = parsed
  const l = direction === "lighter"
    ? parsed.l + (100 - parsed.l) * 0.2
    : parsed.l * 0.8
  const clamped = Math.max(0, Math.min(100, Math.round(l)))
  return `${Math.round(h)} ${Math.round(s)}% ${clamped}%`
}

const BrandContext = createContext<BrandContextValue>({
  ...defaultBrand,
  isLoading: false,
  refreshBranding: async () => undefined,
  saveBranding: async () => undefined,
})

// ── User-level localStorage cache (keyed by email) ───────────────────────────
// Personalization is stored per user email so each user's dashboard settings
// are independent, matching the email-based identity contract in the spec.

const USER_CACHE_KEY = (email: string) =>
  `dashboard_settings_${email}`

function loadLocalSettings(email: string): BrandingSettings | null {
  if (typeof window === 'undefined' || !email) return null
  try {
    const raw = localStorage.getItem(USER_CACHE_KEY(email))
    if (!raw) return null
    const parsed = JSON.parse(raw) as Partial<BrandingSettings>
    if (!parsed.primary_color || !parsed.secondary_color || !parsed.accent_color) return null
    return parsed as BrandingSettings
  } catch {
    return null
  }
}

function saveLocalSettings(email: string, settings: BrandingSettings) {
  if (typeof window === 'undefined' || !email) return
  try {
    localStorage.setItem(USER_CACHE_KEY(email), JSON.stringify(settings))
  } catch {
    // localStorage may be blocked — silently ignore
  }
}

export function ClientBrandProvider({ children }: ClientBrandProviderProps) {
  const { theme } = useTheme()
  const { isAuthenticated, isLoading: authLoading, user } = useAuthContext()
  const [brand, setBrand] = useState(defaultBrand)
  const [isLoading, setIsLoading] = useState(true)

  // Email from the authenticated user — empty string when not yet loaded.
  // Personalization is user-specific, keyed by email.
  const userEmail = user?.email ?? ''

  const refreshBranding = useCallback(async () => {
    if (!isAuthenticated) {
      setBrand(defaultBrand)
      setIsLoading(false)
      return
    }

    // Fast path: apply user-level cached settings instantly while DB fetch completes
    const localSettings = loadLocalSettings(userEmail)
    if (localSettings) {
      setBrand(resolveClientBrand(localSettings))
    }

    setIsLoading(true)
    try {
      const response = await fetch("/api/branding", { credentials: "include", cache: "no-store" })
      const json = await response.json().catch(() => null) as BrandingApiEnvelope | null
      const dbSettings = json?.data?.settings ?? null
      if (dbSettings) {
        // DB is authoritative — sync the user-level cache
        saveLocalSettings(userEmail, dbSettings)
        setBrand(resolveClientBrand(dbSettings))
      } else if (!localSettings) {
        setBrand(defaultBrand)
      }
    } catch (error) {
      console.warn("[ClientBrandProvider] failed to load branding", error)
      if (!localSettings) setBrand(defaultBrand)
    } finally {
      setIsLoading(false)
    }
  }, [isAuthenticated, userEmail])

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

    const saved = json?.data?.settings ?? payload
    // Sync the user-level cache
    saveLocalSettings(userEmail, saved)
    setBrand(resolveClientBrand(saved))
  }, [userEmail])

  useEffect(() => {
    if (authLoading) return
    void refreshBranding()
  }, [authLoading, refreshBranding])

  useEffect(() => {
    const root = document.documentElement

    const primaryHex = safeHexOrFallback(brand.primaryColor, defaultBrand.primaryColor, [
      { against: DARK_CANVAS_HEX, min: MIN_UI_CONTRAST },
      { against: WHITE_TEXT_HEX, min: MIN_TEXT_CONTRAST },
    ])
    const secondaryHex = safeHexOrFallback(brand.secondaryColor, defaultBrand.secondaryColor, [
      { against: DARK_CANVAS_HEX, min: MIN_UI_CONTRAST },
    ])
    const accentHex = safeHexOrFallback(brand.accentColor, defaultBrand.accentColor, [
      { against: DARK_CANVAS_HEX, min: MIN_UI_CONTRAST },
    ])

    const primaryTriple = primaryHex === brand.primaryColor
      ? (theme === "dark" ? brand.primaryHslDark : brand.primaryHslLight)
      : (theme === "dark" ? defaultBrand.primaryHslDark : defaultBrand.primaryHslLight)
    const secondaryTriple = secondaryHex === brand.secondaryColor
      ? (theme === "dark" ? brand.secondaryHslDark : brand.secondaryHslLight)
      : (theme === "dark" ? defaultBrand.secondaryHslDark : defaultBrand.secondaryHslLight)
    const accentTriple = accentHex === brand.accentColor ? brand.accentHsl : defaultBrand.accentHsl

    // Brand variables (restricted usage): buttons, highlights, active tabs, chart accents
    root.style.setProperty("--primary", primaryTriple)
    root.style.setProperty("--primary-light", shadeHslTriple(primaryTriple, "lighter"))
    root.style.setProperty("--primary-dark", shadeHslTriple(primaryTriple, "darker"))

    root.style.setProperty("--secondary", secondaryTriple)
    root.style.setProperty("--secondary-light", shadeHslTriple(secondaryTriple, "lighter"))
    root.style.setProperty("--secondary-dark", shadeHslTriple(secondaryTriple, "darker"))

    root.style.setProperty("--accent", accentTriple)
    root.style.setProperty("--accent-light", shadeHslTriple(accentTriple, "lighter"))
    root.style.setProperty("--accent-dark", shadeHslTriple(accentTriple, "darker"))
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
