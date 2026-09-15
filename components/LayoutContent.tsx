'use client'

import { usePathname } from 'next/navigation'
import { Sidebar } from '@/components/Sidebar'
import { AIAssistant } from '@/components/ai-assistant'
import { DashboardFooter } from '@/components/DashboardFooter'
import { OnboardingTour } from '@/components/OnboardingTour'
import { useAuthContext } from '@/components/AuthProvider'
import { useSnapDateRange } from '@/lib/hooks/useSnapDateRange'
import { cn } from '@/lib/utils'

const AUTH_ROUTES = ['/auth/login', '/auth/register']

export function LayoutContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { isAuthenticated, isLoading } = useAuthContext()

  // Snap the default date range to the tenant's real data span, once, after
  // login. Internally gated on auth + rangeInitialized, so it's safe to mount
  // here (the single wrapper around every authenticated page).
  useSnapDateRange()

  const isAuthRoute = AUTH_ROUTES.some(route => pathname.startsWith(route))

  // Show sidebar for every route EXCEPT auth pages and the landing page.
  // Home page (/) shows the dashboard when authenticated, so sidebar must be
  // visible there too. We wait for auth to resolve before deciding (isLoading)
  // so there's no sidebar flash on unauthenticated visits to /.
  const showSidebar = !isAuthRoute && !isLoading && isAuthenticated

  return (
    <div className="flex h-full min-h-screen overflow-hidden">
      {showSidebar && <Sidebar />}
      <div className={cn(
        "flex-1 flex flex-col overflow-x-hidden overflow-y-auto relative z-0",
        // pt-14 clears the sidebar's own mobile hamburger bar; bg-muted/30
        // tints the dashboard chrome. Neither applies without a sidebar --
        // the landing/auth pages manage their own full-bleed background and
        // have no hamburger bar to clear, so this used to leave a stray
        // ~56px band of bg-muted showing above unauthenticated pages on
        // mobile-width viewports (invisible on the old white landing page,
        // visible now that it's dark).
        showSidebar && "bg-muted/30 md:pt-0 pt-14"
      )}>
        <main className="flex-1 pb-6 md:pb-10 w-full">
          {children}
        </main>
        {showSidebar && <DashboardFooter />}
      </div>
      {showSidebar && <AIAssistant />}
      {showSidebar && <OnboardingTour />}
    </div>
  )
}
