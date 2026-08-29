import { useEffect, useState } from 'react'
import { useApp } from '../AppContext'
import { BarbellIcon } from '../components/icons'
import type { DayFoodStats, Routine, WorkoutSummary } from '../types'
import { toDayKey } from '../types'

const fmtDay = new Intl.DateTimeFormat('en-US', { weekday: 'short', month: '2-digit', day: '2-digit' })

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Morning'
  if (h < 18) return 'Afternoon'
  return 'Evening'
}

function MacroBar({ label, value, target, unit, alt }: {
  label: string; value: number; target: number; unit: string; alt?: boolean
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
      <div className="bar"><i className={alt ? 'alt' : ''} style={{ width: `${pct}%` }} /></div>
    </>
  )
}

export function HomeScreen() {
  const { api, go, settings, activeWorkout, exercises } = useApp()
  const [stats, setStats] = useState<DayFoodStats>({ calories: 0, protein: 0 })
  const [last, setLast] = useState<WorkoutSummary | null>(null)
  const [streakDays, setStreakDays] = useState(0)
  const [upNext, setUpNext] = useState<Routine | null>(null)

  useEffect(() => {
    api.getDayFoodStats(toDayKey(new Date())).then(setStats)
    api.listRecentWorkouts(1).then((ws) => setLast(ws[0] ?? null))
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
        <span className={`lab${streakDays > 0 ? ' lm' : ''}`}>
          {streakDays > 0
            ? `Week streak ${String(streakDays).padStart(2, '0')}`
            : 'Ready when you are'}
        </span>
      </div>

      <div className="home-grid">
        <div>
          <h1 className="p-h1" style={{ fontSize: '2.1rem', margin: '10px 0 2px' }}>
            {greeting()}<span className="dot">.</span>
          </h1>

          <MacroBar label="Calories" value={stats.calories} target={settings.calorieTarget} unit="kcal" />
          <MacroBar label="Protein" value={stats.protein} target={settings.proteinTarget} unit="g" alt />

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
          {last && (
            <div className="card tappable" style={{ marginTop: 14 }} onClick={() => go({ name: 'history' })}>
              <div className="row">
                <span className="lab">Last workout</span>
                <span className="lab">{last.workout.date.slice(5).replace('-', '.')}</span>
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
              <span style={{ color: 'var(--lime)', fontWeight: 800 }}>＋</span>
            </div>
            <span className="small">Calories and protein in a couple of taps</span>
          </div>
        </div>
      </div>
    </div>
  )
}
