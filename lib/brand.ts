/**
 * lib/brand.ts — single source of truth for client branding.
 *
 * To re-brand for a different demo:
 *  1. Update the values below
 *  2. Drop the logo file into /public/
 *  3. Done — no other files need touching.
 */

export const brand = {
  /** Displayed in sidebar, browser tab, and page <title> */
  appName: "Coppel Analytics",

  /** Hex — maps to CSS --primary (buttons, active states, links) */
  primaryColor: "#1E40AF",

  /** Hex — Coppel yellow (highlights, second series in charts) */
  accentColor: "#FACC15",

  /** Path relative to /public — shown in sidebar top-left */
  logo: "/logo.jpg",

  /** Alt text for the logo */
  logoAlt: "Coppel",

  /**
   * Hardcoded hex palette for Recharts (CSS variables don't work in SVG fill/stroke).
   * Index 0 = primary blue, Index 1 = yellow, rest = blue/yellow family.
   */
  chartColors: [
    "#1E40AF", // Coppel blue
    "#FACC15", // Coppel yellow
    "#2563EB", // blue-600
    "#FDE68A", // yellow-200
    "#1D4ED8", // blue-700
    "#FCD34D", // yellow-300
    "#3B82F6", // blue-500
    "#60A5FA", // blue-400
  ],
} as const

export type Brand = typeof brand
