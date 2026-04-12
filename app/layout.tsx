import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Sidebar } from "@/components/Sidebar";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AIAssistant } from "@/components/ai-assistant";

const geistSans = Geist({
  variable: "--font-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "RolplayPro Analytics",
  description: "Unified analytics dashboard for RolplayPro",
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
      className={`${geistSans.variable} ${geistMono.variable} h-full`}
    >
      <body className="h-full antialiased">
        <ThemeProvider>
          <div className="flex h-full min-h-screen">
            <Sidebar />
            <main className="flex-1 overflow-auto bg-muted/30">
              {children}
            </main>
          </div>
          <AIAssistant />
        </ThemeProvider>
      </body>
    </html>
  );
}
