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
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="es"
      suppressHydrationWarning
      className={`h-full ${inter.variable}`}
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
