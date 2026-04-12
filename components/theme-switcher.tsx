"use client"

import { useEffect, useState } from "react"
import { hslToHex, loadSavedTheme, setPrimaryColor } from "@/lib/theme"
import { cn } from "@/lib/utils"

const PRESETS = [
  { label: "Blue", value: "#3b82f6" },
  { label: "Violet", value: "#8b5cf6" },
  { label: "Emerald", value: "#10b981" },
  { label: "Amber", value: "#f59e0b" },
  { label: "Rose", value: "#f43f5e" },
]

export function ThemeSwitcher() {
  const [color, setColor] = useState("#3b82f6")

  useEffect(() => {
    const saved = loadSavedTheme()
    if (saved) {
      const hex = saved.startsWith("#") ? saved : hslToHex(saved)
      if (hex) {
        setColor(hex)
        return
      }
    }

    const current = getComputedStyle(document.documentElement)
      .getPropertyValue("--primary")
      .trim()
    const fallback = hslToHex(current) ?? "#3b82f6"
    setColor(fallback)
  }, [])

  function handleChange(next: string) {
    setColor(next)
    setPrimaryColor(next)
  }

  return (
    <div className="space-y-2">
      <label className="text-xs font-medium text-muted-foreground">
        Primary Color
      </label>
      <div className="flex items-center gap-2">
        <input
          aria-label="Primary Color"
          type="color"
          value={color}
          onChange={(e) => handleChange(e.target.value)}
          className="h-8 w-10 cursor-pointer rounded-md border border-border bg-transparent"
        />
        <div className="text-xs font-mono text-muted-foreground">{color}</div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset.value}
            type="button"
            onClick={() => handleChange(preset.value)}
            className={cn(
              "h-6 w-6 rounded-full border border-border",
              color.toLowerCase() === preset.value.toLowerCase()
                ? "ring-2 ring-primary/50"
                : "hover:ring-2 hover:ring-foreground/20"
            )}
            style={{ backgroundColor: preset.value }}
            aria-label={preset.label}
            title={preset.label}
          />
        ))}
      </div>
    </div>
  )
}
