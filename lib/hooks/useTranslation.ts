'use client'

import { useState, useCallback, useRef } from 'react'

type Language = 'en' | 'es'

interface TranslationCache {
  [key: string]: {
    en: string
    es: string
  }
}

const CACHE_KEY = 'drilldown-translations'

export function useTranslation() {
  const [language, setLanguage]     = useState<Language>('en')
  const [translating, setTranslating] = useState(false)
  const cacheRef = useRef<TranslationCache>({})

  // Expose setLanguage so callers can sync with external lang stores
  const setLang = useCallback((lang: Language) => {
    setLanguage(lang)
  }, [])

  // ── Cache helpers ────────────────────────────────────────────────────────────
  const getCache = useCallback((): TranslationCache => {
    if (typeof window === 'undefined') return cacheRef.current
    if (Object.keys(cacheRef.current).length === 0) {
      try {
        const stored = sessionStorage.getItem(CACHE_KEY)
        if (stored) cacheRef.current = JSON.parse(stored)
      } catch { /* ignore */ }
    }
    return cacheRef.current
  }, [])

  const saveCache = useCallback(() => {
    if (typeof window === 'undefined') return
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(cacheRef.current))
    } catch { /* ignore */ }
  }, [])

  // ── Batch translate (single AI call for N strings) ───────────────────────────
  /**
   * Translates an array of strings in ONE API call.
   * Cached items are skipped. Returns results in the same order as input.
   */
  const translateTexts = useCallback(
    async (texts: string[], targetLang: Language): Promise<string[]> => {
      if (!texts.length) return texts

      const cache = getCache()

      // Split: cached vs. uncached
      const results: string[] = Array(texts.length)
      const toTranslate: { idx: number; text: string }[] = []

      for (let i = 0; i < texts.length; i++) {
        const t = texts[i]
        if (!t?.trim()) {
          results[i] = t
        } else if (cache[t]?.[targetLang]) {
          results[i] = cache[t][targetLang]
        } else {
          toTranslate.push({ idx: i, text: t })
        }
      }

      if (toTranslate.length === 0) return results

      setTranslating(true)
      try {
        const itemList = toTranslate
          .map((x, i) => `${i + 1}. ${x.text}`)
          .join('\n')

        const langName = targetLang === 'es' ? 'Spanish' : 'English'

        const response = await fetch('/api/ai', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            prompt: [
              `Translate the following numbered items to ${langName}.`,
              `Return ONLY a JSON array of translated strings in the same order, e.g. ["a","b","c"].`,
              `Do not include numbers or extra text in the array values.`,
              ``,
              `Items:`,
              itemList,
            ].join('\n'),
          }),
        })

        if (response.ok) {
          const json  = await response.json()
          // API shape: { success: true, data: { answer: "..." }, meta: {} }
          const raw   = (json?.data?.answer ?? '').trim()
          // Extract the JSON array from the AI response
          const match = raw.match(/\[[\s\S]*\]/)
          if (match) {
            let parsed: unknown
            try { parsed = JSON.parse(match[0]) } catch { /* ignore */ }
            if (Array.isArray(parsed)) {
              for (let j = 0; j < toTranslate.length; j++) {
                const { idx, text } = toTranslate[j]
                const translated    = typeof parsed[j] === 'string' ? parsed[j].trim() : text
                results[idx] = translated
                if (!cache[text]) cache[text] = { en: text, es: text }
                cache[text][targetLang] = translated
              }
              cacheRef.current = cache
              saveCache()
              return results
            }
          }
        }
      } catch (err) {
        console.warn('Batch translation error:', err)
      } finally {
        setTranslating(false)
      }

      // Fallback: fill any untranslated slots with original text
      for (const { idx, text } of toTranslate) {
        if (results[idx] === undefined) results[idx] = text
      }
      return results
    },
    [getCache, saveCache]
  )

  // ── Single-item helper (uses batch internally) ────────────────────────────────
  const translateText = useCallback(
    async (text: string, targetLang: Language): Promise<string> => {
      const results = await translateTexts([text], targetLang)
      return results[0] ?? text
    },
    [translateTexts]
  )

  const toggleLanguage = useCallback(() => {
    setLanguage(prev => (prev === 'en' ? 'es' : 'en'))
  }, [])

  return {
    language,
    setLanguage: setLang,
    toggleLanguage,
    translateText,
    translateTexts,
    translating,
  }
}
