import { useEffect, useMemo, useRef, useState } from 'react'
import { SetEditor, EditedSetLabel } from '../components/SetEditor'
import { MusclePreview } from '../components/MuscleMap'
import { useAction, useFeedback } from '../components/Feedback'
import { useApp } from '../AppContext'
import type { AiProgram, GymMachine, PrevPerformance, Routine, StrengthBaseline, WorkoutSet } from '../types'
import { machineSupportsExercise } from '../types'

interface Draft { w: string; r: string }
const workoutSelections = new Map<string, string>()
const workoutDrafts = new Map<string, Record<string, Record<number, Draft>>>()

export function WorkoutScreen({ initialExerciseId, initialMachineId }: { initialExerciseId?: string; initialMachineId?: string }) {
  const { api, go, activeWorkout, setActiveWorkout, exercises, startRest } = useApp()
  const [routine, setRoutine] = useState<Routine | null>(null)
  const [sets, setSets] = useState<WorkoutSet[]>([])
  const [editingSetId, setEditingSetId] = useState<string | null>(null)
  const [addedExercises, setAddedExercises] = useState<string[]>(() => Object.keys(workoutDrafts.get(activeWorkout?.id ?? '') ?? {}))
  const [currentId, setCurrentId] = useState<string | undefined>(initialExerciseId ?? workoutSelections.get(activeWorkout?.id ?? ''))
  const [selectedMachineId, setSelectedMachineId] = useState<string | undefined>(initialMachineId)
  const [prev, setPrev] = useState<Record<string, PrevPerformance | undefined>>({})
  const [program, setProgram] = useState<AiProgram | undefined>()
  const [drafts, setDrafts] = useState<Record<string, Record<number, Draft>>>(() => workoutDrafts.get(activeWorkout?.id ?? '') ?? {})
  const [machines, setMachines] = useState<GymMachine[]>([])
  const [baselines, setBaselines] = useState<Map<string, StrengthBaseline>>(new Map())
  const [elapsed, setElapsed] = useState('0:00')
  // set id armed for deletion; disarms itself so a stray tap can't remove work
  const [armedId, setArmedId] = useState<string | null>(null)
  const disarmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const action = useAction()
  const notify = useFeedback()
  const workout = activeWorkout
  useEffect(() => { if (workout) workoutDrafts.set(workout.id, drafts) }, [workout, drafts])
  useEffect(() => { if (workout && currentId) workoutSelections.set(workout.id, currentId) }, [workout, currentId])
  useEffect(() => () => { if (disarmTimer.current) clearTimeout(disarmTimer.current) }, [])

  useEffect(() => {
    if (!workout) return
    let alive = true
    Promise.all([
      workout.routineId ? api.listRoutines().then((rs) => rs.find((r) => r.id === workout.routineId) ?? null) : Promise.resolve(null),
      api.listSets(workout.id),
      api.listMachines(),
      api.listBaselines(),
    ]).then(([r, ss, ms, bs]) => {
      if (!alive) return
      setRoutine(r)
      setSets(ss)
      setMachines(ms)
      setBaselines(new Map(bs.map((b) => [b.id, b])))
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

  // Keep an explicit physical station when it supports the selected movement.
  // A sole compatible machine can be inferred; several require a user choice.
  useEffect(() => {
    if (!currentId || machines.length === 0) return
    setSelectedMachineId((current) => {
      if (current) {
        const selected = machines.find((machine) => machine.id === current)
        if (selected && machineSupportsExercise(selected, currentId)) return current
      }
      const compatible = machines.filter((machine) => machineSupportsExercise(machine, currentId))
      return compatible.length === 1 ? compatible[0]!.id : undefined
    })
  }, [currentId, machines])

  // AI starter programs belong to one machine + exercise pair.
  useEffect(() => {
    let alive = true
    setProgram(undefined)
    if (!currentId || !selectedMachineId) return () => { alive = false }
    api.getAiProgram(selectedMachineId, currentId).then((next) => {
      if (alive) setProgram(next)
    })
    return () => { alive = false }
  }, [api, currentId, selectedMachineId])

  // exercise list: routine order, plus anything logged outside the routine (e.g. scanned machine)
  const exerciseIds = useMemo(() => {
    const ids = routine ? routine.items.map((i) => i.exerciseId) : []
    for (const id of addedExercises) if (!ids.includes(id)) ids.push(id)
    for (const s of sets) if (!ids.includes(s.exerciseId)) ids.push(s.exerciseId)
    if (currentId && !ids.includes(currentId)) ids.push(currentId)
    return ids
  }, [routine, sets, currentId, addedExercises])

  if (!workout) {
    return (
      <div className="page">
        <h1 className="p-h1">No active workout<span className="dot">.</span></h1>
        <p className="p-sub">Pick a routine to get going.</p>
        <button className="big-btn" onClick={() => go({ name: 'routines' })}>Choose routine →</button>
      </div>
    )
  }

  const targetSets = (exerciseId: string) =>
    routine?.items.find((i) => i.exerciseId === exerciseId)?.targetSets ?? (exerciseId === currentId ? program?.sets : undefined) ?? 3

  const logged = sets
    .filter((s) => s.exerciseId === currentId)
    .sort((a, b) => a.setNumber - b.setNumber)
  const perf = currentId ? prev[currentId] : undefined
  // fallbacks only fill the gap until real history exists — history always wins,
  // then the self-reported baseline, then the AI target
  const progTarget = currentId && !perf ? program : undefined
  const baseline = currentId && !perf ? baselines.get(currentId) : undefined
  const rowCount = currentId ? Math.max(targetSets(currentId), logged.length + 1) : 0

  const defaultFor = (i: number): Draft => {
    const d = drafts[currentId ?? '']?.[i]
    if (d) return d
    const fromPrev = perf?.sets[i] ?? perf?.sets[perf.sets.length - 1]
    const before = logged[i - 1]
    const w = fromPrev?.weightLb ?? before?.weightLb ?? baseline?.weightLb ?? progTarget?.startWeightLb
    const r = fromPrev?.reps ?? before?.reps ?? baseline?.reps ?? progTarget?.reps ?? routine?.items.find((item) => item.exerciseId === currentId)?.targetReps
    return { w: w != null ? String(w) : '', r: r != null ? String(r) : '' }
  }

  const logRow = async (i: number) => {
    if (!currentId) return
    const d = defaultFor(i)
    const weightLb = Number(d.w)
    const reps = Number(d.r)
    if (!d.w.trim() || !d.r.trim() || !isFinite(weightLb) || weightLb < 0 || !Number.isInteger(reps) || reps <= 0) return
    const machine = machines.find((candidate) =>
      candidate.id === selectedMachineId && machineSupportsExercise(candidate, currentId),
    )
    const saved = await api.logSet({
      workoutId: workout.id,
      exerciseId: currentId,
      machineId: machine?.id,
      weightLb,
      reps,
      setNumber: Math.max(0, ...logged.map((set) => set.setNumber)) + 1,
    })
    setSets((old) => [...old, saved])
    setDrafts((old) => { const next = { ...old[currentId] }; delete next[i]; return { ...old, [currentId]: next } })
    startRest(progTarget?.restSeconds)
    notify(`Set ${logged.length + 1} saved · ${weightLb} lb × ${reps}`)
  }

  const saveSetEdit = async (values: Pick<WorkoutSet, 'weightLb' | 'reps'>, expected: WorkoutSet) => {
    const updated = await api.updateSet(expected.id, values, expected)
    setSets(old => old.map(set => set.id === updated.id ? updated : set))
    setBaselines(new Map((await api.listBaselines()).map(baseline => [baseline.id, baseline])))
    setEditingSetId(null)
    notify(`Set ${updated.setNumber} updated · ${updated.weightLb} lb × ${updated.reps} reps`)
  }

  const disarm = () => {
    if (disarmTimer.current) clearTimeout(disarmTimer.current)
    disarmTimer.current = null
    setArmedId(null)
  }

  const armDelete = (id: string) => {
    if (disarmTimer.current) clearTimeout(disarmTimer.current)
    setArmedId(id)
    disarmTimer.current = setTimeout(() => setArmedId(null), 3000)
  }

  const deleteRow = async (s: WorkoutSet) => {
    disarm()
    await api.deleteSet(s.id)
    setSets((old) => old.filter((other) => other.id !== s.id))
    // the delete may have rolled the baseline back — re-read so suggestions stay honest
    setBaselines(new Map((await api.listBaselines()).map((b) => [b.id, b])))
  }

  const switchExercise = (id: string) => {
    setAddedExercises((old) => old.includes(id) ? old : [...old, id])
    setDrafts((old) => ({ ...old, [id]: old[id] ?? {} }))
    setEditingSetId(null)
    setCurrentId(id)
    setProgram(undefined)
    disarm()
  }

  const finish = async () => {
    const summary = await api.finishWorkout(workout.id)
    workoutDrafts.delete(workout.id)
    workoutSelections.delete(workout.id)
    setActiveWorkout(undefined)
    go({ name: 'summary', workoutId: summary.workout.id })
  }

  const cancel = async () => {
    if (!confirm('Discard this workout and all its sets?')) return
    await api.cancelWorkout(workout.id)
    workoutDrafts.delete(workout.id)
    workoutSelections.delete(workout.id)
    setActiveWorkout(undefined)
    go({ name: 'routines' })
  }

  const compatibleMachines = currentId
    ? machines.filter((machine) => machineSupportsExercise(machine, currentId))
    : []
  const currentMachine = compatibleMachines.find((machine) => machine.id === selectedMachineId)
  const curName = currentId ? exercises.get(currentId)?.name ?? 'Exercise' : 'Pick an exercise'
  const curMuscles = currentId ? exercises.get(currentId)?.muscleGroups.join(' / ') : ''

  return (
    <div className="page wide">
      <div className="row" style={{ marginBottom: 8 }}>
        <button className="back-link" style={{ margin: 0 }} onClick={() => go({ name: 'routines' })}>
          ‹ {routine ? `${routine.emoji ?? ''} ${routine.name}`.trim() : 'Workout'}
          {routine && ` · ${exerciseIds.filter((id) => sets.some((s) => s.exerciseId === id)).length}/${exerciseIds.length}`}
        </button>
        <span className="num" style={{ fontSize: '1.2rem', color: 'var(--lime)', margin: 0 }}>{elapsed}</span>
      </div>

      <div className="split">
        <div>
          <h1 className="p-h1" style={{ fontSize: '1.6rem' }}>{curName}</h1>
          <p className="p-sub" style={{ textTransform: 'uppercase', fontSize: '0.62rem', letterSpacing: '0.1em', fontWeight: 700 }}>
            {curMuscles}
            {currentMachine && (
              <>
                {' · '}
                <button className="text-button" style={{ fontWeight: 800 }}
                   onClick={() => go({ name: 'machine', machineId: currentMachine.id, exerciseId: currentId })}>
                  {currentMachine.nickname} ▸
                </button>
              </>
            )}
          </p>

          {currentId && exercises.get(currentId) && <MusclePreview exercise={exercises.get(currentId)!} />}

          {currentId && compatibleMachines.length > 1 && (
            <div className="field workout-machine-field">
              <label>Using machine</label>
              <select
                className="text-in"
                value={selectedMachineId ?? ''} disabled={editingSetId !== null}
                onChange={(event) => { setSelectedMachineId(event.target.value || undefined); setProgram(undefined) }}
              >
                <option value="">No machine selected</option>
                {compatibleMachines.map((machine) => (
                  <option key={machine.id} value={machine.id}>{machine.nickname}</option>
                ))}
              </select>
              <span className="small">Choose the station so setup notes and starter targets stay correct.</span>
            </div>
          )}

          {currentId && (
            <div className="card">
              <div className="set-head"><span>#</span><span style={{ textAlign: 'center' }}>lb</span><span style={{ textAlign: 'center' }}>Reps</span><span /></div>
              {Array.from({ length: rowCount }, (_, i) => {
                const done = logged[i]
                const prevHint = perf?.sets[i]
                if (done) {
                  return (
                    <div className="saved-set" key={done.id}>
                    <div className="set-row">
                      <b>{done.setNumber}</b>
                      <div>
                        <div className="logged-val">{done.weightLb}</div>
                        {prevHint && <span className="prev">prev {prevHint.weightLb}×{prevHint.reps}</span>}
                      </div>
                      <div className="logged-val">{done.reps}</div>
                      <button
                        className={`set-done-btn ${armedId === done.id ? 'del-armed' : 'done'}`}
                        title={armedId === done.id ? 'Tap again to remove this set' : 'Remove this set'}
                        disabled={action.busy || editingSetId !== null} onClick={() => (armedId === done.id ? void action.run(() => deleteRow(done)) : armDelete(done.id))}
                      >
                        {armedId === done.id ? '✕' : '✓'}
                      </button>
                    </div>
                    <div className="saved-set-actions"><EditedSetLabel set={done} /><button className="text-button" aria-label={`Edit set ${done.setNumber}`} disabled={action.busy || editingSetId !== null} onClick={() => { disarm(); setEditingSetId(done.id) }}>Edit set</button></div>
                    {editingSetId === done.id && <SetEditor set={done} exerciseName={curName} onSave={saveSetEdit} onCancel={() => setEditingSetId(null)} />}
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
                        aria-label={`Set ${i + 1} weight in pounds`} disabled={action.busy} inputMode="decimal" value={d.w} placeholder="lb"
                        onChange={(e) => setDrafts((old) => ({ ...old, [currentId!]: { ...old[currentId!], [i]: { ...d, w: e.target.value } } }))}
                      />
                      {prevHint
                        ? <span className="prev">prev {prevHint.weightLb}×{prevHint.reps}</span>
                        : isNext && baseline
                        ? <span className="prev">yours {baseline.weightLb}×{baseline.reps}</span>
                        : isNext && progTarget && (
                          <span className="prev">
                            AI target {progTarget.startWeightLb != null ? `${progTarget.startWeightLb}×` : ''}{progTarget.reps}
                          </span>
                        )}
                    </div>
                    <input
                      className={`set-in${isNext ? '' : ' pending'}`}
                      aria-label={`Set ${i + 1} reps`} disabled={action.busy} inputMode="numeric" value={d.r} placeholder="reps"
                      onChange={(e) => setDrafts((old) => ({ ...old, [currentId!]: { ...old[currentId!], [i]: { ...d, r: e.target.value } } }))}
                    />
                    <button className="set-done-btn" aria-label={`Log set ${i + 1}`} disabled={action.busy || editingSetId !== null || !isNext || !d.w.trim() || !d.r.trim() || !Number.isFinite(Number(d.w)) || Number(d.w) < 0 || !Number.isInteger(Number(d.r)) || Number(d.r) <= 0} onClick={() => void action.run(() => logRow(i))}>✓</button>
                  </div>
                )
              })}
            </div>
          )}

          {armedId && <p className="small" role="status">Tap the red × again to remove that set.</p>}
          {currentId && logged.length >= targetSets(currentId) && <div className="card">
            <p className="small lm" role="status">Target complete · {logged.length} sets saved</p>
            {exerciseIds.find((id) => id !== currentId && sets.filter((s) => s.exerciseId === id).length < targetSets(id)) && <button className="ghost-btn" disabled={editingSetId !== null} onClick={() => switchExercise(exerciseIds.find((id) => id !== currentId && sets.filter((s) => s.exerciseId === id).length < targetSets(id))!)}>Next exercise →</button>}
          </div>}
          {perf && (
            <p className="lab" style={{ margin: '0 0 12px' }}>
              Last time ({perf.workoutDate.slice(5).replace('-', '/')}) ·{' '}
              {perf.sets.map((s) => `${s.weightLb}×${s.reps}`).join(' · ')}
            </p>
          )}
        </div>

        <div className="side">
          <p className="section-label" style={{ marginTop: 16 }}>Exercises</p>
          <div className="field">
            <select className="text-in" aria-label="Add an exercise to workout" value="" disabled={action.busy || editingSetId !== null} onChange={(e) => { if (e.target.value) switchExercise(e.target.value) }}>
              <option value="">＋ Add an exercise…</option>
              {[...exercises.values()].filter((ex) => !exerciseIds.includes(ex.id)).map((ex) => <option key={ex.id} value={ex.id}>{ex.name}</option>)}
            </select>
            {!exerciseIds.length && <p className="small">Choose an exercise above or scan a machine to start logging.</p>}
          </div>
          {exerciseIds.map((id) => {
            const count = sets.filter((s) => s.exerciseId === id).length
            const target = targetSets(id)
            return (
              <button
                key={id} disabled={action.busy || editingSetId !== null} aria-pressed={id === currentId}
                className={`exercise-pill${id === currentId ? ' current' : ''}`}
                onClick={() => switchExercise(id)}
              >
                <div className="row">
                  <b>{exercises.get(id)?.name ?? id}</b>
                  <span className="small">{count}/{target} sets</span>
                </div>
              </button>
            )
          })}

          <div style={{ height: 14 }} />
          <button className="big-btn blue" onClick={() => void action.run(finish)} disabled={action.busy || editingSetId !== null || sets.length === 0}>
            Finish workout →
          </button>
          <div style={{ height: 8 }} />
          <button className="ghost-btn danger" disabled={action.busy || editingSetId !== null} onClick={() => void action.run(cancel)}>Discard workout</button>
        </div>
      </div>
    </div>
  )
}
