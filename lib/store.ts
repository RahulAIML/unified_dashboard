import { create } from 'zustand'
import type { Module, DateRange } from './types'

interface DashboardState {
  selectedModules: Module[]
  selectedSolution: Module | null
  dateRange: DateRange
  refreshKey: number
  setModules: (modules: Module[]) => void
  setDateRange: (range: DateRange) => void
  toggleModule: (module: Module) => void
  setSolution: (solution: Module | null) => void
  setSolutionDirect: (solution: Module | null) => void
  triggerRefresh: () => void
}

const ALL_MODULES: Module[] = ['lms', 'coach', 'simulator', 'certification', 'second-brain']

function defaultRange(): DateRange {
  const to = new Date()
  const from = new Date()
  from.setDate(from.getDate() - 30)
  return { from, to }
}

export const useDashboardStore = create<DashboardState>((set) => ({
  selectedModules: ALL_MODULES,
  selectedSolution: null,
  dateRange: defaultRange(),
  refreshKey: 0,

  setModules: (modules) => set({ selectedModules: modules }),
  setDateRange: (dateRange) => set({ dateRange }),
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
