'use client'

import { useState, useEffect } from 'react'

const STORAGE_KEY = 'rp-platform-name'
const DEFAULT_NAME = 'Rolplay Analytics'

export function usePlatformName() {
  const [platformName, setPlatformName] = useState(DEFAULT_NAME)
  const [isLoaded, setIsLoaded] = useState(false)

  // Load from localStorage on mount
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const stored = window.localStorage.getItem(STORAGE_KEY)
      if (stored && stored.trim()) {
        setPlatformName(stored.trim())
      }
      setIsLoaded(true)
    } catch {
      setIsLoaded(true)
    }
  }, [])

  // Save to localStorage
  const savePlatformName = (name: string) => {
    const trimmed = name.trim()
    setPlatformName(trimmed || DEFAULT_NAME)
    try {
      if (trimmed) {
        window.localStorage.setItem(STORAGE_KEY, trimmed)
      } else {
        window.localStorage.removeItem(STORAGE_KEY)
      }
    } catch {
      // localStorage may be blocked
    }
  }

  return {
    platformName,
    setPlatformName: savePlatformName,
    isLoaded,
  }
}
