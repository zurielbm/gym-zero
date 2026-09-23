import { useEffect, useMemo, useState } from 'react'
import { MuscleMap, MusclePreview } from '../components/MuscleMap'
import { useAction, useFeedback } from '../components/Feedback'
import { useApp } from '../AppContext'
import { isTimedExercise, recordingFormat } from '../types'
import type { Routine } from '../types'

/** One exercise row while editing; numbers stay strings until save. */
interface ItemDraft { exerciseId: string; sets: string; reps: string; minutes: string; distance: string }

export function RoutineEditScreen({ routineId }: { routineId?: string }) {
  const { api, go, exercises } = useApp()
  const action = useAction()
  const notify = useFeedback()
  const [routine, setRoutine] = useState<Routine | null>(null)
  const [loaded, setLoaded] = useState(!routineId)
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('')
  const [items, setItems] = useState<ItemDraft[]>([])
  const [addId, setAddId] = useState('')
  const [deleteArmed, setDeleteArmed] = useState(false)

  useEffect(() => {
    if (!routineId) return
    api.listRoutines().then((all) => {
      const r = all.find((other) => other.id === routineId) ?? null
      setRoutine(r)
      if (r) {
        setName(r.name)
        setEmoji(r.emoji ?? '')
        setItems(r.items.map((i) => ({
          exerciseId: i.exerciseId,
          sets: String(i.targetSets),
          reps: i.targetReps != null ? String(i.targetReps) : '',
          minutes: i.targetDurationSec != null ? String(i.targetDurationSec / 60) : '',
          distance: i.targetDistanceMiles != null ? String(i.targetDistanceMiles) : '',
        })))
      }
      setLoaded(true)
    })
  }, [api, routineId])

  const remaining = useMemo(
    () => [...exercises.values()]
      .filter((ex) => !items.some((i) => i.exerciseId === ex.id))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [exercises, items],
  )

  const patchItem = (index: number, patch: Partial<ItemDraft>) =>
    setItems((old) => old.map((item, i) => (i === index ? { ...item, ...patch } : item)))

  const move = (index: number, dir: -1 | 1) =>
    setItems((old) => {
      const next = [...old]
      const target = index + dir
      if (target < 0 || target >= next.length) return old
      ;[next[index], next[target]] = [next[target], next[index]]
      return next
    })

  const add = () => {
    if (!addId) return
    setItems((old) => [...old, { exerciseId: addId, sets: isTimedExercise(exercises.get(addId)) && recordingFormat(exercises.get(addId)) !== 'timed-sets' ? '1' : '3', reps: isTimedExercise(exercises.get(addId)) ? '' : '10', minutes: '', distance: '' }])
    setAddId('')
  }

  const parsedItems = items.map((i) => ({
    exerciseId: i.exerciseId,
    targetSets: Number(i.sets),
    targetReps: !isTimedExercise(exercises.get(i.exerciseId)) && i.reps.trim() ? Number(i.reps) : undefined,
    targetDurationSec: isTimedExercise(exercises.get(i.exerciseId)) && i.minutes.trim() ? Number(i.minutes) * 60 : undefined,
    targetDistanceMiles: isTimedExercise(exercises.get(i.exerciseId)) && i.distance.trim() ? Number(i.distance) : undefined,
  }))
  const valid = name.trim().length > 0
    && parsedItems.length > 0
    && parsedItems.every((i) => Number.isInteger(i.targetSets) && i.targetSets >= 1 && i.targetSets <= 10
      && (i.targetReps === undefined || (Number.isInteger(i.targetReps) && i.targetReps >= 1 && i.targetReps <= 50))
      && (i.targetDurationSec === undefined || (Number.isFinite(i.targetDurationSec) && i.targetDurationSec > 0))
      && (i.targetDistanceMiles === undefined || (Number.isFinite(i.targetDistanceMiles) && i.targetDistanceMiles >= 0)))

  const plannedMinutes = parsedItems.reduce((total, i) => total + (isTimedExercise(exercises.get(i.exerciseId)) ? (i.targetDurationSec ?? 0) / 60 * i.targetSets : i.targetSets * 3), 0)
  const totalSets = parsedItems.reduce((t, i) => t + (isFinite(i.targetSets) ? i.targetSets : 0), 0)

  const save = async () => {
    if (!valid) return
    await api.saveRoutine({
      id: routine?.id ?? crypto.randomUUID(),
      name: name.trim(),
      emoji: emoji.trim() || undefined,
      items: parsedItems.map((i) => ({ ...i, targetSets: Math.min(10, i.targetSets), targetReps: i.targetReps !== undefined ? Math.min(50, i.targetReps) : undefined })),
      lastUsedAt: routine?.lastUsedAt,
    })
    notify('Routine saved')
    go({ name: 'routines' })
  }

  const remove = async () => {
    if (!routine) return
    if (!deleteArmed) { setDeleteArmed(true); setTimeout(() => setDeleteArmed(false), 3000); return }
    await api.deleteRoutine(routine.id)
    go({ name: 'routines' })
  }

  if (!loaded) return <div className="page"><p className="small">Loading…</p></div>

  if (routineId && !routine) {
    return (
      <div className="page">
        <button className="back-link" onClick={() => go({ name: 'routines' })}>‹ Routines</button>
        <p className="small">That routine isn't here anymore.</p>
      </div>
    )
  }

  return (
    <div className="page">
      <button className="back-link" onClick={() => go({ name: 'routines' })}>‹ Routines</button>
      <h1 className="p-h1">{routine ? 'Edit routine' : 'New routine'}<span className="dot">.</span></h1>
      <p className="p-sub">Pick exercises and set targets for reps or time.</p>

      <div style={{ display: 'flex', gap: 8 }}>
        <div className="field" style={{ flex: 1 }}>
          <label>Name</label>
          <input className="text-in" autoFocus={!routine} value={name} placeholder="Push day"
            onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="field" style={{ width: 74 }}>
          <label>Emoji</label>
          <input className="text-in" value={emoji} placeholder="💪" style={{ textAlign: 'center' }}
            onChange={(e) => setEmoji(e.target.value.slice(0, 4))} />
        </div>
      </div>

      <div className="card">
        <span className="lab">Exercises</span>
        {items.length === 0 && (
          <span className="small" style={{ display: 'block', marginTop: 6 }}>
            Nothing yet — add your first exercise below.
          </span>
        )}
        {items.map((item, i) => {
          const timed = isTimedExercise(exercises.get(item.exerciseId))
          return (
          <div key={item.exerciseId} className="routine-item">
            <span style={{ display: 'flex', flexDirection: 'column' }}>
              <button className="icon-btn" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}>▲</button>
              <button className="icon-btn" title="Move down" disabled={i === items.length - 1} onClick={() => move(i, 1)}>▼</button>
            </span>
            <div>
              <b className="small" style={{ color: 'var(--ink)' }}>{exercises.get(item.exerciseId)?.name ?? item.exerciseId}</b>
              <div className="item-targets">
                <label className="small">{timed ? 'Entries' : 'Sets'}<input className="text-in" inputMode="numeric" placeholder="sets" title="Sets" value={item.sets} onChange={(e) => patchItem(i, { sets: e.target.value })} /></label>
                <span className="lab">×</span>
                <label className="small">{timed ? 'Minutes' : 'Reps'}<input className="text-in" inputMode={timed ? 'decimal' : 'numeric'} placeholder={timed ? 'min' : 'reps'} title={timed ? 'Target minutes (optional)' : 'Target reps (optional)'} aria-label={timed ? 'Target minutes (optional)' : 'Target reps (optional)'} value={timed ? item.minutes : item.reps} onChange={(e) => patchItem(i, timed ? { minutes: e.target.value } : { reps: e.target.value })} /></label>
                {timed && <label className="small">Miles<input className="text-in" inputMode="decimal" placeholder="mi" title="Target miles (optional)" aria-label="Target miles (optional)" value={item.distance} onChange={(e) => patchItem(i, { distance: e.target.value })} /></label>}
              </div>
              {exercises.get(item.exerciseId) && <MusclePreview exercise={exercises.get(item.exerciseId)!} />}
            </div>
            <button className="icon-btn" title="Remove exercise" aria-label={`Remove ${exercises.get(item.exerciseId)?.name ?? 'exercise'}`} onClick={() => setItems((old) => old.filter((_, j) => j !== i))}>✕</button>
          </div>
        )})}
        {remaining.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <select className="text-in" aria-label="Exercise to add to routine" value={addId} onChange={(e) => setAddId(e.target.value)}>
              <option value="">Add an exercise…</option>
              {remaining.map((ex) => (
                <option key={ex.id} value={ex.id}>{ex.name}</option>
              ))}
            </select>
            <button className="ghost-btn" style={{ width: 'auto', padding: '0 18px' }} disabled={!addId} onClick={add}>
              Add
            </button>
          </div>
        )}
        {addId && exercises.get(addId) && <MuscleMap exercise={exercises.get(addId)!} />}
        <span className="small" style={{ display: 'block', marginTop: 8 }}>
          Choose sets × reps, or entries × minutes. Time, distance and rep targets can be left blank to decide on the day.
        </span>
      </div>

      {items.length > 0 && (
        <p className="lab" style={{ margin: '0 0 12px' }}>
          {items.length} exercise{items.length === 1 ? '' : 's'} · {totalSets} planned entries · {Math.round(plannedMinutes)} planned min
        </p>
      )}

      <button className="big-btn" disabled={!valid || action.busy} onClick={() => void action.run(save)}>
        Save routine →
      </button>

      {routine && (
        <>
          <div style={{ height: 8 }} />
          <button className="ghost-btn danger" disabled={action.busy} onClick={() => void action.run(remove)}>
            {deleteArmed ? 'Tap again to delete' : 'Delete routine'}
          </button>
          <span className="small" style={{ display: 'block', marginTop: 6 }}>
            Deleting a routine never touches your workout history.
          </span>
        </>
      )}
    </div>
  )
}
