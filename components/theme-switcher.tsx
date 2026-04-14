"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { motion, AnimatePresence } from "framer-motion"
import { Upload, Palette, Check, RefreshCw, ImageIcon } from "lucide-react"
import {
  applyTheme,
  setPrimaryColor,
  loadSavedTheme,
  loadSavedLogo,
  saveLogoPreview,
  rgbToHsl,
  hslToHex,
} from "@/lib/theme"
import { cn } from "@/lib/utils"
import { useT } from "@/lib/lang-store"

// ── Preset brand colors ───────────────────────────────────────────────────────

const PRESETS = [
  { label: "Ocean Blue",  hex: "#2563eb" },
  { label: "Violet",      hex: "#7c3aed" },
  { label: "Emerald",     hex: "#059669" },
  { label: "Rose",        hex: "#e11d48" },
  { label: "Amber",       hex: "#d97706" },
  { label: "Indigo",      hex: "#4f46e5" },
  { label: "Teal",        hex: "#0d9488" },
  { label: "Slate",       hex: "#475569" },
]

function hslToCssColor(hsl: string): string {
  const parts = hsl.trim().replace(/%/g, "").split(/\s+/)
  if (parts.length < 3) return "#2563eb"
  return `hsl(${parts[0]}, ${parts[1]}%, ${parts[2]}%)`
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ThemeSwitcher() {
  const t = useT()
  const [currentHsl, setCurrentHsl]     = useState<string>("220 72% 56%")
  const [logoUrl, setLogoUrl]           = useState<string | null>(null)
  const [extracting, setExtracting]     = useState(false)
  const [extractedHsl, setExtractedHsl] = useState<string | null>(null)
  const [extractError, setExtractError] = useState<string | null>(null)
  const [applied, setApplied]           = useState(false)
  const [dragOver, setDragOver]         = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const saved = loadSavedTheme()
    if (saved) setCurrentHsl(saved)
    const logo = loadSavedLogo()
    if (logo) setLogoUrl(logo)
  }, [])

  const applyColor = useCallback((hsl: string) => {
    setCurrentHsl(hsl)
    applyTheme(hsl)
    const hex = hslToHex(hsl)
    setPrimaryColor(hex ?? hsl)
    setApplied(true)
    setTimeout(() => setApplied(false), 1800)
  }, [])

  const extractFromImage = useCallback(async (src: string) => {
    setExtracting(true)
    setExtractError(null)
    setExtractedHsl(null)
    try {
      // dynamic import — colorthief must never run server-side
      const { getColor } = await import("colorthief")

      const img = new Image()
      img.crossOrigin = "anonymous"
      await new Promise<void>((resolve, reject) => {
        img.onload  = () => resolve()
        img.onerror = () => reject(new Error("Image failed to load"))
        img.src = src
      })

      const color = await getColor(img)
      if (!color) throw new Error("Could not extract color from image")

      // colorthief v3 Color object: .array() → [r, g, b] tuple
      const [r, g, b] = color.array()
      setExtractedHsl(rgbToHsl(r, g, b))
    } catch (err) {
      setExtractError(err instanceof Error ? err.message : "Extraction failed")
    } finally {
      setExtracting(false)
    }
  }, [])

  const handleFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      setExtractError("Please upload an image file (PNG, JPG, SVG…)")
      return
    }
    const reader = new FileReader()
    reader.onload = (e) => {
      const dataUrl = e.target?.result as string
      setLogoUrl(dataUrl)
      saveLogoPreview(dataUrl)
      extractFromImage(dataUrl)
    }
    reader.readAsDataURL(file)
  }, [extractFromImage])

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) handleFile(file)
    e.target.value = ""
  }

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) handleFile(file)
  }

  const resetLogo = () => {
    setLogoUrl(null)
    setExtractedHsl(null)
    setExtractError(null)
    if (typeof localStorage !== "undefined") localStorage.removeItem("theme-logo")
  }

  const currentCssColor   = hslToCssColor(currentHsl)
  const extractedCssColor = extractedHsl ? hslToCssColor(extractedHsl) : null

  return (
    <div className="space-y-6">

      {/* Active color indicator */}
      <div className="flex items-center gap-3">
        <div
          className="h-8 w-8 rounded-full border-2 border-white shadow-md ring-1 ring-border transition-all duration-500"
          style={{ background: currentCssColor }}
        />
        <div>
          <p className="text-sm font-medium">{t.themeActiveColor}</p>
          <p className="text-xs text-muted-foreground font-mono">{currentCssColor}</p>
        </div>
        <AnimatePresence>
          {applied && (
            <motion.span
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0 }}
              className="ml-auto flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400"
            >
              <Check className="h-3 w-3" /> {t.themeApplied}
            </motion.span>
          )}
        </AnimatePresence>
      </div>

      {/* Logo upload drop zone */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <ImageIcon className="h-3.5 w-3.5" />
          {t.themeUploadLogo}
        </p>

        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
          onDragLeave={() => setDragOver(false)}
          onDrop={onDrop}
          className={cn(
            "relative cursor-pointer rounded-xl border-2 border-dashed p-5 text-center transition-all select-none",
            dragOver
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary/50 hover:bg-muted/40"
          )}
        >
          <input
            ref={fileRef}
            type="file"
            accept="image/*"
            onChange={onFileChange}
            className="sr-only"
          />

          {logoUrl ? (
            <div className="flex items-center gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={logoUrl}
                alt="Company logo"
                className="h-14 max-w-[120px] object-contain rounded"
              />
              <div className="flex-1 text-left">
                <p className="text-sm font-medium">{t.themeLogoUploaded}</p>
                {extracting && (
                  <p className="text-xs text-muted-foreground flex items-center gap-1 mt-1">
                    <RefreshCw className="h-3 w-3 animate-spin" />
                    {t.themeExtracting}
                  </p>
                )}
                {extractedHsl && !extracting && (
                  <div className="flex items-center gap-2 mt-1">
                    <div
                      className="h-4 w-4 rounded-full border border-white shadow-sm"
                      style={{ background: extractedCssColor! }}
                    />
                    <span className="text-xs text-muted-foreground">{t.themeDominantDetected}</span>
                  </div>
                )}
                {extractError && (
                  <p className="text-xs text-rose-500 mt-1">{extractError}</p>
                )}
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); resetLogo() }}
                className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                aria-label="Remove logo"
              >
                <RefreshCw className="h-3.5 w-3.5" />
              </button>
            </div>
          ) : (
            <div className="py-2">
              <Upload className="mx-auto h-6 w-6 text-muted-foreground mb-2" />
              <p className="text-sm font-medium">{t.themeDropLogo}</p>
              <p className="text-xs text-muted-foreground mt-0.5">{t.themeDropLogoSub}</p>
            </div>
          )}
        </div>

        {/* Apply extracted color */}
        <AnimatePresence>
          {extractedHsl && !extracting && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="mt-3 flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-3 py-2.5"
            >
              <div
                className="h-6 w-6 shrink-0 rounded-full border border-white shadow"
                style={{ background: extractedCssColor! }}
              />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium">{t.themeColorExtracted}</p>
                <p className="text-[11px] text-muted-foreground font-mono truncate">{extractedCssColor}</p>
              </div>
              <button
                onClick={() => applyColor(extractedHsl)}
                className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90 transition-opacity"
              >
                {t.themeApplyTheme}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* Preset colors */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
          <Palette className="h-3.5 w-3.5" />
          {t.themePresetColors}
        </p>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => {
            const presetHsl = rgbToHsl(
              parseInt(p.hex.slice(1, 3), 16),
              parseInt(p.hex.slice(3, 5), 16),
              parseInt(p.hex.slice(5, 7), 16)
            )
            return (
              <motion.button
                key={p.hex}
                whileTap={{ scale: 0.88 }}
                whileHover={{ scale: 1.12 }}
                onClick={() => applyColor(presetHsl)}
                title={p.label}
                aria-label={`Apply ${p.label}`}
                className="h-8 w-8 rounded-full border-2 border-white shadow-md ring-1 ring-border transition-all"
                style={{ background: p.hex }}
              />
            )
          })}
        </div>
      </div>

      {/* Manual hex input */}
      <div>
        <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {t.themeCustomHex}
        </p>
        <div className="flex items-center gap-2">
          <input
            type="color"
            defaultValue={hslToHex(currentHsl) ?? "#2563eb"}
            onChange={(e) => {
              const hex = e.target.value
              const hsl = rgbToHsl(
                parseInt(hex.slice(1, 3), 16),
                parseInt(hex.slice(3, 5), 16),
                parseInt(hex.slice(5, 7), 16)
              )
              applyColor(hsl)
            }}
            className="h-9 w-9 cursor-pointer rounded-lg border border-border bg-transparent p-0.5"
          />
          <input
            type="text"
            placeholder="#2563eb"
            onBlur={(e) => {
              const val = e.target.value.trim()
              if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(val)) {
                const hsl = rgbToHsl(
                  parseInt(val.slice(1, 3), 16),
                  parseInt(val.slice(3, 5), 16),
                  parseInt(val.slice(5, 7), 16)
                )
                applyColor(hsl)
              }
            }}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur() }}
            className="h-9 flex-1 rounded-lg border border-border bg-background px-3 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      </div>

    </div>
  )
}
