export interface BrandingSettings {
  logo_url: string | null
  primary_color: string
  secondary_color: string
  accent_color: string
}

export interface ResolvedClientBrand {
  name: string
  logo: string
  logoAlt: string
  primaryColor: string
  secondaryColor: string
  accentColor: string
  chartColor1: string
  chartColor2: string
  primaryHslLight: string
  primaryHslDark: string
  secondaryHslLight: string
  secondaryHslDark: string
  accentHsl: string
  chartColors: string[]
}

export const DEFAULT_BRANDING_SETTINGS: BrandingSettings = {
  logo_url: "/logo.jpg",
  primary_color: "#DC2626",
  secondary_color: "#3B82F6",
  accent_color: "#14B8A6",
}

const DEFAULT_BRAND_NAME = "Rolplay Analytics"

function hexToRgb(hex: string) {
  const normalized = hex.replace("#", "").trim()
  const safe = normalized.length === 3
    ? normalized.split("").map((char) => char + char).join("")
    : normalized

  if (!/^[0-9a-fA-F]{6}$/.test(safe)) {
    return { r: 220, g: 38, b: 38 }
  }

  const value = Number.parseInt(safe, 16)
  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  }
}

function rgbToHslTriple(r: number, g: number, b: number) {
  const red = r / 255
  const green = g / 255
  const blue = b / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  let hue = 0
  let saturation = 0
  const lightness = (max + min) / 2

  if (max !== min) {
    const delta = max - min
    saturation = lightness > 0.5 ? delta / (2 - max - min) : delta / (max + min)

    switch (max) {
      case red:
        hue = (green - blue) / delta + (green < blue ? 6 : 0)
        break
      case green:
        hue = (blue - red) / delta + 2
        break
      default:
        hue = (red - green) / delta + 4
        break
    }
    hue /= 6
  }

  return `${Math.round(hue * 360)} ${Math.round(saturation * 100)}% ${Math.round(lightness * 100)}%`
}

function hexToHslTriple(hex: string) {
  const { r, g, b } = hexToRgb(hex)
  return rgbToHslTriple(r, g, b)
}

function clampHex(input: string | null | undefined, fallback: string) {
  const value = input?.trim()
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value.toUpperCase() : fallback
}

export function normalizeBrandingSettings(
  input?: Partial<BrandingSettings> | { logo_url?: string | null; primary_color?: string | null; secondary_color?: string | null; accent_color?: string | null } | null
): BrandingSettings {
  return {
    logo_url: input?.logo_url?.trim() || DEFAULT_BRANDING_SETTINGS.logo_url,
    primary_color: clampHex(input?.primary_color, DEFAULT_BRANDING_SETTINGS.primary_color),
    secondary_color: clampHex(input?.secondary_color, DEFAULT_BRANDING_SETTINGS.secondary_color),
    accent_color: clampHex(input?.accent_color, DEFAULT_BRANDING_SETTINGS.accent_color),
  }
}

export function resolveClientBrand(
  input?: Partial<BrandingSettings> | { logo_url?: string | null; primary_color?: string | null; secondary_color?: string | null; accent_color?: string | null } | null
): ResolvedClientBrand {
  const settings = normalizeBrandingSettings(input)

  return {
    name: DEFAULT_BRAND_NAME,
    logo: settings.logo_url || DEFAULT_BRANDING_SETTINGS.logo_url || "/logo.jpg",
    logoAlt: DEFAULT_BRAND_NAME,
    primaryColor: settings.primary_color,
    secondaryColor: settings.secondary_color,
    accentColor: settings.accent_color,
    chartColor1: settings.primary_color,
    chartColor2: settings.secondary_color,
    primaryHslLight: hexToHslTriple(settings.primary_color),
    primaryHslDark: hexToHslTriple(settings.primary_color),
    secondaryHslLight: hexToHslTriple(settings.secondary_color),
    secondaryHslDark: hexToHslTriple(settings.secondary_color),
    accentHsl: hexToHslTriple(settings.accent_color),
    chartColors: ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)"],
  }
}

export function validateBrandingPayload(payload: Partial<BrandingSettings>) {
  const colorFields: Array<keyof BrandingSettings> = ["primary_color", "secondary_color", "accent_color"]
  for (const field of colorFields) {
    const value = payload[field]
    if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value.trim())) {
      throw new Error(`Invalid ${field}`)
    }
  }

  const logo = payload.logo_url
  if (logo != null && typeof logo !== "string") {
    throw new Error("Invalid logo_url")
  }
  if (typeof logo === "string" && logo.length > 2_000_000) {
    throw new Error("logo_url is too large")
  }
}
