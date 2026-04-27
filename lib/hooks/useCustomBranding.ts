'use client'

import { useState, useEffect, useCallback } from 'react'

export interface CustomBrand {
  logo?: string // base64 or URL
  primaryColor: string
  secondaryColor: string
  accentColor: string
  chartColor1: string
  chartColor2: string
}

const DEFAULT_BRAND: CustomBrand = {
  primaryColor: '#DC2626', // red
  secondaryColor: '#1F2937', // dark gray
  accentColor: '#F59E0B', // amber
  chartColor1: '#3B82F6', // blue
  chartColor2: '#10B981', // green
}

const STORAGE_KEY = 'custom-brand'

export function useCustomBranding() {
  const [brand, setBrand] = useState<CustomBrand>(DEFAULT_BRAND)
  const [loaded, setLoaded] = useState(false)

  // Load from localStorage on mount
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        setBrand(JSON.parse(stored))
      }
    } catch (err) {
      console.warn('Failed to load custom branding:', err)
    }
    setLoaded(true)
  }, [])

  // Save to localStorage whenever brand changes
  const updateBrand = useCallback((updates: Partial<CustomBrand>) => {
    setBrand((prev) => {
      const next = { ...prev, ...updates }
      if (typeof window !== 'undefined') {
        try {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
        } catch (err) {
          console.warn('Failed to save custom branding:', err)
        }
      }
      return next
    })
  }, [])

  const resetBrand = useCallback(() => {
    setBrand(DEFAULT_BRAND)
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEY)
    }
  }, [])

  const setLogoFromFile = useCallback((file: File) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      if (typeof e.target?.result === 'string') {
        updateBrand({ logo: e.target.result })
      }
    }
    reader.readAsDataURL(file)
  }, [updateBrand])

  return {
    brand,
    loaded,
    updateBrand,
    resetBrand,
    setLogoFromFile,
  }
}
