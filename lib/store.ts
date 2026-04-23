import { create } from 'zustand'
import type { Module, DateRange } from './types'

interface DashboardState {
  selectedModules:  Module[]
  /** Single-solution KPI filter. null = "All solutions" */
  selectedSolution: Module | null
  dateRange:        DateRange
  /** Active client ID — set from ?client= URL param. null = default (rolplay). */
  clientId:         string | null
  /** Increment to force all useApi hooks to refetch */
  refreshKey:       number

  setModules:      (modules: Module[]) => void
  setDateRange:    (range: DateRange) => void
  toggleModule:    (module: Module) => void
  setSolution:     (solution: Module | null) => void
  setSolutionDirect: (solution: Module | null) => void
  setClientId:     (id: string) => void
  triggerRefresh:  () => void
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
  clientId:         null,
  refreshKey:       0,

  setModules:     (modules)  => set({ selectedModules: modules }),
  setDateRange:   (dateRange) => set({ dateRange }),
  setClientId:    (clientId)  => set({ clientId }),
  triggerRefresh: ()          => set((s) => ({ refreshKey: s.refreshKey + 1 })),

  toggleModule: (module) =>
    set((state) => ({
      selectedModules: state.selectedModules.includes(module)
        ? state.selectedModules.filter((m) => m !== module)
        : [...state.selectedModules, module],
    })),

  // Clicking the already-active solution deselects → back to "All"
  setSolution: (solution) =>
    set((state) => ({
      selectedSolution: state.selectedSolution === solution ? null : solution,
    })),

  setSolutionDirect: (solution) => set({ selectedSolution: solution }),
}))
