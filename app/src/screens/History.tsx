import { useEffect, useState } from 'react'
import { useApp } from '../AppContext'
import type { WeekActivity, WorkoutSummary } from '../types'

const dayLetter = (dateKey: string) =>
  ['S', 'M', 'T', 'W', 'T', 'F', 'S'][new Date(`${dateKey}T12:00:00`).getDay()]

export function HistoryScreen() {
  const { api, settings, refreshSettings, exercises } = useApp()
  const [week, setWeek] = useState<WeekActivity | null>(null)
  const [recent, setRecent] = useState<WorkoutSummary[]>([])
  const [weightIn, setWeightIn] = useState('')

  useEffect(() => {
    api.getWeekActivity().then(setWeek)
    api.listRecentWorkouts(10).then(setRecent)
  }, [api])

  const saveWeight = async () => {
    const w = parseFloat(weightIn)
    if (!isFinite(w) || w <= 0) return
    await api.saveSettings({ ...settings, bodyWeightLb: w })
    await refreshSettings()
    setWeightIn('')
  }

  const didCount = week?.days.filter((d) => d.workoutId).length ?? 0
  const maxVol = Math.max(1, ...(week?.weeklyVolumeLb ?? []))
  const volTrend = (() => {
    const v = week?.weeklyVolumeLb ?? []
    const cur = v[v.length - 1] ?? 0
    const prev = v[v.length - 2] ?? 0
    if (prev <= 0 || cur <= 0) return null
    return Math.round(((cur - prev) / prev) * 100)
  })()

  return (
    <>
      <h1 className="p-h1">History</h1>
      <p className="p-sub">This week · {didCount} workout{didCount === 1 ? '' : 's'}</p>

      {week && (
        <div className="cal-strip">
          {week.days.map((d) => (
            <div key={d.date} className={`cal-day${d.workoutId ? ' did' : ''}`}>
              <b>{dayLetter(d.date)}</b>
              {d.routineName ?? (d.workoutId ? '✓' : '—')}
            </div>
          ))}
        </div>
      )}

      {week && (
        <div className="card">
          <div className="row">
            <b style={{ fontSize: '0.85rem' }}>Weekly volume</b>
            {volTrend !== null && (
              <span className={`chip ${volTrend >= 0 ? 'green' : ''}`} style={{ margin: 0 }}>
                {volTrend >= 0 ? '▲' : '▼'} {Math.abs(volTrend)}%
              </span>
            )}
          </div>
          <div className="spark">
            {week.weeklyVolumeLb.map((v, i) => (
              <i
                key={i}
                className={i === week.weeklyVolumeLb.length - 1 ? 'hi' : ''}
                style={{ height: `${Math.max(5, (v / maxVol) * 100)}%` }}
              />
            ))}
          </div>
          <span className="small">Last 6 weeks · lb lifted</span>
        </div>
      )}

      {recent.map((s) => (
        <div key={s.workout.id} className="card">
          <div className="row">
            <b style={{ fontSize: '0.85rem' }}>
              {s.workout.date.slice(5).replace('-', '/')}
            </b>
            <span className="small">{Math.max(1, Math.round(s.durationSec / 60))} min</span>
          </div>
          <span className="small">
            {s.setCount} set{s.setCount === 1 ? '' : 's'} · {Math.round(s.totalVolumeLb).toLocaleString()} lb
            {s.prs.map((pr) => (
              <span key={pr.exerciseId} className="pr-flag">
                {exercises.get(pr.exerciseId)?.name ?? ''} PR {pr.weightLb}×{pr.reps}
              </span>
            ))}
          </span>
          {s.workout.notes && <span className="small" style={{ display: 'block', marginTop: 4 }}>“{s.workout.notes}”</span>}
        </div>
      ))}
      {recent.length === 0 && (
        <div className="card"><span className="small">No finished workouts yet — your history builds here.</span></div>
      )}

      <div className="card">
        <div className="row">
          <b style={{ fontSize: '0.85rem' }}>Body weight</b>
          <span className="small">
            {settings.bodyWeightLb ? `${settings.bodyWeightLb} lb` : 'not logged'}
            {settings.bodyWeightGoalLb ? ` · goal ${settings.bodyWeightGoalLb} lb` : ''}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          <input className="text-in" inputMode="decimal" placeholder="182.4" value={weightIn}
            onChange={(e) => setWeightIn(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && saveWeight()} />
          <button className="ghost-btn" style={{ width: 'auto', padding: '0 16px' }} onClick={saveWeight}>
            Log
          </button>
        </div>
      </div>
    </>
  )
}
