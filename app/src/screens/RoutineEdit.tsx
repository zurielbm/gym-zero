import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../AppContext'
import type { Routine } from '../types'

/** One exercise row while editing; numbers stay strings until save. */
interface ItemDraft { exerciseId: string; sets: string; reps: string }

export function RoutineEditScreen({ routineId }: { routineId?: string }) {
  const { api, go, exercises } = useApp()
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
    setItems((old) => [...old, { exerciseId: addId, sets: '3', reps: '10' }])
    setAddId('')
  }

  const parsedItems = items.map((i) => ({
    exerciseId: i.exerciseId,
    targetSets: parseInt(i.sets, 10),
    targetReps: i.reps.trim() ? parseInt(i.reps, 10) : undefined,
  }))
  const valid = name.trim().length > 0
    && parsedItems.length > 0
    && parsedItems.every((i) => isFinite(i.targetSets) && i.targetSets >= 1
      && (i.targetReps === undefined || (isFinite(i.targetReps) && i.targetReps >= 1)))

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
      <p className="p-sub">Pick the machines, set the targets — weights come from your history.</p>

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
        {items.map((item, i) => (
          <div key={item.exerciseId} style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
            <span style={{ display: 'flex', flexDirection: 'column' }}>
              <button className="icon-btn" style={{ fontSize: '0.8rem', minWidth: 40, minHeight: 30 }} title="Move up"
                disabled={i === 0} onClick={() => move(i, -1)}>▲</button>
              <button className="icon-btn" style={{ fontSize: '0.8rem', minWidth: 40, minHeight: 30 }} title="Move down"
                disabled={i === items.length - 1} onClick={() => move(i, 1)}>▼</button>
            </span>
            <span className="small" style={{ flex: 1, color: 'var(--ink)', minWidth: 0 }}>
              {exercises.get(item.exerciseId)?.name ?? item.exerciseId}
            </span>
            <input className="text-in" inputMode="numeric" placeholder="sets" title="Sets"
              style={{ width: 52, textAlign: 'center' }} value={item.sets}
              onChange={(e) => patchItem(i, { sets: e.target.value })} />
            <span className="lab">×</span>
            <input className="text-in" inputMode="numeric" placeholder="reps" title="Target reps (optional)"
              style={{ width: 52, textAlign: 'center' }} value={item.reps}
              onChange={(e) => patchItem(i, { reps: e.target.value })} />
            <button className="icon-btn" title="Remove exercise"
              onClick={() => setItems((old) => old.filter((_, j) => j !== i))}>✕</button>
          </div>
        ))}
        {remaining.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
            <select className="text-in" value={addId} onChange={(e) => setAddId(e.target.value)}>
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
        <span className="small" style={{ display: 'block', marginTop: 8 }}>
          Sets × target reps per exercise. Leave reps blank to decide on the day.
        </span>
      </div>

      {items.length > 0 && (
        <p className="lab" style={{ margin: '0 0 12px' }}>
          {items.length} exercise{items.length === 1 ? '' : 's'} · {totalSets} sets · about {Math.max(5, Math.round(totalSets * 3))} min
        </p>
      )}

      <button className="big-btn" disabled={!valid} onClick={() => void save()}>
        Save routine →
      </button>

      {routine && (
        <>
          <div style={{ height: 8 }} />
          <button className="ghost-btn danger" onClick={() => void remove()}>
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
