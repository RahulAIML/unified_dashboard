"use client"

import { createContext, useContext, useEffect, useReducer } from "react"
import { loadSavedTheme } from "@/lib/theme"

type Theme = "light" | "dark"

const ThemeContext = createContext<{
  theme: Theme
  toggle: () => void
}>({ theme: "light", toggle: () => {} })

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  type Action =
    | { type: "set"; theme: Theme }
    | { type: "toggle" }

  const [theme, dispatch] = useReducer(
    (s: Theme, a: Action): Theme => {
      switch (a.type) {
        case "set":
          return a.theme
        case "toggle":
          return s === "light" ? "dark" : "light"
        default:
          return s
      }
    },
    "light"
  )

  useEffect(() => {
    loadSavedTheme()
    // Always start light on first landing, regardless of OS/browser dark-mode
    // preference -- a user can still switch to dark via toggle(), and that
    // choice is what gets saved and restored below, every time after.
    const stored = localStorage.getItem("theme") as Theme | null
    if (stored) dispatch({ type: "set", theme: stored })
  }, [])

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark")
    localStorage.setItem("theme", theme)
  }, [theme])

  return (
    <ThemeContext.Provider value={{ theme, toggle: () => dispatch({ type: "toggle" }) }}>
      {children}
    </ThemeContext.Provider>
  )
}

export const useTheme = () => useContext(ThemeContext)
