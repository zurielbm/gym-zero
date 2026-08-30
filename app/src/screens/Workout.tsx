import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../AppContext'
import type { AiProgram, GymMachine, PrevPerformance, Routine, StrengthBaseline, WorkoutSet } from '../types'

interface Draft { w: string; r: string }

export function WorkoutScreen({ initialExerciseId }: { initialExerciseId?: string }) {
  const { api, go, activeWorkout, setActiveWorkout, exercises, startRest } = useApp()
  const [routine, setRoutine] = useState<Routine | null>(null)
  const [sets, setSets] = useState<WorkoutSet[]>([])
  const [currentId, setCurrentId] = useState<string | undefined>(initialExerciseId)
  const [prev, setPrev] = useState<Record<string, PrevPerformance | undefined>>({})
  const [programs, setPrograms] = useState<Record<string, AiProgram | undefined>>({})
  const [drafts, setDrafts] = useState<Record<number, Draft>>({})
  const [machines, setMachines] = useState<GymMachine[]>([])
  const [baselines, setBaselines] = useState<Map<string, StrengthBaseline>>(new Map())
  const [elapsed, setElapsed] = useState('0:00')
  // set id armed for deletion; disarms itself so a stray tap can't remove work
  const [armedId, setArmedId] = useState<string | null>(null)
  const disarmTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const workout = activeWorkout

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

  // AI starter program for the current exercise's machine (fallback targets when no history)
  useEffect(() => {
    if (!currentId || machines.length === 0 || currentId in programs) return
    const machine = machines.find((m) => m.exerciseId === currentId)
    if (!machine) { setPrograms((old) => ({ ...old, [currentId]: undefined })); return }
    api.getAiProgram(machine.id).then((p) => setPrograms((old) => ({ ...old, [currentId]: p })))
  }, [api, currentId, machines, programs])

  // exercise list: routine order, plus anything logged outside the routine (e.g. scanned machine)
  const exerciseIds = useMemo(() => {
    const ids = routine ? routine.items.map((i) => i.exerciseId) : []
    for (const s of sets) if (!ids.includes(s.exerciseId)) ids.push(s.exerciseId)
    if (currentId && !ids.includes(currentId)) ids.push(currentId)
    return ids
  }, [routine, sets, currentId])

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
    routine?.items.find((i) => i.exerciseId === exerciseId)?.targetSets ?? programs[exerciseId]?.sets ?? 3

  const logged = sets
    .filter((s) => s.exerciseId === currentId)
    .sort((a, b) => a.setNumber - b.setNumber)
  const perf = currentId ? prev[currentId] : undefined
  // fallbacks only fill the gap until real history exists — history always wins,
  // then the self-reported baseline, then the AI target
  const progTarget = currentId && !perf ? programs[currentId] : undefined
  const baseline = currentId && !perf ? baselines.get(currentId) : undefined
  const rowCount = currentId ? Math.max(targetSets(currentId), logged.length + 1) : 0

  const defaultFor = (i: number): Draft => {
    const d = drafts[i]
    if (d) return d
    const fromPrev = perf?.sets[i] ?? perf?.sets[perf.sets.length - 1]
    const before = logged[i - 1]
    const w = fromPrev?.weightLb ?? before?.weightLb ?? baseline?.weightLb ?? progTarget?.startWeightLb
    const r = fromPrev?.reps ?? before?.reps ?? baseline?.reps ?? progTarget?.reps
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
    startRest(progTarget?.restSeconds)
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
    setCurrentId(id)
    setDrafts({})
    disarm()
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
                <a style={{ cursor: 'pointer', textDecoration: 'none', fontWeight: 800 }}
                   onClick={() => go({ name: 'machine', machineId: currentMachine.id })}>
                  {currentMachine.nickname} ▸
                </a>
              </>
            )}
          </p>

          {currentId && (
            <div className="card">
              <div className="set-head"><span>#</span><span style={{ textAlign: 'center' }}>lb</span><span style={{ textAlign: 'center' }}>Reps</span><span /></div>
              {Array.from({ length: rowCount }, (_, i) => {
                const done = logged[i]
                const prevHint = perf?.sets[i]
                if (done) {
                  return (
                    <div className="set-row" key={i}>
                      <b>{i + 1}</b>
                      <div>
                        <div className="logged-val">{done.weightLb}</div>
                        {prevHint && <span className="prev">prev {prevHint.weightLb}×{prevHint.reps}</span>}
                      </div>
                      <div className="logged-val">{done.reps}</div>
                      <button
                        className={`set-done-btn ${armedId === done.id ? 'del-armed' : 'done'}`}
                        title={armedId === done.id ? 'Tap again to remove this set' : 'Remove this set'}
                        onClick={() => (armedId === done.id ? void deleteRow(done) : armDelete(done.id))}
                      >
                        {armedId === done.id ? '✕' : '✓'}
                      </button>
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
            <p className="lab" style={{ margin: '0 0 12px' }}>
              Last time ({perf.workoutDate.slice(5).replace('-', '/')}) ·{' '}
              {perf.sets.map((s) => `${s.weightLb}×${s.reps}`).join(' · ')}
            </p>
          )}
        </div>

        <div className="side">
          <p className="section-label" style={{ marginTop: 16 }}>Queue</p>
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

          <div style={{ height: 14 }} />
          <button className="big-btn blue" onClick={finish} disabled={sets.length === 0}>
            Finish workout →
          </button>
          <div style={{ height: 8 }} />
          <button className="ghost-btn danger" onClick={cancel}>Discard workout</button>
        </div>
      </div>
    </div>
  )
}
