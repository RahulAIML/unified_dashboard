"use client"

import { create } from 'zustand'
import { translations } from './translations'
import type { Lang } from './translations'

const STORAGE_KEY = 'rp-lang'

function getInitialLang(): Lang {
  if (typeof window === 'undefined') return 'es'
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY)
    if (stored === 'en' || stored === 'es') return stored
  } catch {
    // localStorage blocked (private mode, etc.)
  }
  return 'es'
}

interface LangState {
  lang: Lang
  toggle: () => void
  setLang: (lang: Lang) => void
}

export const useLangStore = create<LangState>((set) => ({
  lang: getInitialLang(),
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
}))

export function useT() {
  const { lang } = useLangStore()
  return translations[lang]
}
