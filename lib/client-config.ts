/**
 * client-config.ts — multi-tenant branding registry.
 *
 * Each key is a client ID used as the ?client=<id> URL query param.
 * Switching client applies branding (logo, colours) only.
 * DB-level filtering is a future concern (J30 full implementation).
 *
 * ─── Adding a new client ───────────────────────────────────────────────────
 *  1. Add an entry to CLIENTS below.
 *  2. Drop the client logo in /public/<logo-file>.
 *  3. Share the dashboard URL with ?client=<id> appended.
 * ──────────────────────────────────────────────────────────────────────────
 */

export interface ClientBrand {
  name:         string
  logo:         string      // path relative to /public
  logoAlt:      string
  /** HSL triple for --primary in light mode: "H S% L%" */
  primaryHslLight: string
  /** HSL triple for --primary in dark mode: "H S% L%" */
  primaryHslDark:  string
  /** HSL triple for brand accent: "H S% L%" (use sparingly) */
  accentHsl:       string
  /** HSL triple for tertiary (blue): "H S% L%" */
  tertiaryHslLight?: string
  tertiaryHslDark?: string
  /** HSL triple for chart colors */
  chart1Hsl?: string
  chart2Hsl?: string
}

export const CLIENTS: Record<string, ClientBrand> = {
  rolplay: {
    name:         "Rolplay Analytics",
    logo:         "/logo.jpg",
    logoAlt:      "Rolplay",
    primaryHslLight: "0 72% 51%",    // #DC2626 red (dominant)
    primaryHslDark:  "0 75% 58%",    // Slightly brighter for dark mode
    // Tertiary: blue (supporting color)
    tertiaryHslLight: "217 91% 60%",  // #3B82F6 blue
    tertiaryHslDark:  "217 91% 64%",  // Slightly brighter for dark mode
    // Accent: teal (softer than amber)
    accentHsl:       "168 76% 52%",   // #14B8A6 teal
    // Chart colors
    chart1Hsl:       "217 91% 60%",   // #3B82F6 blue
    chart2Hsl:       "188 94% 56%",   // #06B6D4 cyan
  },

  coppel: {
    name:         "Coppel Analytics",
    logo:         "/coppel.png",
    logoAlt:      "Coppel",
    // Approx from the client brand palette (blue primary + yellow accent)
    primaryHslLight: "212 100% 36%",
    primaryHslDark:  "212 100% 48%",
    accentHsl:       "49 100% 50%",
  },
}

export const DEFAULT_CLIENT_ID = "rolplay"

/**
 * Returns the brand config for a given client ID.
 * Falls back to the default (rolplay) when the ID is unknown or absent.
 */
export function getClientBrand(clientId: string | null | undefined): ClientBrand {
  if (!clientId) return CLIENTS[DEFAULT_CLIENT_ID]
  return CLIENTS[clientId] ?? CLIENTS[DEFAULT_CLIENT_ID]
}
