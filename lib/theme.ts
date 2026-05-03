"use client"

const STORAGE_KEY = "theme-primary"

function isHexColor(value: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim())
}

function normalizeHex(value: string): string {
  const hex = value.trim()
  if (hex.length === 4) {
    return "#" + hex[1] + hex[1] + hex[2] + hex[2] + hex[3] + hex[3]
  }
  return hex
}

function hexToHslComponents(hexValue: string): string {
  const hex = normalizeHex(hexValue).replace("#", "")
  const r = parseInt(hex.slice(0, 2), 16) / 255
  const g = parseInt(hex.slice(2, 4), 16) / 255
  const b = parseInt(hex.slice(4, 6), 16) / 255

  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0)
        break
      case g:
        h = (b - r) / d + 2
        break
      default:
        h = (r - g) / d + 4
        break
    }
    h = h * 60
  }

  const hRound = Math.round(h)
  const sRound = Math.round(s * 100)
  const lRound = Math.round(l * 100)

  return `${hRound} ${sRound}% ${lRound}%`
}

export function hslToHex(value: string): string | null {
  const parts = value
    .trim()
    .replace(/%/g, "")
    .split(/\s+/)
    .map((p) => p.trim())
    .filter(Boolean)

  if (parts.length < 3) return null

  const h = Number(parts[0])
  const s = Number(parts[1]) / 100
  const l = Number(parts[2]) / 100

  if (!Number.isFinite(h) || !Number.isFinite(s) || !Number.isFinite(l)) {
    return null
  }

  const c = (1 - Math.abs(2 * l - 1)) * s
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1))
  const m = l - c / 2

  let r = 0
  let g = 0
  let b = 0

  if (h >= 0 && h < 60) {
    r = c
    g = x
    b = 0
  } else if (h >= 60 && h < 120) {
    r = x
    g = c
    b = 0
  } else if (h >= 120 && h < 180) {
    r = 0
    g = c
    b = x
  } else if (h >= 180 && h < 240) {
    r = 0
    g = x
    b = c
  } else if (h >= 240 && h < 300) {
    r = x
    g = 0
    b = c
  } else {
    r = c
    g = 0
    b = x
  }

  const toHex = (n: number) => {
    const v = Math.round((n + m) * 255)
    return v.toString(16).padStart(2, "0")
  }

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

export function applyTheme(value: string) {
  if (typeof document === "undefined") return
  const trimmed = value.trim()
  const hsl = isHexColor(trimmed) ? hexToHslComponents(trimmed) : trimmed
  document.documentElement.style.setProperty("--primary", hsl)
}

export function setPrimaryColor(hex: string) {
  if (typeof localStorage !== "undefined") {
    localStorage.setItem(STORAGE_KEY, hex)
  }
  applyTheme(hex)
}

export function loadSavedTheme(): string | null {
  if (typeof localStorage === "undefined") return null
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved) applyTheme(saved)
  return saved
}

// ── Logo → color extraction ───────────────────────────────────────────────────

/** Convert an RGB triplet to an HSL CSS-variable string e.g. "220 72% 56%" */
export function rgbToHsl(r: number, g: number, b: number): string {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255

  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  let h = 0
  let s = 0
  const l = (max + min) / 2

  if (max !== min) {
    const d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case rn:
        h = (gn - bn) / d + (gn < bn ? 6 : 0)
        break
      case gn:
        h = (bn - rn) / d + 2
        break
      default:
        h = (rn - gn) / d + 4
        break
    }
    h *= 60
  }

  return `${Math.round(h)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%`
}

/** Save the logo dataURL so it persists across page loads */
export function saveLogoPreview(dataUrl: string) {
  if (typeof localStorage === "undefined") return
  try {
    localStorage.setItem("theme-logo", dataUrl)
  } catch {
    // localStorage quota exceeded — silently ignore
  }
}

export function loadSavedLogo(): string | null {
  if (typeof localStorage === "undefined") return null
  return localStorage.getItem("theme-logo")
}
