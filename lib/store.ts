import { create } from 'zustand'
import type { Module, DateRange } from './types'

interface DashboardState {
  selectedModules: Module[]
  /** Single-solution KPI filter. null = "All solutions" */
  selectedSolution: Module | null
  dateRange: DateRange
  setModules:   (modules: Module[]) => void
  setDateRange: (range: DateRange) => void
  toggleModule: (module: Module) => void
  setSolution:  (solution: Module | null) => void
}

const ALL_MODULES: Module[] = ['lms', 'coach', 'simulator', 'certification', 'second-brain']

function defaultRange(): DateRange {
  const to   = new Date()
  const from = new Date()
  from.setDate(from.getDate() - 30)
  return { from, to }
}

export const useDashboardStore = create<DashboardState>((set) => ({
  selectedModules:  ALL_MODULES,
  selectedSolution: null,
  dateRange:        defaultRange(),

  setModules:   (modules)   => set({ selectedModules: modules }),
  setDateRange: (dateRange) => set({ dateRange }),

  toggleModule: (module) =>
    set((state) => ({
      selectedModules: state.selectedModules.includes(module)
        ? state.selectedModules.filter((m) => m !== module)
        : [...state.selectedModules, module],
    })),

  // clicking the already-active solution deselects → back to "All"
  setSolution: (solution) =>
    set((state) => ({
      selectedSolution: state.selectedSolution === solution ? null : solution,
    })),
}))
