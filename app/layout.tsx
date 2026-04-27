import type { Metadata } from "next";
import type { CSSProperties } from "react"
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AIAssistant } from "@/components/ai-assistant";
import { ClientBrandProvider } from "@/components/ClientBrandProvider";

const FONT_SANS =
  'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, "Noto Sans", "Liberation Sans", sans-serif'
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
      className="h-full"
      style={fontVars as CSSProperties}
    >
      <body className="h-full antialiased">
        <ThemeProvider>
          <ClientBrandProvider />
          <div className="flex h-full min-h-screen">
            <Sidebar />
            <main className="flex-1 overflow-auto bg-muted/30 md:pt-0 pt-16">
              {children}
            </main>
          </div>
          <AIAssistant />
        </ThemeProvider>
      </body>
    </html>
  );
}
