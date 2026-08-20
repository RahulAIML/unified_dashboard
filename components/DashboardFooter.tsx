'use client'

import { useT } from '@/lib/lang-store'

// Inside (authenticated dashboard) pages only -- deliberately just the
// confidentiality notice, not the full marketing footer (address, contact
// info, social links) LandingPage.tsx shows on the public site. A client
// user working inside their own dashboard doesn't need Rolplay's own phone
// number or LinkedIn link on every single page.
export function DashboardFooter() {
  const t = useT()

  return (
    <footer className="border-t border-border bg-background/60 px-4 py-4 sm:px-6">
      <p className="text-center text-xs font-medium tracking-wide text-muted-foreground" data-testid="dashboard-confidentiality">
        {t.dashboardConfidentiality}
      </p>
    </footer>
  )
}
