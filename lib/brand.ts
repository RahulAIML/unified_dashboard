/**
 * lib/brand.ts — single source of truth for client branding.
 */

export const brand = {
  /** Displayed in sidebar, browser tab, and page <title> */
  appName: "Rolplay",

  /** Hex — maps to CSS --primary (buttons, active states, links) */
  primaryColor: "#DC2626",

  /** Hex — secondary accent (stripes, badges) */
  accentColor: "#DC2626",

  /** Path relative to /public — shown in sidebar top-left */
  logo: "/logo.jpg",

  /** Alt text for the logo */
  logoAlt: "Rolplay",

  /**
   * Hardcoded hex palette for Recharts (CSS variables don't work in SVG fill/stroke).
   * Index 0 = primary red, rest = red/dark family.
   */
  chartColors: [
    "#DC2626", // red-600
    "#991B1B", // red-800
    "#EF4444", // red-500
    "#B91C1C", // red-700
    "#F87171", // red-400
    "#7F1D1D", // red-900
    "#FCA5A5", // red-300
    "#450A0A", // red-950
  ],
} as const

export type Brand = typeof brand
