import { useEffect, useState } from 'react'
import { useApp } from '../AppContext'
import { Ring } from '../components/Ring'
import { BarbellIcon } from '../components/icons'
import type { DayFoodStats, WorkoutSummary } from '../types'
import { toDayKey } from '../types'

const fmtDay = new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric' })

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

export function HomeScreen() {
  const { api, go, settings, activeWorkout, exercises } = useApp()
  const [stats, setStats] = useState<DayFoodStats>({ calories: 0, protein: 0 })
  const [last, setLast] = useState<WorkoutSummary | null>(null)
  const [streakDays, setStreakDays] = useState(0)

  useEffect(() => {
    api.getDayFoodStats(toDayKey(new Date())).then(setStats)
    api.listRecentWorkouts(1).then((ws) => setLast(ws[0] ?? null))
    api.getWeekActivity().then((wa) => setStreakDays(wa.days.filter((d) => d.workoutId).length))
  }, [api])

  return (
    <>
      <p className="p-sub" style={{ marginBottom: 2 }}>{fmtDay.format(new Date())}</p>
      <h1 className="p-h1">{greeting()} 👋</h1>
      <p className="p-sub">
        {streakDays > 0 ? `🔥 ${streakDays} workout${streakDays > 1 ? 's' : ''} this week` : 'Ready when you are'}
      </p>

      <button
        className="big-btn"
        onClick={() => go(activeWorkout ? { name: 'workout' } : { name: 'routines' })}
      >
        <span style={{ display: 'inline-flex', width: 22 }}><BarbellIcon /></span>
        {activeWorkout ? 'Resume Workout' : 'Start Workout'}
      </button>

      <div style={{ height: 14 }} />
      <div className="rings">
        <Ring value={stats.calories} target={settings.calorieTarget} color="#66e3a4" label="Calories" unit="kcal" />
        <Ring value={stats.protein} target={settings.proteinTarget} color="#74a7ff" label="Protein" unit="g" />
      </div>

      {last && (
        <div className="card tappable" onClick={() => go({ name: 'history' })}>
          <div className="row">
            <b>Last workout</b>
            <span className="small">{last.workout.date.slice(5).replace('-', '/')}</span>
          </div>
          <span className="small">
            {last.setCount} set{last.setCount === 1 ? '' : 's'} ·{' '}
            {Math.round(last.totalVolumeLb).toLocaleString()} lb volume ·{' '}
            {Math.max(1, Math.round(last.durationSec / 60))} min
          </span>
          {last.prs.length > 0 && (
            <div style={{ marginTop: 8 }}>
              {last.prs.map((pr) => (
                <span key={pr.exerciseId} className="chip green">
                  {exercises.get(pr.exerciseId)?.name ?? pr.exerciseId} PR {pr.weightLb}×{pr.reps}
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      <div className="card tappable" onClick={() => go({ name: 'food' })}>
        <div className="row">
          <b>Log food</b>
          <span style={{ color: 'var(--accent2)', fontWeight: 800 }}>+</span>
        </div>
        <span className="small">Calories and protein in a couple of taps</span>
      </div>
    </>
  )
}
