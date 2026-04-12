"use client"

import { createContext, useContext, useEffect, useState } from "react"
import { loadSavedTheme } from "@/lib/theme"

type Theme = "light" | "dark"

const ThemeContext = createContext<{
  theme: Theme
  toggle: () => void
}>({ theme: "light", toggle: () => {} })

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [theme, setTheme] = useState<Theme>("light")

  useEffect(() => {
    loadSavedTheme()
    const stored = localStorage.getItem("theme") as Theme | null
    if (stored) setTheme(stored)
    else if (window.matchMedia("(prefers-color-scheme: dark)").matches) setTheme("dark")
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark")
    localStorage.setItem("theme", theme)
  }, [theme])

  return (
    <ThemeContext.Provider value={{ theme, toggle: () => setTheme(t => t === "light" ? "dark" : "light") }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
