"use client"

import { useEffect } from 'react'
import { create } from 'zustand'
import { translations } from './translations'
import type { Lang } from './translations'

const STORAGE_KEY = 'rp-lang'

/**
 * The locale the SERVER renders with. The store must start here on the client
 * too, or the first client render disagrees with the server HTML.
 */
const SSR_LANG: Lang = 'es'

function readStoredLang(): Lang | null {
  if (typeof window === 'undefined') return null
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'en' || stored === 'es') return stored
  } catch {
    // localStorage blocked (private mode, etc.)
  }
  return null
}

interface LangState {
  lang: Lang
  /** False until the stored preference has been applied post-hydration. */
  hydrated: boolean
  toggle: () => void
  setLang: (lang: Lang) => void
  hydrateFromStorage: () => void
}

export const useLangStore = create<LangState>((set, get) => ({
  // Deliberately NOT seeded from localStorage.
  //
  // It used to be, which meant a user with rp-lang="en" got Spanish server HTML
  // and an English first client render -- React error #418 (hydration text
  // mismatch) on every page load, observed live on the landing page. React then
  // throws away the server markup and re-renders on the client, which both
  // costs the SSR benefit and can flash the wrong language. The stored
  // preference is applied in an effect instead, after hydration has completed.
  lang: SSR_LANG,
  hydrated: false,
  toggle: () =>
    set((s) => {
      const next: Lang = s.lang === 'en' ? 'es' : 'en'
      try { window.localStorage.setItem(STORAGE_KEY, next) } catch { /* ignore */ }
      return { lang: next }
    }),
  setLang: (lang: Lang) => {
    try { window.localStorage.setItem(STORAGE_KEY, lang) } catch { /* ignore */ }
    set({ lang })
  },
  hydrateFromStorage: () => {
    if (get().hydrated) return
    const stored = readStoredLang()
    set(stored && stored !== get().lang ? { lang: stored, hydrated: true } : { hydrated: true })
  },
}))

/**
 * Applies the persisted language choice once, after hydration. Mounted globally
 * by HtmlLangSync so every route picks the preference up.
 */
export function useLangHydration(): void {
  const hydrateFromStorage = useLangStore((s) => s.hydrateFromStorage)
  useEffect(() => { hydrateFromStorage() }, [hydrateFromStorage])
}

export function useT() {
  const { lang } = useLangStore()
  return translations[lang]
}
