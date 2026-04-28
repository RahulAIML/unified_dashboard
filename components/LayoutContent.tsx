'use client'

import { usePathname } from 'next/navigation'
import { Sidebar } from '@/components/Sidebar'
import { AIAssistant } from '@/components/ai-assistant'

const AUTH_ROUTES = ['/auth/login', '/auth/register']

export function LayoutContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const isAuthRoute = AUTH_ROUTES.some(route => pathname.startsWith(route))
  const showSidebar = !isAuthRoute

  return (
    <div className="flex h-full min-h-screen">
      {showSidebar && <Sidebar />}
      <main className={`flex-1 overflow-auto bg-muted/30 ${showSidebar ? 'md:pt-0 pt-16' : ''}`}>
        {children}
      </main>
      {showSidebar && <AIAssistant />}
    </div>
  )
}
