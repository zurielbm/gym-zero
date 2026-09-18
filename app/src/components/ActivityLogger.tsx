import { useEffect, useRef, useState } from 'react'
import { useApp } from '../AppContext'
import type { ActivityLog, Exercise, RoutineItem } from '../types'
import { formatActivity } from '../lib/exercises'

export function ActivityLogger({ exercise, workoutId, machineId, entries, target, onChange, onBusyChange }: {
  exercise: Exercise; workoutId: string; machineId?: string; entries: ActivityLog[]; target?: RoutineItem
  onChange: (entries: ActivityLog[]) => void; onBusyChange: (busy: boolean) => void
}) {
  const { api, startRest } = useApp()
  const [minutes, setMinutes] = useState(target?.targetDurationSec ? String(target.targetDurationSec / 60) : '')
  const [distance, setDistance] = useState(target?.targetDistanceMiles !== undefined ? String(target.targetDistanceMiles) : '')
  const [resistance, setResistance] = useState('')
  const [previous, setPrevious] = useState<ActivityLog[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [armed, setArmed] = useState<string>()
  const lock = useRef(false)
  const alive = useRef(true)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    alive.current = true
    api.getPrevActivities(exercise.id, workoutId).then((logs) => { if (alive.current) setPrevious(logs) }).catch(() => {})
    return () => { alive.current = false; clearTimeout(timer.current) }
  }, [api, exercise.id, workoutId])
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return
    lock.current = true; setBusy(true); onBusyChange(true); setError('')
    try { await action() }
    catch (err) { if (alive.current) setError(err instanceof Error ? err.message : String(err)) }
    finally { lock.current = false; if (alive.current) setBusy(false); onBusyChange(false) }
  }
  const durationSec = Number(minutes) * 60
  const valid = minutes.trim() && Number.isFinite(durationSec) && durationSec > 0
    && (!distance.trim() || (Number.isFinite(Number(distance)) && Number(distance) >= 0))
    && (!resistance.trim() || (Number.isFinite(Number(resistance)) && Number(resistance) >= 0))
  const save = () => run(async () => {
    if (!valid) return
    const format = exercise.recordingFormat
    if (format !== 'duration' && format !== 'duration-distance' && format !== 'timed-sets') return
    const entry = await api.logActivity({
      workoutId, exerciseId: exercise.id, machineId, recordingFormat: format,
      durationSec, ...(distance.trim() ? { distanceMiles: Number(distance) } : {}),
      ...(resistance.trim() ? { resistance: Number(resistance) } : {}),
      entryNumber: Math.max(0, ...entries.map((a) => a.entryNumber)) + 1,
    })
    onChange([...entries, entry])
    if (format === 'timed-sets') startRest()
  })
  const remove = (id: string) => {
    if (armed !== id) {
      setArmed(id); clearTimeout(timer.current); timer.current = setTimeout(() => setArmed(undefined), 3000)
      return
    }
    void run(async () => { await api.deleteActivity(id); onChange(entries.filter((entry) => entry.id !== id)); setArmed(undefined) })
  }
  return <div className="card">
    <span className="lab lm">{exercise.recordingFormat === 'timed-sets' ? 'Timed sets' : 'Log activity'}</span>
    <p className="small">Enter the time you completed. Distance and resistance are optional.</p>
    {entries.map((entry, index) => <div className="meal-row" key={entry.id}>
      <span><b>{index + 1}. </b>{formatActivity(entry)}</span>
      <button className="icon-btn" disabled={busy} aria-label={armed === entry.id ? 'Confirm remove activity' : 'Remove activity'}
        onClick={() => remove(entry.id)}>{armed === entry.id ? 'Remove?' : '×'}</button>
    </div>)}
    <div className="field">
      <label htmlFor="activity-minutes">Minutes</label>
      <input id="activity-minutes" className="text-in" inputMode="decimal" placeholder="20" value={minutes} disabled={busy} onChange={(e) => setMinutes(e.target.value)} />
    </div>
    <div className="in-grid">
      <div className="field">
        <label htmlFor="activity-distance">Distance · miles (optional)</label>
        <input id="activity-distance" className="text-in" inputMode="decimal" placeholder="—" value={distance} disabled={busy} onChange={(e) => setDistance(e.target.value)} />
      </div>
      <div className="field">
        <label htmlFor="activity-resistance">Resistance level (optional)</label>
        <input id="activity-resistance" className="text-in" inputMode="decimal" placeholder="—" value={resistance} disabled={busy} onChange={(e) => setResistance(e.target.value)} />
      </div>
    </div>
    {error && <p role="alert" className="small" style={{ color: 'var(--danger)' }}>{error}</p>}
    <button className="big-btn" disabled={!valid || busy} onClick={() => void save()}>{busy ? 'Saving…' : exercise.recordingFormat === 'timed-sets' ? 'Log timed set ✓' : 'Log activity ✓'}</button>
    {previous.length > 0 && <p className="small">Last time: {previous.map(formatActivity).join(' / ')}</p>}
  </div>
}
