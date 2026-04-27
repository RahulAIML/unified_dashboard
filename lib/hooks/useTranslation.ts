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
  const [language, setLanguage] = useState<Language>('en')
  const [translating, setTranslating] = useState(false)
  const cacheRef = useRef<TranslationCache>({})

  // Load cache from sessionStorage on first use
  const getCache = useCallback(() => {
    if (typeof window === 'undefined') return cacheRef.current
    if (Object.keys(cacheRef.current).length === 0) {
      try {
        const stored = sessionStorage.getItem(CACHE_KEY)
        if (stored) {
          cacheRef.current = JSON.parse(stored)
        }
      } catch (err) {
        console.warn('Failed to load translation cache:', err)
      }
    }
    return cacheRef.current
  }, [])

  // Save cache to sessionStorage
  const saveCache = useCallback(() => {
    if (typeof window === 'undefined') return
    try {
      sessionStorage.setItem(CACHE_KEY, JSON.stringify(cacheRef.current))
    } catch (err) {
      console.warn('Failed to save translation cache:', err)
    }
  }, [])

  // Translate text using Claude API
  const translateText = useCallback(
    async (text: string, targetLang: Language): Promise<string> => {
      if (!text || !text.trim()) return text

      const cache = getCache()

      // Check cache first
      if (cache[text] && cache[text][targetLang]) {
        return cache[text][targetLang]
      }

      try {
        setTranslating(true)

        const response = await fetch('/api/ai', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prompt: `Translate the following text to ${targetLang === 'es' ? 'Spanish' : 'English'}. Only return the translated text, nothing else.\n\nText: "${text}"`,
          }),
        })

        if (!response.ok) {
          console.warn('Translation API error:', response.status)
          return text
        }

        const data = await response.json()
        const translated = data?.data?.trim() || text

        // Update cache
        if (!cache[text]) {
          cache[text] = { en: text, es: text }
        }
        cache[text][targetLang] = translated
        cacheRef.current = cache
        saveCache()

        return translated
      } catch (err) {
        console.warn('Translation error:', err)
        return text
      } finally {
        setTranslating(false)
      }
    },
    [getCache, saveCache]
  )

  // Translate multiple texts
  const translateTexts = useCallback(
    async (texts: string[], targetLang: Language): Promise<string[]> => {
      return Promise.all(texts.map((text) => translateText(text, targetLang)))
    },
    [translateText]
  )

  const toggleLanguage = useCallback(() => {
    setLanguage((prev) => (prev === 'en' ? 'es' : 'en'))
  }, [])

  return {
    language,
    toggleLanguage,
    translateText,
    translateTexts,
    translating,
  }
}
