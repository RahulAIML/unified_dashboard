import { create } from 'zustand'
import type { Module, DateRange } from './types'

interface DashboardState {
  selectedModules: Module[]
  dateRange: DateRange
  setModules: (modules: Module[]) => void
  setDateRange: (range: DateRange) => void
  toggleModule: (module: Module) => void
}

const ALL_MODULES: Module[] = ['lms', 'coach', 'simulator', 'certification', 'second-brain']

function defaultRange(): DateRange {
  const to   = new Date()
  const from = new Date()
  from.setDate(from.getDate() - 30)
  return { from, to }
}

export const useDashboardStore = create<DashboardState>((set) => ({
  selectedModules: ALL_MODULES,
  dateRange: defaultRange(),
  setModules: (modules) => set({ selectedModules: modules }),
  setDateRange: (dateRange) => set({ dateRange }),
  toggleModule: (module) =>
    set((state) => ({
      selectedModules: state.selectedModules.includes(module)
        ? state.selectedModules.filter((m) => m !== module)
        : [...state.selectedModules, module],
    })),
}))
