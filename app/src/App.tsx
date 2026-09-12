import { useCallback, useEffect, useRef, useState } from 'react'
import api from './data'
import type { Exercise, Settings, Workout } from './types'
import { Ctx } from './AppContext'
import type { Screen } from './AppContext'
import { SYNC_APPLIED_EVENT } from './data/sync'
import { useFeedback } from './components/Feedback'
import { TabBar, TopNav } from './components/TabBar'
import { HomeScreen } from './screens/Home'
import { RoutinesScreen } from './screens/Routines'
import { RoutineEditScreen } from './screens/RoutineEdit'
import { WorkoutScreen } from './screens/Workout'
import { ScanScreen } from './screens/Scan'
import { MachineScreen } from './screens/Machine'
import { FoodScreen } from './screens/Food'
import { HistoryScreen } from './screens/History'
import { BodyScreen } from './screens/Body'
import { SummaryScreen } from './screens/Summary'
import { SettingsScreen } from './screens/Settings'

const fmtClock = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`

export default function App() {
  const notify = useFeedback()
  const [loadError, setLoadError] = useState(false)
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
    ).catch(() => { if (alive) setLoadError(true) })
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
        if (left <= 0) {
          stopRest()
          notify('Rest complete — ready for your next set')
          navigator.vibrate?.([100, 80, 100])
        }
        else setRestLeft(left)
      }, 250)
    },
    [settings, stopRest, notify],
  )

  useEffect(() => () => { if (restTimer.current) clearInterval(restTimer.current) }, [])
  useEffect(() => { if (!activeWorkout) stopRest() }, [activeWorkout, stopRest])

  const screenRef = useRef(screen)
  screenRef.current = screen
  const go = useCallback((next: Screen) => {
    if (JSON.stringify(next) === JSON.stringify(screenRef.current)) return
    window.history.pushState({ gymScreen: next }, '')
    setScreen(next)
  }, [])
  useEffect(() => {
    window.history.replaceState({ gymScreen: { name: 'home' } }, '')
    const onBack = (event: PopStateEvent) => setScreen(event.state?.gymScreen ?? { name: 'home' })
    window.addEventListener('popstate', onBack)
    return () => window.removeEventListener('popstate', onBack)
  }, [])
  useEffect(() => {
    document.title = `${screen.name.replace('-', ' ')} · Gym Zero`
  }, [screen])

  const refreshSettings = useCallback(async () => {
    setSettings(await api.getSettings())
  }, [])

  // pulled sync records land in Dexie behind React's back; re-read shared state
  useEffect(() => {
    const onApplied = () => {
      void Promise.all([api.getSettings(), api.getActiveWorkout(), api.listExercises()]).then(([nextSettings, workout, catalog]) => {
        setSettings(nextSettings); setActiveWorkout(workout); setExercises(new Map(catalog.map((exercise) => [exercise.id, exercise])))
      }).catch(() => notify('Could not refresh synced data. Please reload.', { error: true }))
    }
    window.addEventListener(SYNC_APPLIED_EVENT, onApplied)
    return () => window.removeEventListener(SYNC_APPLIED_EVENT, onApplied)
  }, [notify])

  if (!settings || !exercises) {
    return <div className="shell" style={{ alignItems: 'center', justifyContent: 'center' }}>
      {loadError ? <div role="alert"><p>Could not load your saved data.</p><button className="ghost-btn" onClick={() => location.reload()}>Try again</button></div>
        : <p className="small" role="status">Loading your gym…</p>}
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
        <main className={`screen${restLeft !== null ? ' has-rest' : ''}`} key={JSON.stringify(screen)}>
          {screen.name === 'home' && <HomeScreen />}
          {screen.name === 'routines' && <RoutinesScreen />}
          {screen.name === 'routine-edit' && <RoutineEditScreen routineId={screen.routineId} />}
          {screen.name === 'workout' && <WorkoutScreen initialExerciseId={screen.exerciseId} initialMachineId={screen.machineId} />}
          {screen.name === 'scan' && <ScanScreen />}
          {screen.name === 'machine' && (
            <MachineScreen machineId={screen.machineId} initialExerciseId={screen.exerciseId} modelId={screen.modelId} qrUrl={screen.qrUrl} />
          )}
          {screen.name === 'food' && <FoodScreen prefill={screen.prefill} />}
          {screen.name === 'history' && <HistoryScreen />}
          {screen.name === 'body' && <BodyScreen />}
          {screen.name === 'summary' && <SummaryScreen workoutId={screen.workoutId} />}
          {screen.name === 'settings' && <SettingsScreen />}
        </main>

        {restLeft !== null && (
          <div className="rest-toast">
            <span className="lab">Rest</span>
            <div className="bar">
              <i style={{ width: `${Math.max(0, Math.min(100, (restLeft / restTotal) * 100))}%`, transition: 'width 0.25s linear' }} />
            </div>
            <b>{fmtClock(restLeft)}</b>
            <button className="ghost-btn" aria-label="Add 30 seconds of rest" onClick={() => startRest(restLeft + 30)}>+30s</button>
            <button className="ghost-btn" onClick={stopRest}>Skip</button>
          </div>
        )}

        <TabBar />
      </div>
    </Ctx.Provider>
  )
}
