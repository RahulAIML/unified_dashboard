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

  /** Hex — maps to CSS --brand-accent (charts, highlights, hover rings) */
  accentColor: "#FACC15",

  /** Path relative to /public — shown in sidebar top-left */
  logo: "/logo.jpg",

  /** Alt text for the logo */
  logoAlt: "Coppel",
} as const

export type Brand = typeof brand
