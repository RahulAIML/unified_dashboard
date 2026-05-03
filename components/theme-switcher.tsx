"use client"

import { Moon, Sun } from "lucide-react"
import { useTheme } from "@/components/ThemeProvider"
import { cn } from "@/lib/utils"

/**
 * Theme switcher (light/dark only).
 *
 * Brand colors are derived from the active tenant (clientId) via ClientBrandProvider
 * and must not be overridden here.
 */
export function ThemeSwitcher({ className }: { className?: string }) {
  const { theme, toggle } = useTheme()
  const isDark = theme === "dark"

  return (
    <button
      type="button"
      onClick={toggle}
      className={cn(
        "inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm",
        "bg-muted/40 hover:bg-muted/60 transition-colors",
        className
      )}
      aria-label="Toggle theme"
      title={isDark ? "Switch to light" : "Switch to dark"}
    >
      {isDark ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
      <span className="font-medium">{isDark ? "Dark" : "Light"}</span>
    </button>
  )
}

