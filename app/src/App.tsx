import { useCallback, useEffect, useRef, useState } from 'react'
import api from './data'
import type { Exercise, Settings, Workout } from './types'
import { Ctx } from './AppContext'
import type { Screen } from './AppContext'
import { TabBar } from './components/TabBar'
import { ScanIcon } from './components/icons'
import { HomeScreen } from './screens/Home'
import { RoutinesScreen } from './screens/Routines'
import { WorkoutScreen } from './screens/Workout'
import { ScanScreen } from './screens/Scan'
import { MachineScreen } from './screens/Machine'
import { FoodScreen } from './screens/Food'
import { HistoryScreen } from './screens/History'
import { SummaryScreen } from './screens/Summary'

const fabScreens = new Set(['routines', 'workout'])

export default function App() {
  const [screen, setScreen] = useState<Screen>({ name: 'home' })
  const [settings, setSettings] = useState<Settings | null>(null)
  const [exercises, setExercises] = useState<Map<string, Exercise> | null>(null)
  const [activeWorkout, setActiveWorkout] = useState<Workout | undefined>(undefined)
  const [restLeft, setRestLeft] = useState<number | null>(null)
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
          {screen.name === 'summary' && <SummaryScreen workoutId={screen.workoutId} />}
        </div>

        {restLeft !== null && screen.name === 'workout' && (
          <div className="rest-toast">
            <div>
              <span className="small" style={{ display: 'block' }}>Rest timer</span>
              <b>{restLeft}</b>
            </div>
            <button className="ghost-btn" onClick={stopRest}>Skip</button>
          </div>
        )}

        {fabScreens.has(screen.name) && (
          <button
            className={`fab${restLeft !== null && screen.name === 'workout' ? ' raised' : ''}`}
            title="Scan machine QR" onClick={() => go({ name: 'scan' })}>
            <ScanIcon />
          </button>
        )}

        <TabBar />
      </div>
    </Ctx.Provider>
  )
}
