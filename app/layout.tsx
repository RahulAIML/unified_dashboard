import type { Metadata } from "next";
import type { CSSProperties } from "react"
import { Inter } from "next/font/google"
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ClientBrandProvider } from "@/components/ClientBrandProvider";
import { AuthProvider } from "@/components/AuthProvider";
import { LayoutContent } from "@/components/LayoutContent"
import { HtmlLangSync } from "@/components/HtmlLangSync";

// ── Inter — primary SaaS font ─────────────────────────────────────────────────
const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
  weight: ["400", "500", "600", "700"],
})

// Put Inter first so it loads when the CSS var resolves
const FONT_SANS =
  'var(--font-inter), ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif'
const FONT_MONO =
  'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'

const fontVars = {
  "--font-sans": FONT_SANS,
  "--font-geist-mono": FONT_MONO,
} satisfies Record<string, string>

// Static server-rendered metadata cannot react to the client-side language
// toggle (it's in <head> before any client store exists), so it's set to
// match SSR_LANG (lib/lang-store.ts's default, 'es') rather than left in
// English -- the objective is a Spanish-by-default experience, and this is
// the one piece of text that can't reactively follow a later toggle anyway.
export const metadata: Metadata = {
  title: "Panel de Analítica",
  description: "Panel de analítica unificado",
  // Paired with the <html translate="no"> / notranslate class below --
  // this is the half that opts out of Google's translate service itself
  // (the address-bar prompt, not just the inline DOM attribute).
  other: { google: "notranslate" },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      // Root cause of the "Failed to execute 'insertBefore'/'removeChild' on
      // Node: ... is not a child of this node" crash reported live (and
      // independently confirmed via Sentry on a DIFFERENT, unrelated app in
      // the same org -- same error, different codebase/React version,
      // meaning it was never an app bug): Chrome's page-translate feature
      // rewrites the DOM by wrapping translated text nodes in extra <font>
      // elements outside React's control. The very next time React tries to
      // update that subtree (any click that re-renders anything -- a theme
      // toggle, a nav click), its virtual DOM no longer matches the real
      // DOM and insertBefore/removeChild throws, crashing the whole page
      // until a hard reload resets the DOM. HtmlLangSync.tsx already keeps
      // <html lang> correct so Chrome doesn't AUTO-offer translation, but
      // that never stopped a user from manually triggering it (likely here:
      // Spanish-speaking users on a bilingual EN/ES app) -- translate="no"
      // + notranslate opts the whole app out, which is the only fix that
      // actually prevents the DOM rewrite instead of reacting to it.
      translate="no"
      className={`h-full notranslate ${inter.variable}`}
      suppressHydrationWarning
      style={fontVars as CSSProperties}
    >
      <body className="h-full antialiased">
        <ThemeProvider>
          <HtmlLangSync />
          <AuthProvider>
            <ClientBrandProvider>
              <LayoutContent>{children}</LayoutContent>
            </ClientBrandProvider>
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
