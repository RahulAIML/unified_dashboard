import type { Metadata } from "next";
import type { CSSProperties } from "react"
import { Inter } from "next/font/google"
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { ClientBrandProvider } from "@/components/ClientBrandProvider";
import { AuthProvider } from "@/components/AuthProvider";
import { LayoutContent } from "@/components/LayoutContent";

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

export const metadata: Metadata = {
  title: "Analytics Dashboard",
  description: "Unified analytics dashboard",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`h-full ${inter.variable}`}
      style={fontVars as CSSProperties}
    >
      <body className="h-full antialiased">
        <ThemeProvider>
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
