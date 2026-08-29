import { createContext, useContext } from 'react'
import type { DataAPI, Exercise, Settings, Workout } from './types'

export type Screen =
  | { name: 'home' }
  | { name: 'routines' }
  | { name: 'workout'; exerciseId?: string }
  | { name: 'scan' }
  | { name: 'machine'; machineId?: string; modelId?: string; qrUrl?: string }
  | { name: 'food' }
  | { name: 'history' }
  | { name: 'body' }
  | { name: 'summary'; workoutId: string }

export interface AppCtx {
  api: DataAPI
  go: (s: Screen) => void
  screen: Screen
  settings: Settings
  refreshSettings: () => Promise<void>
  activeWorkout: Workout | undefined
  setActiveWorkout: (w: Workout | undefined) => void
  /** exercise catalog preloaded for instant name lookups */
  exercises: Map<string, Exercise>
  startRest: (seconds?: number) => void
}

export const Ctx = createContext<AppCtx | null>(null)

export function useApp(): AppCtx {
  const ctx = useContext(Ctx)
  if (!ctx) throw new Error('useApp outside provider')
  return ctx
}
