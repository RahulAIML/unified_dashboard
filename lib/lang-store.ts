"use client"

import { create } from 'zustand'
import { translations } from './translations'
import type { Lang } from './translations'

interface LangState {
  lang: Lang
  toggle: () => void
}

export const useLangStore = create<LangState>((set) => ({
  lang: 'en',
  toggle: () => set((s) => ({ lang: s.lang === 'en' ? 'es' : 'en' })),
}))

export function useT() {
  const { lang } = useLangStore()
  return translations[lang]
}
