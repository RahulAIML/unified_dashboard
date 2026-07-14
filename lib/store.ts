import { create } from 'zustand'
import type { Module, DateRange } from './types'

interface DashboardState {
  selectedModules: Module[]
  selectedSolution: Module | null
  dateRange: DateRange
  /**
   * True once the range has been set to the authenticated tenant's real data
   * span (see useSnapDateRange) OR changed by the user. The one-time snap only
   * fires while this is false, so it never clobbers a range the user picked.
   */
  rangeInitialized: boolean
  refreshKey: number
  setModules: (modules: Module[]) => void
  setDateRange: (range: DateRange) => void
  /** Auto-snap to the tenant's data bounds — only honored before the user touches the picker. */
  initializeDateRange: (range: DateRange) => void
  toggleModule: (module: Module) => void
  setSolution: (solution: Module | null) => void
  setSolutionDirect: (solution: Module | null) => void
  triggerRefresh: () => void
}

const ALL_MODULES: Module[] = ['lms', 'coach', 'simulator', 'certification', 'second-brain']

// Default window must show a tenant's full history on first load, not just
// "recent activity". These are analytics over accumulated training sessions:
// a tenant like Apotex has 772 real sessions spanning Oct 2025–Jun 2026, but a
// 30-day default surfaced only ~3 of them (the June tail), which read as "the
// dashboard isn't querying the data". A 24-month rolling window currently
// covers every onboarded tenant's entire dataset (platform data begins late
// 2025) while keeping the "vs previous period" comparison meaningful. Users
// narrow via the date picker; they should never have to widen it just to see
// data that already exists.
const DEFAULT_RANGE_MONTHS = 24

function defaultRange(): DateRange {
  const to = new Date()
  const from = new Date()
  from.setMonth(from.getMonth() - DEFAULT_RANGE_MONTHS)
  return { from, to }
}

export const useDashboardStore = create<DashboardState>((set) => ({
  selectedModules: ALL_MODULES,
  selectedSolution: null,
  dateRange: defaultRange(),
  rangeInitialized: false,
  refreshKey: 0,

  setModules: (modules) => set({ selectedModules: modules }),
  // A user-driven change locks the range: the auto-snap must not override it.
  setDateRange: (dateRange) => set({ dateRange, rangeInitialized: true }),
  initializeDateRange: (dateRange) =>
    set((state) => (state.rangeInitialized ? state : { dateRange, rangeInitialized: true })),
  triggerRefresh: () => set((state) => ({ refreshKey: state.refreshKey + 1 })),

  toggleModule: (module) =>
    set((state) => ({
      selectedModules: state.selectedModules.includes(module)
        ? state.selectedModules.filter((value) => value !== module)
        : [...state.selectedModules, module],
    })),

  setSolution: (solution) =>
    set((state) => ({
      selectedSolution: state.selectedSolution === solution ? null : solution,
    })),

  setSolutionDirect: (solution) => set({ selectedSolution: solution }),
}))
