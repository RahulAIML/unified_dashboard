'use client'

import { useEffect } from 'react'
import { useLangStore, useLangHydration } from '@/lib/lang-store'

/**
 * Two jobs, both global and render-free:
 *
 *  1. Applies the persisted language choice once after hydration. The store
 *     intentionally starts at the server's locale so the first client render
 *     matches the server HTML; this is what actually adopts the user's saved
 *     preference (see lib/lang-store.ts for why it is not seeded directly).
 *  2. Keeps <html lang="…"> in sync with the active UI locale, which stops
 *     Chrome's auto-translate from mis-identifying the page language and
 *     converting brand names like "Rolplay" into "Roleplay".
 */
export function HtmlLangSync() {
  useLangHydration()
  const lang = useLangStore((s) => s.lang)

  useEffect(() => {
    document.documentElement.lang = lang
  }, [lang])

  return null
}
