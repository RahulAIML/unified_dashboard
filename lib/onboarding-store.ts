import { create } from 'zustand'

interface OnboardingState {
  isOpen: boolean
  open: () => void
  close: () => void
}

/**
 * Purely a "is the tour modal open" flag. Persistence of WHETHER it should
 * auto-open again lives server-side (users.onboarding_completed_at, via
 * AuthUser) -- this store only controls whether it's currently visible,
 * so Settings' "Replay guided tour" can open it without any DB round-trip.
 */
export const useOnboardingStore = create<OnboardingState>((set) => ({
  isOpen: false,
  open: () => set({ isOpen: true }),
  close: () => set({ isOpen: false }),
}))
