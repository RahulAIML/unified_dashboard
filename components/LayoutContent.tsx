'use client'

import { usePathname } from 'next/navigation'
import { Sidebar } from '@/components/Sidebar'
import { AIAssistant } from '@/components/ai-assistant'
import { useAuthContext } from '@/components/AuthProvider'

const AUTH_ROUTES = ['/auth/login', '/auth/register']

export function LayoutContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { isAuthenticated, isLoading } = useAuthContext()

  const isAuthRoute = AUTH_ROUTES.some(route => pathname.startsWith(route))

  // Show sidebar for every route EXCEPT auth pages and the landing page.
  // Home page (/) shows the dashboard when authenticated, so sidebar must be
  // visible there too. We wait for auth to resolve before deciding (isLoading)
  // so there's no sidebar flash on unauthenticated visits to /.
  const showSidebar = !isAuthRoute && !isLoading && isAuthenticated

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
