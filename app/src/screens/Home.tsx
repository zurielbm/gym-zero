import { useEffect, useState } from 'react'
import { useApp } from '../AppContext'
import { BarbellIcon, GearIcon } from '../components/icons'
import { STRENGTH_CHECK_ROUTINE_ID } from '../data/seed'
import { todayWorkoutMinutes, waterTargetOz } from '../lib/hydration'
import type { DayFoodStats, Routine, WorkoutSummary } from '../types'
import { toDayKey } from '../types'

const fmtDay = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: '2-digit', day: '2-digit' })

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Morning'
  if (h < 18) return 'Afternoon'
  return 'Evening'
}

function MacroBar({ label, value, target, unit, alt, water }: {
  label: string; value: number; target: number; unit: string; alt?: boolean; water?: boolean
}) {
  const pct = Math.min(100, target > 0 ? (value / target) * 100 : 0)
  return (
    <>
      <div className="macro-row">
        <span className="lab">{label}</span>
        <span className="num">
          {value.toLocaleString()}
          <span className="of"> / {target.toLocaleString()} {unit}</span>
        </span>
      </div>
      <div className="bar"><i className={water ? 'water' : alt ? 'alt' : ''} style={{ width: `${pct}%` }} /></div>
    </>
  )
}

export function HomeScreen() {
  const { api, go, settings, activeWorkout, setActiveWorkout, exercises } = useApp()
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

  return (
    <div className="page wide">
      <div className="row">
        <span className="lab">{fmtDay.format(new Date())}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <span className={`lab${streakDays > 0 ? ' lm' : ''}`}>
            {streakDays > 0
              ? `Week streak ${String(streakDays).padStart(2, '0')}`
              : 'Ready when you are'}
          </span>
          <button className="icon-btn" title="Settings" onClick={() => go({ name: 'settings' })}>
            <GearIcon />
          </button>
        </span>
      </div>

      <div className="home-grid">
        <div>
          <h1 className="p-h1" style={{ fontSize: '2.1rem', margin: '10px 0 2px' }}>
            {greeting()}<span className="dot">.</span>
          </h1>

          <MacroBar label="Calories" value={stats.calories} target={settings.calorieTarget} unit="kcal" />
          <MacroBar label="Protein" value={stats.protein} target={settings.proteinTarget} unit="g" alt />
          <MacroBar label="Water" value={waterOz} target={waterTargetOz(settings, trainedMin)} unit="oz" water />
          {(stats.carbs > 0 || stats.fat > 0) && (
            <span className="small" style={{ display: 'block', marginTop: 8 }}>
              {stats.carbs}g carbs · {stats.fat}g fat so far today
            </span>
          )}

          <div style={{ height: 18 }} />
          <button
            className="big-btn"
            onClick={() => go(activeWorkout ? { name: 'workout' } : { name: 'routines' })}
          >
            <span style={{ display: 'inline-flex', width: 20 }}><BarbellIcon /></span>
            {activeWorkout ? 'Resume Workout' : 'Start Workout'} →
          </button>
          {!activeWorkout && upNext && (
            <p className="lab" style={{ textAlign: 'center', margin: '10px 0 0' }}>
              {upNext.name} is up next
            </p>
          )}
        </div>

        <div>
          {loadedLast && !last && !activeWorkout && (
            <div className="card" style={{ marginTop: 14 }}>
              <span className="lab lm">🎯 First visit? Do the Strength Check</span>
              <span className="small" style={{ display: 'block', margin: '6px 0 10px' }}>
                One easy session on six machines. On each: warm up light, then find a weight
                where 8–12 good reps feel hard but you could do 2 more, and log it.
                Every program after that starts from your real strength — no maxing out, ever.
              </span>
              <button
                className="ghost-btn"
                onClick={async () => {
                  const w = await api.startWorkout(STRENGTH_CHECK_ROUTINE_ID)
                  setActiveWorkout(w)
                  go({ name: 'workout' })
                }}
              >
                Start the strength check →
              </button>
            </div>
          )}

          {last && (
            <div className="card tappable" style={{ marginTop: 14 }} onClick={() => go({ name: 'history' })}>
              <div className="row">
                <span className="lab">Last workout</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className="lab">{last.workout.date.slice(5).replace('-', '.')}</span>
                  <span className="chev">›</span>
                </span>
              </div>
              <div className="stat-strip" style={{ border: 0, paddingTop: 8, margin: '0 0 4px' }}>
                <span><span className="num" style={{ fontSize: '1.35rem' }}>{last.setCount}</span><span className="lab">Sets</span></span>
                <span><span className="num" style={{ fontSize: '1.35rem' }}>{Math.round(last.totalVolumeLb).toLocaleString()}</span><span className="lab">Lb vol</span></span>
                <span><span className="num" style={{ fontSize: '1.35rem' }}>{Math.max(1, Math.round(last.durationSec / 60))}</span><span className="lab">Min</span></span>
              </div>
              {last.prs.length > 0 && (
                <div>
                  {last.prs.map((pr) => (
                    <span key={pr.exerciseId} className="chip solid">
                      {exercises.get(pr.exerciseId)?.name ?? pr.exerciseId} PR {pr.weightLb}×{pr.reps} ★
                    </span>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="card tappable" style={{ marginTop: last ? 4 : 14 }} onClick={() => go({ name: 'food' })}>
            <div className="row">
              <b style={{ fontSize: '0.9rem' }}>Log food</b>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ color: 'var(--lime)', fontWeight: 800 }}>＋</span>
                <span className="chev">›</span>
              </span>
            </div>
            <span className="small">Calories and macros in a couple of taps</span>
          </div>
        </div>
      </div>
    </div>
  )
}
