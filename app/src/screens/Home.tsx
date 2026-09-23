import { useEffect, useState } from 'react'
import { useAction } from '../components/Feedback'
import { useApp } from '../AppContext'
import { GearIcon } from '../components/icons'
import { Ring } from '../components/Ring'
import { STRENGTH_CHECK_ROUTINE_ID } from '../data/seed'
import { todayWorkoutMinutes, waterTargetOz } from '../lib/hydration'
import type { DayFoodStats, Routine, WorkoutSummary } from '../types'
import { toDayKey } from '../types'

const fmtDay = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Morning'
  if (h < 18) return 'Afternoon'
  return 'Evening'
}

function relativeDay(ts?: number) {
  if (!ts) return 'never done'
  const days = Math.floor((Date.now() - ts) / 86400_000)
  if (days === 0) return 'done today'
  if (days === 1) return 'done yesterday'
  return `done ${days}d ago`
}

export function HomeScreen() {
  const { api, go, settings, activeWorkout, setActiveWorkout, exercises } = useApp()
  const action = useAction()
  const [stats, setStats] = useState<DayFoodStats>({ calories: 0, protein: 0, carbs: 0, fat: 0 })
  const [waterOz, setWaterOz] = useState(0)
  const [trainedMin, setTrainedMin] = useState(0)
  const [last, setLast] = useState<WorkoutSummary | null>(null)
  const [loadedLast, setLoadedLast] = useState(false)
  const [streakDays, setStreakDays] = useState(0)
  const [upNext, setUpNext] = useState<Routine | null>(null)

  useEffect(() => {
    const today = toDayKey(new Date())
    api.getDayFoodStats(today).then(setStats)
    api.getDayDrinkStats(today).then((ds) => setWaterOz(ds.totalOz))
    todayWorkoutMinutes(api, today).then(setTrainedMin)
    api.listRecentWorkouts(1).then((ws) => { setLast(ws[0] ?? null); setLoadedLast(true) })
    api.getWeekActivity().then((wa) => setStreakDays(wa.days.filter((d) => d.workoutId).length))
    api.listRoutines().then((rs) => {
      const ordered = [...rs].sort((a, b) => (a.lastUsedAt ?? 0) - (b.lastUsedAt ?? 0))
      setUpNext(ordered[0] ?? null)
    })
  }, [api])

  const waterTarget = waterTargetOz(settings, trainedMin)
  const kcalLeft = Math.max(0, settings.calorieTarget - stats.calories)
  const startWorkout = () => go(activeWorkout ? { name: 'workout' } : { name: 'routines' })

  return (
    <div className="page wide">
      <div className="row">
        <span className="lab">{fmtDay.format(new Date())}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {streakDays > 0
            ? <span className="chip green" style={{ margin: 0 }}>🔥 {streakDays} workout{streakDays === 1 ? '' : 's'} this week</span>
            : <span className="small">Ready when you are</span>}
          <button className="icon-btn" title="Settings" aria-label="Settings" onClick={() => go({ name: 'settings' })}>
            <GearIcon />
          </button>
        </span>
      </div>
      <h1 className="p-h1">{greeting()}<span className="dot">.</span></h1>

      <div className="home-grid">
        <div>
          <div className="card lg">
            <div className="row" style={{ marginBottom: 12 }}>
              <span className="t">Today's fuel</span>
              <span className="small">{kcalLeft.toLocaleString()} kcal left</span>
            </div>
            <div className="rings">
              <div className="ring-cap">
                <Ring value={stats.calories} target={settings.calorieTarget} label={`Calories ${stats.calories} of ${settings.calorieTarget}`} />
                <div className="lab">Calories</div>
                <div className="sub">{stats.calories.toLocaleString()} / {settings.calorieTarget.toLocaleString()} kcal</div>
              </div>
              <div className="ring-cap">
                <Ring value={stats.protein} target={settings.proteinTarget} color="var(--ink)" label={`Protein ${stats.protein} of ${settings.proteinTarget} g`} />
                <div className="lab">Protein</div>
                <div className="sub">{stats.protein} / {settings.proteinTarget} g</div>
              </div>
              <div className="ring-cap">
                <Ring value={waterOz} target={waterTarget} color="var(--water)" label={`Water ${waterOz} of ${waterTarget} oz`} />
                <div className="lab">Water</div>
                <div className="sub">{waterOz} / {waterTarget} oz</div>
              </div>
            </div>
            {(stats.carbs > 0 || stats.fat > 0) && (
              <p className="small" style={{ margin: '12px 0 0', fontSize: '0.74rem' }}>
                {stats.carbs} g carbs · {stats.fat} g fat so far today
              </p>
            )}
          </div>

          <button className="hero" onClick={startWorkout}>
            <span>
              <span className="lab">{activeWorkout ? 'In progress' : 'Up next'}</span>
              <span className="t" style={{ display: 'block' }}>
                {activeWorkout ? 'Workout in progress' : upNext ? `${upNext.emoji ? `${upNext.emoji} ` : ''}${upNext.name}` : 'Pick a routine'}
              </span>
              <span className="small" style={{ display: 'block', marginTop: 2 }}>
                {activeWorkout ? 'Tap to keep logging' : upNext ? `${upNext.items.length} exercises · ${relativeDay(upNext.lastUsedAt)}` : 'Or start an empty workout'}
              </span>
            </span>
            <span className="btn-dark">{activeWorkout ? 'Resume Workout' : 'Start Workout'} ›</span>
          </button>
        </div>

        <div>
          <div className="tiles">
            {last ? (
              <button className="tile" onClick={() => go({ name: 'history' })}>
                <span className="row"><span className="lab">Last workout</span><span className="small">{last.workout.date.slice(5).replace('-', '/')}</span></span>
                <span>
                  <span className="num">{last.setCount}</span><span className="unit">sets</span>
                  {'  '}
                  <span className="num" style={{ fontSize: '1.2rem' }}>{Math.round(last.totalVolumeLb).toLocaleString()}</span><span className="unit">lb</span>
                </span>
                {last.prs.length > 0
                  ? <span><span className="chip solid" style={{ margin: 0, fontSize: '0.62rem', padding: '3px 8px' }}>{exercises.get(last.prs[0]!.exerciseId)?.name ?? ''} PR ★{last.prs.length > 1 ? ` +${last.prs.length - 1}` : ''}</span></span>
                  : <span className="small">{Math.max(1, Math.round(last.durationSec / 60))} min{last.activityCount > 0 ? ` · ${last.activityCount} timed` : ''}</span>}
              </button>
            ) : (
              <div className="tile">
                <span className="lab">Last workout</span>
                <span className="num" style={{ color: 'var(--faint)' }}>—</span>
                <span className="small">{loadedLast ? 'Your first one builds here' : ''}</span>
              </div>
            )}
            <button className="tile" onClick={() => go({ name: 'food' })}>
              <span className="row"><span className="lab">Meals</span><span className="plus-btn" aria-hidden="true">+</span></span>
              <span className="t" style={{ fontSize: '0.95rem' }}>Log food</span>
              <span className="small">Describe it, scan it, or pick a saved meal</span>
            </button>
          </div>

          {loadedLast && !last && !activeWorkout && (
            <div className="card">
              <span className="lab lm">🎯 First visit?</span>
              <p className="t" style={{ fontSize: '0.95rem', margin: '4px 0 2px' }}>Do the Strength Check</p>
              <p className="small" style={{ margin: 0, fontSize: '0.78rem' }}>
                One easy session on six machines. On each, find a weight where 8–12 good reps feel hard but you could do 2 more.
                Every program after that starts from your real strength.
              </p>
              <button
                className="ghost-btn" style={{ marginTop: 12 }}
                disabled={action.busy} onClick={() => void action.run(async () => {
                  const w = await api.startWorkout(STRENGTH_CHECK_ROUTINE_ID)
                  setActiveWorkout(w)
                  go({ name: 'workout' })
                })}
              >
                Start the strength check
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
