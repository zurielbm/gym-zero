import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../AppContext'
import type { GymMachine, PrevPerformance, Routine, WorkoutSet } from '../types'

interface Draft { w: string; r: string }

export function WorkoutScreen({ initialExerciseId }: { initialExerciseId?: string }) {
  const { api, go, activeWorkout, setActiveWorkout, exercises, startRest } = useApp()
  const [routine, setRoutine] = useState<Routine | null>(null)
  const [sets, setSets] = useState<WorkoutSet[]>([])
  const [currentId, setCurrentId] = useState<string | undefined>(initialExerciseId)
  const [prev, setPrev] = useState<Record<string, PrevPerformance | undefined>>({})
  const [drafts, setDrafts] = useState<Record<number, Draft>>({})
  const [machines, setMachines] = useState<GymMachine[]>([])
  const [elapsed, setElapsed] = useState('0:00')

  const workout = activeWorkout

  useEffect(() => {
    if (!workout) return
    let alive = true
    Promise.all([
      workout.routineId ? api.listRoutines().then((rs) => rs.find((r) => r.id === workout.routineId) ?? null) : Promise.resolve(null),
      api.listSets(workout.id),
      api.listMachines(),
    ]).then(([r, ss, ms]) => {
      if (!alive) return
      setRoutine(r)
      setSets(ss)
      setMachines(ms)
      setCurrentId((cur) => {
        if (cur) return cur
        // first exercise with unfinished target sets, else first item, else first logged
        if (r) {
          const open = r.items.find(
            (it) => ss.filter((s) => s.exerciseId === it.exerciseId).length < it.targetSets,
          )
          return (open ?? r.items[0])?.exerciseId
        }
        return ss[0]?.exerciseId
      })
    })
    return () => { alive = false }
  }, [api, workout])

  // workout clock
  useEffect(() => {
    if (!workout) return
    const tick = () => {
      const s = Math.max(0, Math.floor((Date.now() - workout.startedAt) / 1000))
      setElapsed(`${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`)
    }
    tick()
    const t = setInterval(tick, 1000)
    return () => clearInterval(t)
  }, [workout])

  // previous performance for the current exercise
  useEffect(() => {
    if (!workout || !currentId || currentId in prev) return
    api.getPrevPerformance(currentId, workout.id).then((p) =>
      setPrev((old) => ({ ...old, [currentId]: p })),
    )
  }, [api, workout, currentId, prev])

  // exercise list: routine order, plus anything logged outside the routine (e.g. scanned machine)
  const exerciseIds = useMemo(() => {
    const ids = routine ? routine.items.map((i) => i.exerciseId) : []
    for (const s of sets) if (!ids.includes(s.exerciseId)) ids.push(s.exerciseId)
    if (currentId && !ids.includes(currentId)) ids.push(currentId)
    return ids
  }, [routine, sets, currentId])

  if (!workout) {
    return (
      <>
        <h1 className="p-h1">No active workout</h1>
        <p className="p-sub">Pick a routine to get going.</p>
        <button className="big-btn" onClick={() => go({ name: 'routines' })}>Choose routine</button>
      </>
    )
  }

  const targetSets = (exerciseId: string) =>
    routine?.items.find((i) => i.exerciseId === exerciseId)?.targetSets ?? 3

  const logged = sets
    .filter((s) => s.exerciseId === currentId)
    .sort((a, b) => a.setNumber - b.setNumber)
  const perf = currentId ? prev[currentId] : undefined
  const rowCount = currentId ? Math.max(targetSets(currentId), logged.length + 1) : 0

  const defaultFor = (i: number): Draft => {
    const d = drafts[i]
    if (d) return d
    const fromPrev = perf?.sets[i] ?? perf?.sets[perf.sets.length - 1]
    const before = logged[i - 1]
    const w = fromPrev?.weightLb ?? before?.weightLb
    const r = fromPrev?.reps ?? before?.reps
    return { w: w != null ? String(w) : '', r: r != null ? String(r) : '' }
  }

  const logRow = async (i: number) => {
    if (!currentId) return
    const d = defaultFor(i)
    const weightLb = parseFloat(d.w)
    const reps = parseInt(d.r, 10)
    if (!isFinite(weightLb) || !isFinite(reps) || reps <= 0) return
    const machine = machines.find((m) => m.exerciseId === currentId)
    const saved = await api.logSet({
      workoutId: workout.id,
      exerciseId: currentId,
      machineId: machine?.id,
      weightLb,
      reps,
      setNumber: i + 1,
    })
    setSets((old) => [...old, saved])
    setDrafts((old) => { const n = { ...old }; delete n[i]; return n })
    startRest()
  }

  const switchExercise = (id: string) => {
    setCurrentId(id)
    setDrafts({})
  }

  const finish = async () => {
    const summary = await api.finishWorkout(workout.id)
    setActiveWorkout(undefined)
    go({ name: 'summary', workoutId: summary.workout.id })
  }

  const cancel = async () => {
    if (!confirm('Discard this workout and all its sets?')) return
    await api.cancelWorkout(workout.id)
    setActiveWorkout(undefined)
    go({ name: 'routines' })
  }

  const currentMachine = machines.find((m) => m.exerciseId === currentId)
  const curName = currentId ? exercises.get(currentId)?.name ?? 'Exercise' : 'Pick an exercise'
  const curMuscles = currentId ? exercises.get(currentId)?.muscleGroups.join(' / ') : ''

  return (
    <>
      <div className="row" style={{ marginBottom: 8 }}>
        <button className="back-link" style={{ margin: 0 }} onClick={() => go({ name: 'routines' })}>
          ‹ {routine ? `${routine.emoji ?? ''} ${routine.name}`.trim() : 'Workout'}
        </button>
        <span className="chip green" style={{ margin: 0 }}>{elapsed}</span>
      </div>

      <h1 className="p-h1" style={{ fontSize: '1.25rem' }}>{curName}</h1>
      <p className="p-sub" style={{ textTransform: 'capitalize' }}>
        {curMuscles}
        {currentMachine && (
          <>
            {' · '}
            <a style={{ cursor: 'pointer', textDecoration: 'none' }}
               onClick={() => go({ name: 'machine', machineId: currentMachine.id })}>
              {currentMachine.nickname} ▸
            </a>
          </>
        )}
      </p>

      {currentId && (
        <div className="card">
          <div className="set-head"><span>Set</span><span>lb</span><span>Reps</span><span /></div>
          {Array.from({ length: rowCount }, (_, i) => {
            const done = logged[i]
            const prevHint = perf?.sets[i]
            if (done) {
              return (
                <div className="set-row" key={i}>
                  <b>{i + 1}</b>
                  <div>
                    <div className="set-in" style={{ background: 'transparent', borderColor: 'transparent' }}>{done.weightLb}</div>
                    {prevHint && <span className="prev">prev {prevHint.weightLb}×{prevHint.reps}</span>}
                  </div>
                  <div className="set-in" style={{ background: 'transparent', borderColor: 'transparent' }}>{done.reps}</div>
                  <button className="set-done-btn done">✓</button>
                </div>
              )
            }
            const isNext = i === logged.length
            const d = defaultFor(i)
            return (
              <div className="set-row" key={i}>
                <b className={isNext ? '' : 'faint'}>{i + 1}</b>
                <div>
                  <input
                    className={`set-in${isNext ? '' : ' pending'}`}
                    inputMode="decimal" value={d.w} placeholder="lb"
                    onChange={(e) => setDrafts((old) => ({ ...old, [i]: { ...d, w: e.target.value } }))}
                  />
                  {prevHint && <span className="prev">prev {prevHint.weightLb}×{prevHint.reps}</span>}
                </div>
                <input
                  className={`set-in${isNext ? '' : ' pending'}`}
                  inputMode="numeric" value={d.r} placeholder="reps"
                  onChange={(e) => setDrafts((old) => ({ ...old, [i]: { ...d, r: e.target.value } }))}
                />
                <button className="set-done-btn" disabled={!isNext} onClick={() => logRow(i)}>✓</button>
              </div>
            )
          })}
        </div>
      )}

      {perf && (
        <p className="small" style={{ margin: '0 0 12px' }}>
          Last time ({perf.workoutDate.slice(5).replace('-', '/')}):{' '}
          {perf.sets.map((s) => `${s.weightLb}×${s.reps}`).join(' · ')}
        </p>
      )}

      <p className="section-label">Exercises</p>
      {exerciseIds.map((id) => {
        const count = sets.filter((s) => s.exerciseId === id).length
        const target = targetSets(id)
        return (
          <div
            key={id}
            className={`exercise-pill${id === currentId ? ' current' : ''}`}
            onClick={() => switchExercise(id)}
          >
            <div className="row">
              <b>{exercises.get(id)?.name ?? id}</b>
              <span className="small">{count}/{target} sets</span>
            </div>
          </div>
        )
      })}

      <div style={{ height: 8 }} />
      <button className="big-btn blue" onClick={finish} disabled={sets.length === 0}>
        Finish workout
      </button>
      <div style={{ height: 8 }} />
      <button className="ghost-btn danger" onClick={cancel}>Discard workout</button>
    </>
  )
}
