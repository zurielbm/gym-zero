import { useEffect, useState } from 'react'
import { useAction, useFeedback } from '../components/Feedback'
import { useApp } from '../AppContext'
import { GearIcon } from '../components/icons'
import { SYNC_APPLIED_EVENT } from '../data/sync'
import { waterTargetOz } from '../lib/hydration'
import type { BodyStatEntry, WeekActivity, WeekFoodStats, WorkoutSummary } from '../types'
import { toDayKey } from '../types'

const dayLetter = (dateKey: string) =>
  ['S', 'M', 'T', 'W', 'T', 'F', 'S'][new Date(`${dateKey}T12:00:00`).getDay()]

/** 7 day-bars against an optional dashed target line; unlogged days render as gaps. */
function WeekBars({ days, metric, target, targetLabel, barClass, gapUnlogged, height }: {
  days: WeekFoodStats['days']
  metric: (day: WeekFoodStats['days'][number]) => number
  target?: number
  targetLabel?: string
  barClass?: string
  gapUnlogged?: boolean
  height?: number
}) {
  const scaleMax = Math.max(target ?? 0, ...days.map(metric), 1)
  return (
    <>
      <div className="spark" style={height ? { height } : undefined}>
        {target !== undefined && (
          <div className="target-line" style={{ bottom: `${Math.min(100, (target / scaleMax) * 100)}%` }}>
            <span>{targetLabel}</span>
          </div>
        )}
        {days.map((day, i) => {
          const isToday = i === days.length - 1
          if (gapUnlogged && !day.logged) return <i key={day.date} className="gap" />
          const cls = [barClass, isToday ? 'hi' : ''].filter(Boolean).join(' ')
          return <i key={day.date} className={cls} style={{ height: `${Math.max(5, (metric(day) / scaleMax) * 100)}%` }} />
        })}
      </div>
      <div className="spark-days">
        {days.map((day, i) => (
          <b key={day.date} className={i === days.length - 1 ? 'today' : ''}>{dayLetter(day.date)}</b>
        ))}
      </div>
    </>
  )
}

export function HistoryScreen() {
  const { api, settings, refreshSettings, exercises, go } = useApp()
  const action = useAction()
  const notify = useFeedback()
  const [week, setWeek] = useState<WeekActivity | null>(null)
  const [foodWeek, setFoodWeek] = useState<WeekFoodStats | null>(null)
  const [recent, setRecent] = useState<WorkoutSummary[]>([])
  const [latestStat, setLatestStat] = useState<BodyStatEntry | undefined>(undefined)
  const [weightTrend, setWeightTrend] = useState<Array<{ at: number; value: number }>>([])
  const [weightIn, setWeightIn] = useState('')
  const [routineNames, setRoutineNames] = useState<Map<string, string>>(new Map())

  useEffect(() => {
    const load = () => {
      api.getWeekActivity().then(setWeek)
      api.getWeekFoodStats().then(setFoodWeek)
      api.listRecentWorkouts(10).then(setRecent)
      api.getLatestBodyStat().then(setLatestStat)
      api.getBodyTrend('weightLb', 30).then(setWeightTrend)
      api.listRoutines().then((rs) => setRoutineNames(new Map(rs.map((r) => [r.id, `${r.emoji ? `${r.emoji} ` : ''}${r.name}`]))))
    }
    load()
    // pulled sync records land in Dexie behind React's back; re-read on apply
    window.addEventListener(SYNC_APPLIED_EVENT, load)
    return () => window.removeEventListener(SYNC_APPLIED_EVENT, load)
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
    notify('Weight saved')
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

  const loggedDays = foodWeek?.days.filter((d) => d.logged).length ?? 0
  const anyFood = loggedDays > 0 || (foodWeek?.weeklyAvgCalories.some((v) => v > 0) ?? false)
  const waterOzTarget = waterTargetOz(settings, 0)
  const proteinHits = foodWeek?.days.filter((d) => d.logged && d.protein >= settings.proteinTarget).length ?? 0
  const waterHits = foodWeek?.days.filter((d) => d.waterOz >= waterOzTarget).length ?? 0
  const weekPct = (cur: number, prev: number) => (prev > 0 && cur > 0 ? Math.round(((cur - prev) / prev) * 100) : null)
  const calPct = weekPct(foodWeek?.avg.calories ?? 0, foodWeek?.prevAvg.calories ?? 0)
  const proteinPct = weekPct(foodWeek?.avg.protein ?? 0, foodWeek?.prevAvg.protein ?? 0)
  // "good" = this week's average landed closer to the calorie target than last week's
  const calImproved = foodWeek !== null &&
    Math.abs(foodWeek.avg.calories - settings.calorieTarget) <= Math.abs(foodWeek.prevAvg.calories - settings.calorieTarget)

  const calorieSummary = (fw: WeekFoodStats) => {
    const target = settings.calorieTarget
    const diff = fw.avg.calories - target
    const off = Math.abs(diff) / target
    const dayWord = loggedDays === 7 ? 'all 7 days' : `the ${loggedDays} day${loggedDays === 1 ? '' : 's'} you logged`
    const verdict = off <= 0.05
      ? `right around your ${target.toLocaleString()} target`
      : `${off <= 0.15 ? 'a little' : 'well'} ${diff < 0 ? 'under' : 'over'} your ${target.toLocaleString()} target`
    const gapNote = loggedDays < 7 ? ' Days with no logs show as gaps and don’t count toward the average.' : ''
    return `You averaged ${fw.avg.calories.toLocaleString()} kcal on ${dayWord} — ${verdict}.${gapNote}`
  }

  const curVol = week?.weeklyVolumeLb.at(-1) ?? 0
  const curCardio = week?.weeklyCardioMinutes.at(-1) ?? 0
  const weightDelta = (() => {
    if (weightTrend.length < 2) return null
    const first = weightTrend[0]!.value
    const lastV = weightTrend[weightTrend.length - 1]!.value
    return Math.round((lastV - first) * 10) / 10
  })()

  return (
    <div className="page wide">
      <div className="row">
        <h1 className="p-h1">Stats<span className="dot">.</span></h1>
        <button className="icon-btn" title="Settings" aria-label="Settings" onClick={() => go({ name: 'settings' })}>
          <GearIcon />
        </button>
      </div>

      <div className="hi-grid">
        <div>
          {week && (
            <div className="card">
              <div className="row" style={{ marginBottom: 12 }}>
                <span className="t" style={{ fontSize: '0.95rem' }}>This week</span>
                <span className="small">{didCount} workout{didCount === 1 ? '' : 's'}</span>
              </div>
              <div className="cal-strip">
                {week.days.map((d, i) => (
                  <div key={d.date} className={`cal-day${d.workoutId ? ' did' : ''}${i === week.days.length - 1 ? ' today' : ''}`} title={d.routineName ?? undefined}>
                    <b>{d.date.slice(8).replace(/^0/, '')}</b>
                    <span>{dayLetter(d.date)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="tiles">
            <div className="tile">
              <span className="lab">Volume · week</span>
              <span><span className="num">{curVol >= 10000 ? `${(curVol / 1000).toFixed(1)}k` : Math.round(curVol).toLocaleString()}</span><span className="unit">lb</span></span>
              <span className="small" style={volTrend !== null && volTrend >= 0 ? { color: 'var(--lime)' } : undefined}>
                {volTrend !== null ? `${volTrend >= 0 ? '▲' : '▼'} ${Math.abs(volTrend)}% vs last week` : 'Lb lifted this week'}
              </span>
            </div>
            <div className="tile">
              <span className="lab">Cardio · week</span>
              <span><span className="num">{Math.round(curCardio)}</span><span className="unit">min</span></span>
              <span className="small">timed activity</span>
            </div>
            <div className="tile">
              <span className="lab">Weight</span>
              <span>{settings.bodyWeightLb ? <><span className="num">{settings.bodyWeightLb}</span><span className="unit">lb</span></> : <span className="num">—</span>}</span>
              <span className="small" style={weightDelta !== null && weightDelta <= 0 ? { color: 'var(--lime)' } : undefined}>
                {weightDelta !== null ? `${weightDelta > 0 ? '▲' : '▼'} ${Math.abs(weightDelta)} lb / 30 d` : settings.bodyWeightGoalLb ? `goal ${settings.bodyWeightGoalLb} lb` : 'log a weigh-in below'}
              </span>
            </div>
            <div className="tile">
              <span className="lab">Protein hits</span>
              <span><span className="num">{proteinHits}</span><span className="unit">/ 7 days</span></span>
              <span className="small">{foodWeek && anyFood ? `avg ${foodWeek.avg.protein} g` : 'no food logged'}</span>
            </div>
          </div>

          {week && (
            <div className="card">
              <div className="row">
                <span className="t" style={{ fontSize: '0.95rem' }}>Weekly volume</span>
                <span className="small">6 wk · lb</span>
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
            </div>
          )}

          {week && <div className="card">
            <div className="row">
              <span className="t" style={{ fontSize: '0.95rem' }}>Cardio time</span>
              <span className="small">6 wk · min</span>
            </div>
            <div className="spark" role="img" aria-label={`Weekly cardio minutes: ${week.weeklyCardioMinutes.map((m) => Math.round(m)).join(', ')}`}>
              {week.weeklyCardioMinutes.map((minutes, i) => <i key={i} className={i === 5 ? 'hi' : ''}
                title={`${Number(minutes.toFixed(1))} cardio min`}
                style={{ height: `${Math.max(2, minutes / Math.max(1, ...week.weeklyCardioMinutes) * 100)}%` }} />)}
            </div>
            <p className="small" style={{ margin: '8px 0 0' }}>{Number((week.weeklyCardioMinutes.at(-1) ?? 0).toFixed(1))} cardio min this week</p>
          </div>}

          {foodWeek && !anyFood && (
            <div className="card">
              <div className="row">
                <div>
                  <span className="t" style={{ fontSize: '0.95rem' }}>No food logged yet</span>
                  <span className="small" style={{ display: 'block' }}>Log a meal and your week shows up here.</span>
                </div>
                <button className="ghost-btn" style={{ width: 'auto' }} onClick={() => go({ name: 'food' })}>Log food ›</button>
              </div>
            </div>
          )}
          {foodWeek && anyFood && (
            <>
              <div className="card">
                <div className="row">
                  <span className="t" style={{ fontSize: '0.95rem' }}>Calories · last 7 days</span>
                  {calPct !== null && (
                    <span className={`chip ${calImproved ? 'green' : ''}`} style={{ margin: 0, whiteSpace: 'nowrap' }}>
                      {calPct >= 0 ? '▲' : '▼'} {Math.abs(calPct)}% vs prior wk
                    </span>
                  )}
                </div>
                <span className="num" style={{ fontSize: '1.4rem', display: 'block', marginTop: 6 }}>
                  {foodWeek.avg.calories.toLocaleString()}
                  <span className="small" style={{ fontFamily: 'var(--body)' }}> / {settings.calorieTarget.toLocaleString()} kcal avg</span>
                </span>
                <WeekBars days={foodWeek.days} metric={(d) => d.calories} gapUnlogged
                  target={settings.calorieTarget} targetLabel={`target ${settings.calorieTarget.toLocaleString()}`} />
                {loggedDays > 0 && <span className="small" style={{ display: 'block', marginTop: 10 }}>{calorieSummary(foodWeek)}</span>}
              </div>

              <div className="card">
                <div className="row">
                  <span className="t" style={{ fontSize: '0.95rem' }}>Protein · last 7 days</span>
                  {proteinPct !== null && (
                    <span className={`chip ${proteinPct >= 0 ? 'green' : ''}`} style={{ margin: 0 }}>
                      {proteinPct >= 0 ? '▲' : '▼'} {Math.abs(proteinPct)}%
                    </span>
                  )}
                </div>
                <span className="num" style={{ fontSize: '1.4rem', display: 'block', marginTop: 6 }}>
                  {foodWeek.avg.protein.toLocaleString()}
                  <span className="small" style={{ fontFamily: 'var(--body)' }}> / {settings.proteinTarget.toLocaleString()} g avg</span>
                </span>
                <WeekBars days={foodWeek.days} metric={(d) => d.protein} gapUnlogged barClass="ink" height={40}
                  target={settings.proteinTarget} targetLabel={`${settings.proteinTarget} g`} />
                {loggedDays > 0 && (foodWeek.avg.carbs > 0 || foodWeek.avg.fat > 0) && (
                  <span className="small" style={{ display: 'block', marginTop: 10 }}>
                    Also averaged {foodWeek.avg.carbs} g carbs · {foodWeek.avg.fat} g fat — context, no targets set.
                  </span>
                )}
              </div>

              <div className="card">
                <div className="row">
                  <span className="t" style={{ fontSize: '0.95rem' }}>Water</span>
                  <span className="num" style={{ fontSize: '1.1rem' }}>
                    {foodWeek.avgWaterOz}
                    <span className="small" style={{ fontFamily: 'var(--body)' }}> / about {waterOzTarget} oz avg</span>
                  </span>
                </div>
                <WeekBars days={foodWeek.days} metric={(d) => d.waterOz} barClass="wat" height={32} />
                <div className="stat-strip" style={{ marginBottom: 0 }}>
                  <span>
                    <span className="num">{loggedDays}/7</span>
                    <span className="lab">Days logged</span>
                  </span>
                  <span>
                    <span className="num">{proteinHits}/7</span>
                    <span className="lab">Hit protein</span>
                  </span>
                  <span>
                    <span className="num">{waterHits}/7</span>
                    <span className="lab">Hit water</span>
                  </span>
                </div>
              </div>

              {foodWeek.weeklyAvgCalories.filter((v) => v > 0).length >= 2 && (
                <div className="card">
                  <span className="t" style={{ fontSize: '0.95rem' }}>Calorie trend · 4 wk</span>
                  <div className="spark" style={{ height: 40 }}>
                    {foodWeek.weeklyAvgCalories.map((v, i) => (
                      <i
                        key={i}
                        className={i === foodWeek.weeklyAvgCalories.length - 1 ? 'hi' : ''}
                        style={{ height: `${Math.max(5, (v / Math.max(1, ...foodWeek.weeklyAvgCalories)) * 100)}%` }}
                      />
                    ))}
                  </div>
                  <span className="small" style={{ display: 'block', marginTop: 6 }}>Avg kcal on logged days, per week</span>
                </div>
              )}
            </>
          )}

          <div className="card">
            <div className="row">
              <div>
                <span className="t" style={{ fontSize: '0.95rem' }}>Body</span>
                <span className="num" style={{ fontSize: '1.1rem', display: 'block', marginTop: 2 }}>
                  {settings.bodyWeightLb ? `${settings.bodyWeightLb} lb` : '—'}
                  {latestStat?.bodyFatPct !== undefined && <span className="small" style={{ fontFamily: 'var(--body)' }}> · {latestStat.bodyFatPct}% fat</span>}
                  {settings.bodyWeightGoalLb ? <span className="small" style={{ fontFamily: 'var(--body)' }}> · goal {settings.bodyWeightGoalLb} lb</span> : null}
                </span>
              </div>
              <button className="text-button" onClick={() => go({ name: 'body' })}>Open ›</button>
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
                onKeyDown={(e) => { if (e.key === 'Enter') void action.run(saveWeight) }} />
              <button className="big-btn" style={{ width: 'auto', padding: '0 18px', minHeight: 44 }} disabled={action.busy || !Number.isFinite(Number(weightIn)) || Number(weightIn) <= 0} onClick={() => void action.run(saveWeight)}>
                Log
              </button>
            </div>
          </div>

        </div>

        <div>
          <p className="section-label">Recent workouts</p>
          {recent.map((s) => (
            <div key={s.workout.id} className="card">
              <div className="row">
                <span className="t" style={{ fontSize: '0.95rem' }}>{(s.workout.routineId && routineNames.get(s.workout.routineId)) ?? 'Workout'}</span>
                <span className="small">{s.workout.date.slice(5).replace('-', '/')} · {Math.max(1, Math.round(s.durationSec / 60))} min</span>
              </div>
              <span className="small" style={{ display: 'block', margin: '4px 0 0' }}>
                {s.setCount} set{s.setCount === 1 ? '' : 's'} · {Math.round(s.totalVolumeLb).toLocaleString()} lb
                {s.activityCount > 0 && <> · {Number((s.timedDurationSec / 60).toFixed(1))} min timed · {Number(s.distanceMiles.toFixed(2))} mi</>}
              </span>
              {s.prs.length > 0 && <div style={{ marginTop: 8 }}>
                {s.prs.map((pr) => (
                  <span key={pr.exerciseId} className="chip solid" style={{ fontSize: '0.64rem', padding: '3px 8px' }}>
                    {exercises.get(pr.exerciseId)?.name ?? ''} PR {pr.weightLb}×{pr.reps} ★
                  </span>
                ))}
              </div>}
              {s.workout.notes && <span className="small" style={{ display: 'block', marginTop: 4 }}>“{s.workout.notes}”</span>}
              <button className="text-button sm" style={{ display: 'block', marginTop: 6 }} aria-label={`Review workout from ${s.workout.date}`} onClick={() => go({ name: 'summary', workoutId: s.workout.id })}>Review / edit sets ›</button>
            </div>
          ))}
          {recent.length === 0 && (
            <div className="card">
              <span className="t" style={{ fontSize: '0.95rem' }}>No sessions yet</span>
              <span className="small" style={{ display: 'block' }}>Your history builds here. First one today?</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
