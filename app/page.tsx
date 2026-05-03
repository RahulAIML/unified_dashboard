'use client'

import { useAuthContext } from '@/components/AuthProvider'
import { DashboardContent } from '@/components/DashboardContent'
import { LandingPage } from '@/components/LandingPage'

export default function Home() {
  const { isLoading, isAuthenticated } = useAuthContext()

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="mb-4 text-muted-foreground">Loading...</div>
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
        </div>
      </div>
    )
  }

  return isAuthenticated ? <DashboardContent /> : <LandingPage />
}
