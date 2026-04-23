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
  primaryColor: string      // hex — buttons, active states, links
  accentColor:  string      // hex — stripes, badges
  chartColors:  string[]    // hex palette for Recharts SVG fills
}

export const CLIENTS: Record<string, ClientBrand> = {
  rolplay: {
    name:         "Rolplay Analytics",
    logo:         "/logo.jpg",
    logoAlt:      "Rolplay",
    primaryColor: "#DC2626",
    accentColor:  "#DC2626",
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
  },

  coppel: {
    name:         "Coppel Analytics",
    logo:         "/coppel.png",
    logoAlt:      "Coppel",
    primaryColor: "#0057B8",
    accentColor:  "#FFD100",
    chartColors: [
      "#0057B8", // blue primary
      "#003D82", // blue dark
      "#1A6FD4", // blue mid
      "#FFD100", // yellow accent
      "#FFC200", // yellow dark
      "#004EA3", // blue deeper
      "#338FE8", // blue light
      "#002B5C", // blue darkest
    ],
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
