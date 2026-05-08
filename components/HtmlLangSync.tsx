'use client'

import { useEffect } from 'react'
import { useLangStore } from '@/lib/lang-store'

/**
 * Keeps the <html lang="…"> attribute in sync with the active UI locale.
 * This prevents Chrome's auto-translate feature from mis-identifying the page
 * language and converting brand names like "Rolplay" into "Roleplay".
 */
export function HtmlLangSync() {
  const lang = useLangStore((s) => s.lang)

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  return null
}
