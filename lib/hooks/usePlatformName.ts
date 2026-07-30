'use client'

import { useState } from 'react'
import { useAuthContext } from '@/components/AuthProvider'

const STORAGE_PREFIX = 'rp-platform-name'
const DEFAULT_NAME = 'Rolplay Analytics'

/**
 * Per-user storage key.
 *
 * BUG THIS FIXES: the key used to be a single fixed string ('rp-platform-name'
 * with no suffix), so it lived in the BROWSER, not the account. Any two users
 * signed in on the same browser (exactly how multi-account testing works)
 * shared one localStorage bucket — one person's rename overwrote itself for
 * everyone else who logged in on that machine. Suffixing by user id gives each
 * signed-in account its own slot, so one user's customization can never leak
 * into another user's session.
 */
function storageKey(userId: number | null): string {
  return userId != null ? `${STORAGE_PREFIX}:${userId}` : STORAGE_PREFIX
}

function readStored(userId: number): string {
  if (typeof window === 'undefined') return DEFAULT_NAME
  try {
    const stored = window.localStorage.getItem(storageKey(userId))
    return stored && stored.trim() ? stored.trim() : DEFAULT_NAME
  } catch {
    return DEFAULT_NAME
  }
}

export function usePlatformName() {
  const { user } = useAuthContext()
  const [platformName, setPlatformNameState] = useState(DEFAULT_NAME)
  // Which user id `platformName` was last hydrated for. `undefined` means
  // "not hydrated yet"; distinct from `null`, which is a resolved
  // logged-out state — so isLoaded can't be true before auth resolves.
  const [hydratedFor, setHydratedFor] = useState<number | null | undefined>(undefined)

  // Read localStorage for the CURRENT user during render, not in an effect.
  // This is React's documented pattern for resetting/adjusting state when an
  // identity changes ("You Might Not Need An Effect"): keying off `user?.id`
  // and comparing against what we last hydrated for means the read only runs
  // once per user change, exactly like an effect would, but without the
  // effect's extra render pass — and, concretely, without the risk an effect
  // has here: a stale closure over the PREVIOUS user's id briefly rendering
  // their platform name before the effect catches up. See git history for
  // why that distinction matters: the previous version of this hook used one
  // unscoped key for every account, so the two users this replaces really did
  // see each other's saved name.
  if (user !== null && user?.id !== hydratedFor) {
    setHydratedFor(user.id)
    setPlatformNameState(readStored(user.id))
  }

  const isLoaded = user !== null && hydratedFor === user.id

  const savePlatformName = (name: string) => {
    const trimmed = name.trim()
    setPlatformNameState(trimmed || DEFAULT_NAME)
    try {
      const key = storageKey(user?.id ?? null)
      if (trimmed) {
        window.localStorage.setItem(key, trimmed)
      } else {
        window.localStorage.removeItem(key)
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
