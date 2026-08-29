import { useCallback, useEffect, useRef, useState } from 'react'
import api from './data'
import type { Exercise, Settings, Workout } from './types'
import { Ctx } from './AppContext'
import type { Screen } from './AppContext'
import { SYNC_APPLIED_EVENT } from './data/sync'
import { TabBar, TopNav } from './components/TabBar'
import { HomeScreen } from './screens/Home'
import { RoutinesScreen } from './screens/Routines'
import { WorkoutScreen } from './screens/Workout'
import { ScanScreen } from './screens/Scan'
import { MachineScreen } from './screens/Machine'
import { FoodScreen } from './screens/Food'
import { HistoryScreen } from './screens/History'
import { BodyScreen } from './screens/Body'
import { SummaryScreen } from './screens/Summary'

const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' })
  const [settings, setSettings] = useState<Settings | null>(null)
  const [exercises, setExercises] = useState<Map<string, Exercise> | null>(null)
  const [activeWorkout, setActiveWorkout] = useState<Workout | undefined>(undefined)
  const [restLeft, setRestLeft] = useState<number | null>(null)
  const [restTotal, setRestTotal] = useState(90)
  const restTimer = useRef<ReturnType<typeof setInterval> | null>(null)

  useEffect(() => {
    let alive = true
    Promise.all([api.getSettings(), api.listExercises(), api.getActiveWorkout()]).then(
      ([s, exs, w]) => {
        if (!alive) return
        setSettings(s)
        setExercises(new Map(exs.map((e) => [e.id, e])))
        setActiveWorkout(w)
      },
    )
    return () => { alive = false }
  }, [])

  const stopRest = useCallback(() => {
    if (restTimer.current) clearInterval(restTimer.current)
    restTimer.current = null
    setRestLeft(null)
  }, [])

  const startRest = useCallback(
    (seconds?: number) => {
      if (restTimer.current) clearInterval(restTimer.current)
      const total = seconds ?? settings?.restSeconds ?? 90
      const endsAt = Date.now() + total * 1000
      setRestTotal(total)
      setRestLeft(total)
      restTimer.current = setInterval(() => {
        const left = Math.round((endsAt - Date.now()) / 1000)
        if (left <= 0) stopRest()
        else setRestLeft(left)
      }, 250)
    },
    [settings, stopRest],
  )

  const go = useCallback(
    (s: Screen) => {
      if (s.name !== 'workout') stopRest()
      setScreen(s)
    },
    [stopRest],
  )

  const refreshSettings = useCallback(async () => {
    setSettings(await api.getSettings())
  }, [])

  // pulled sync records land in Dexie behind React's back; re-read shared state
  useEffect(() => {
    const onApplied = () => { void refreshSettings() }
    window.addEventListener(SYNC_APPLIED_EVENT, onApplied)
    return () => window.removeEventListener(SYNC_APPLIED_EVENT, onApplied)
  }, [refreshSettings])

  if (!settings || !exercises) {
    return <div className="shell" style={{ alignItems: 'center', justifyContent: 'center' }}>
      <p className="small">Loading…</p>
    </div>
  }

  return (
    <Ctx.Provider
      value={{
        api, go, screen, settings, refreshSettings,
        activeWorkout, setActiveWorkout, exercises, startRest,
      }}
    >
      <div className="shell">
        <TopNav />
        <div className="screen" key={JSON.stringify(screen)}>
          {screen.name === 'home' && <HomeScreen />}
          {screen.name === 'routines' && <RoutinesScreen />}
          {screen.name === 'workout' && <WorkoutScreen initialExerciseId={screen.exerciseId} />}
          {screen.name === 'scan' && <ScanScreen />}
          {screen.name === 'machine' && (
            <MachineScreen machineId={screen.machineId} modelId={screen.modelId} qrUrl={screen.qrUrl} />
          )}
          {screen.name === 'food' && <FoodScreen />}
          {screen.name === 'history' && <HistoryScreen />}
          {screen.name === 'body' && <BodyScreen />}
          {screen.name === 'summary' && <SummaryScreen workoutId={screen.workoutId} />}
        </div>

        {restLeft !== null && screen.name === 'workout' && (
          <div className="rest-toast">
            <span className="lab">Rest timer</span>
            <div className="bar">
              <i style={{ width: `${Math.max(0, Math.min(100, (restLeft / restTotal) * 100))}%`, transition: 'width 0.25s linear' }} />
            </div>
            <b>{fmtClock(restLeft)}</b>
            <button className="ghost-btn" onClick={stopRest}>Skip</button>
          </div>
        )}

        <TabBar />
      </div>
    </Ctx.Provider>
  )
}
