'use client'

import Link from 'next/link'
import { APP_NAME } from '@/lib/constants'
import { useT } from '@/lib/lang-store'

export function DashboardFooter() {
  const t = useT()

  return (
    <footer className="border-t border-border bg-background/60 px-4 py-4 sm:px-6">
      <p className="mb-3 text-center text-xs font-medium tracking-wide text-muted-foreground" data-testid="dashboard-confidentiality">
        {t.dashboardConfidentiality}
      </p>
      <div className="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-muted-foreground">
        <div className="flex items-center gap-4 flex-wrap justify-center sm:justify-start">
          <span className="font-semibold text-foreground/70" translate="no">{APP_NAME}</span>
          <a href="https://rolplay.ai" target="_blank" rel="noopener noreferrer"
            className="hover:text-foreground transition-colors">rolplay.ai</a>
          <a href="mailto:info@rolplay.ai"
            className="hover:text-foreground transition-colors">info@rolplay.ai</a>
          <a href="tel:+525550937376"
            className="hover:text-foreground transition-colors">+52 (55) 5093 7376</a>
        </div>
        <div className="flex items-center gap-4">
          <span>Toronto · Monterrey · CDMX</span>
          <span className="text-muted-foreground/50">|</span>
          <Link href="/privacy" className="hover:text-foreground transition-colors">Privacy Policy</Link>
          <span className="text-muted-foreground/50">|</span>
          <a
            href="https://www.linkedin.com/company/rolplay"
            target="_blank" rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >LinkedIn</a>
          <a
            href="https://www.facebook.com/rolplay"
            target="_blank" rel="noopener noreferrer"
            className="hover:text-foreground transition-colors"
          >Facebook</a>
        </div>
      </div>
    </footer>
  )
}
