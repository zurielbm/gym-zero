import { useEffect, useState } from 'react'
import { useApp } from '../AppContext'
import { GearIcon } from '../components/icons'
import type { BodyStatEntry, WeekActivity, WorkoutSummary } from '../types'
import { toDayKey } from '../types'

const dayLetter = (dateKey: string) =>
  ['S', 'M', 'T', 'W', 'T', 'F', 'S'][new Date(`${dateKey}T12:00:00`).getDay()]

export function HistoryScreen() {
  const { api, settings, refreshSettings, exercises, go } = useApp()
  const [week, setWeek] = useState<WeekActivity | null>(null)
  const [recent, setRecent] = useState<WorkoutSummary[]>([])
  const [latestStat, setLatestStat] = useState<BodyStatEntry | undefined>(undefined)
  const [weightTrend, setWeightTrend] = useState<Array<{ at: number; value: number }>>([])
  const [weightIn, setWeightIn] = useState('')

  useEffect(() => {
    api.getWeekActivity().then(setWeek)
    api.listRecentWorkouts(10).then(setRecent)
    api.getLatestBodyStat().then(setLatestStat)
    api.getBodyTrend('weightLb', 30).then(setWeightTrend)
  }, [api])

  const saveWeight = async () => {
    const w = parseFloat(weightIn)
    if (!isFinite(w) || w <= 0) return
    const now = new Date()
    // every quick weigh-in is a real body record, not just a settings overwrite
    await api.addBodyStat({ date: toDayKey(now), at: now.getTime(), weightLb: w })
    await refreshSettings()
    setLatestStat(await api.getLatestBodyStat())
    setWeightTrend(await api.getBodyTrend('weightLb', 30))
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
    <div className="page wide">
      <div className="row">
        <span className="lab">This week · {didCount} workout{didCount === 1 ? '' : 's'}</span>
        <button className="icon-btn" title="Settings" onClick={() => go({ name: 'settings' })}>
          <GearIcon />
        </button>
      </div>
      <h1 className="p-h1" style={{ margin: '8px 0 14px' }}>Stats<span className="dot">.</span></h1>

      <div className="hi-grid">
        <div>
          {week && (
            <div className="cal-strip">
              {week.days.map((d) => (
                <div key={d.date} className={`cal-day${d.workoutId ? ' did' : ''}`}>
                  <b>{dayLetter(d.date)}</b>
                  <span className="blk" />
                  <span style={{ fontSize: '0.625rem', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {d.routineName ?? (d.workoutId ? '✓' : '—')}
                  </span>
                </div>
              ))}
            </div>
          )}

          {week && (
            <div className="card">
              <div className="row">
                <span className="lab">Weekly volume · 6 wk</span>
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
              <span className="lab" style={{ display: 'block', marginTop: 6 }}>Lb lifted per week</span>
            </div>
          )}

          <div className="card">
            <div className="row">
              <div>
                <span className="lab">Body</span>
                <span className="num" style={{ fontSize: '1.1rem', display: 'block', marginTop: 2 }}>
                  {settings.bodyWeightLb ? `${settings.bodyWeightLb} lb` : '—'}
                  {latestStat?.bodyFatPct !== undefined && <span className="small" style={{ fontFamily: 'var(--body)' }}> · {latestStat.bodyFatPct}% fat</span>}
                  {settings.bodyWeightGoalLb ? <span className="small" style={{ fontFamily: 'var(--body)' }}> · goal {settings.bodyWeightGoalLb} lb</span> : null}
                </span>
              </div>
              <button className="ghost-btn" style={{ width: 'auto', padding: '12px 16px' }} onClick={() => go({ name: 'body' })}>
                Open ›
              </button>
            </div>
            {weightTrend.length >= 2 && (() => {
              const values = weightTrend.map((p) => p.value)
              const max = Math.max(...values)
              const min = Math.min(...values)
              return (
                <div className="spark" style={{ height: 28 }}>
                  {weightTrend.slice(-20).map((p, i, arr) => (
                    <i
                      key={p.at}
                      className={i === arr.length - 1 ? 'hi' : ''}
                      style={{ height: `${Math.max(10, max === min ? 100 : ((p.value - min) / (max - min)) * 90 + 10)}%` }}
                    />
                  ))}
                </div>
              )
            })()}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <input className="text-in" inputMode="decimal" placeholder="182.4" value={weightIn}
                onChange={(e) => setWeightIn(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && saveWeight()} />
              <button className="ghost-btn" style={{ width: 'auto', padding: '0 18px' }} onClick={saveWeight}>
                Log
              </button>
            </div>
          </div>

        </div>

        <div>
          <p className="section-label">Sessions</p>
          {recent.map((s) => (
            <div key={s.workout.id} className="card">
              <div className="row">
                <span className="num" style={{ fontSize: '1.05rem' }}>
                  {s.workout.date.slice(5).replace('-', '/')}
                </span>
                <span className="lab">{Math.max(1, Math.round(s.durationSec / 60))} min</span>
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
            <div className="card">
              <span className="num" style={{ fontSize: '2.4rem', WebkitTextStroke: '1px var(--ghost)', color: 'transparent', display: 'block' }}>00</span>
              <span className="lab" style={{ display: 'block', marginTop: 4 }}>No sessions yet</span>
              <span className="small">Your history builds here. First one today?</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
