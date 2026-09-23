import { useEffect, useMemo, useState } from 'react'
import { SetEditor, EditedSetLabel } from '../components/SetEditor'
import { useAction, useFeedback } from '../components/Feedback'
import { WorkoutMuscleMap } from '../components/WorkoutMuscleMap'
import { WorkoutAiReview } from '../components/WorkoutAiReview'
import { useApp } from '../AppContext'
import type { WorkoutSummary, WorkoutSet } from '../types'
import { formatActivity } from '../lib/exercises'
import { muscleLabels, type MuscleRegion } from '../lib/exercise-muscles'
import { buildWorkoutOverview, type OverviewExercise } from '../lib/workout-overview'
import type { ActivityLog } from '../types'
import './summary.css'

const minutes = (sec: number) => Number((sec / 60).toFixed(1))
const plural = (count: number, word: string) => `${count.toLocaleString()} ${word}${count === 1 ? '' : 's'}`
const regionNames = (regions: MuscleRegion[]) => regions.map(region => muscleLabels[region]).join(', ')

function Duration({ sec }: { sec: number }) {
  const total = Math.max(1, Math.round(sec / 60))
  if (total < 60) return <span className="num">{total}<span className="unit">min</span></span>
  return <span className="num">{Math.floor(total / 60)}<span className="unit">h</span> {total % 60}<span className="unit">min</span></span>
}

function exerciseLine(exercise: OverviewExercise) {
  const parts: string[] = []
  if (exercise.sets) {
    parts.push(plural(exercise.sets, 'set'), plural(exercise.reps, 'rep'))
    if (exercise.topSet) parts.push(`top ${exercise.topSet.weightLb} lb × ${exercise.topSet.reps}`)
    if (exercise.volumeLb > 0) parts.push(`${Math.round(exercise.volumeLb).toLocaleString()} lb`)
  }
  if (exercise.entries) {
    parts.push(`${minutes(exercise.durationSec)} min`)
    if (exercise.distanceMiles > 0) parts.push(`${Number(exercise.distanceMiles.toFixed(2))} mi`)
    if (exercise.entries > 1) parts.push(`${exercise.entries} entries`)
  }
  return parts.join(' · ')
}

export function SummaryScreen({ workoutId }: { workoutId: string }) {
  const { api, go, exercises } = useApp()
  const action = useAction()
  const notify = useFeedback()
  const [loaded, setLoaded] = useState(false)
  const [summary, setSummary] = useState<WorkoutSummary | null>(null)
  const [sets, setSets] = useState<WorkoutSet[]>([])
  const [machines, setMachines] = useState<Record<string, string>>({})
  const [editingSetId, setEditingSetId] = useState<string | null>(null)
  const [loadError, setLoadError] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const [activities, setActivities] = useState<ActivityLog[]>([])
  const [notes, setNotes] = useState('')
  const [notesSaved, setNotesSaved] = useState(false)
  // Derived from logged rows only, so set edits refresh it and planned-but-skipped items never appear.
  const overview = useMemo(() => buildWorkoutOverview(sets, activities, exercises), [sets, activities, exercises])

  useEffect(() => {
    let alive = true
    setLoadError(false)
    Promise.all([api.getWorkoutSummary(workoutId), api.listSets(workoutId), api.listMachines(), api.listActivities(workoutId)]).then(([s, rows, stations, entries]) => {
      if (!alive) return
      setSummary(s ?? null)
      setActivities(entries)
      setSets(rows)
      setMachines(Object.fromEntries(stations.map(machine => [machine.id, machine.nickname])))
      setNotes(s?.workout.notes ?? '')
      setLoaded(true)
    }).catch(() => { if (alive) setLoadError(true) })
    return () => { alive = false }
  }, [api, workoutId, attempt])

  if (loadError) return <div className="page"><p role="alert">Could not load this workout.</p><button className="ghost-btn" onClick={() => setAttempt(value => value + 1)}>Try again</button></div>
  if (!summary) return <div className="page"><p className="small" role="status">{loaded ? 'This workout is no longer available.' : 'Loading workout summary…'}</p>{loaded && <button className="ghost-btn" onClick={() => go({ name: 'history' })}>Back to Stats</button>}</div>

  const saveSetEdit = async (values: Pick<WorkoutSet, 'weightLb' | 'reps'>, expected: WorkoutSet) => {
    await api.updateSet(expected.id, values, expected)
    const [nextSummary, nextSets] = await Promise.all([api.getWorkoutSummary(workoutId), api.listSets(workoutId)])
    setSummary(nextSummary ?? null)
    setSets(nextSets)
    setEditingSetId(null)
    notify(`Set ${expected.setNumber} updated — workout totals refreshed`)
  }

  const saveNotes = async () => {
    await api.finishWorkout(workoutId, notes.trim())
    notify('Workout note saved')
    setNotesSaved(true)
  }

  const nameOf = (exerciseId: string) => exercises.get(exerciseId)?.name ?? 'Unknown exercise'
  const prIds = new Set(summary.prs.map(pr => pr.exerciseId))
  const empty = overview.exercises.length === 0
  const hasLifting = summary.setCount > 0
  const hasRepsOnly = sets.some(set => set.recordingFormat === 'reps')

  return (
    <div className="page summary-page">
      <button className="back-link" onClick={() => go({ name: 'history' })}>‹ Stats</button>
      <span className="lab lm">Workout complete</span>
      <h1 className="p-h1" style={{ fontSize: '2rem' }}>Done<span className="dot">.</span></h1>
      <p className="p-sub">{new Date(summary.workout.startedAt).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} · Saved workout</p>

      <section className="wo-stats" aria-label="Session totals">
        <div className="tile wo-stat wide"><span className="lab">Duration</span><Duration sec={summary.durationSec} /></div>
        <div className="tile wo-stat wide"><span className="lab">Exercises</span><span className="num">{overview.exercises.length}</span></div>
        {hasLifting && <>
          <div className="tile wo-stat"><span className="lab">Lifting sets</span><span className="num">{summary.setCount}</span></div>
          <div className="tile wo-stat"><span className="lab">Reps</span><span className="num">{overview.reps.toLocaleString()}</span></div>
          <div className="tile wo-stat volume">
            <span className="lab">Volume</span>
            <span className="num">{Math.round(summary.totalVolumeLb).toLocaleString()}<span className="unit">lb</span></span>
            {hasRepsOnly && <span className="small">Weighted sets only</span>}
          </div>
        </>}
      </section>

      {empty && <div className="card wo-empty" role="status">
        <b>Nothing was logged in this workout.</b>
        <p className="small">Exercises you planned but didn’t log aren’t counted here or on the muscle map.</p>
      </div>}

      {/* Current notes merged in; the key remounts the card (aborting any request) whenever its inputs change. */}
      {(() => {
        const reviewSummary = { ...summary, workout: { ...summary.workout, notes: notes.trim() || undefined } }
        return <WorkoutAiReview
          key={`${workoutId}:${JSON.stringify([reviewSummary, sets, activities])}`}
          summary={reviewSummary} sets={sets} activities={activities}
          disabled={editingSetId !== null}
        />
      })()}

      <section className="card wo-prs" aria-labelledby="wo-prs-title">
        <h2 className="lab" id="wo-prs-title">Highlights</h2>
        {summary.prs.length > 0 ? summary.prs.map((pr) => (
          <div key={pr.exerciseId} className="meal-row">
            <span>{nameOf(pr.exerciseId)} — {pr.weightLb}×{pr.reps}</span>
            <span className="pr-flag">PR ★</span>
          </div>
        )) : <p className="small">No new personal bests this time. PRs compare weighted sets with your earlier workouts.</p>}
      </section>

      {summary.activityCount > 0 && <section className="card" aria-labelledby="wo-timed-title">
        <h2 className="lab lm" id="wo-timed-title">Timed activity · {minutes(summary.timedDurationSec)} min</h2>
        {(summary.cardioDurationSec > 0 || summary.distanceMiles > 0) && <div className="wo-mini-stats">
          {summary.cardioDurationSec > 0 && <div><span className="num">{minutes(summary.cardioDurationSec)}</span><span className="lab">Cardio min</span></div>}
          {summary.distanceMiles > 0 && <div><span className="num">{Number(summary.distanceMiles.toFixed(2))}</span><span className="lab">Miles</span></div>}
        </div>}
        {activities.map((entry) => <div key={entry.id} className="meal-row">
          <span><b>{nameOf(entry.exerciseId)}</b><br /><span className="small">{formatActivity(entry)}</span></span>
        </div>)}
      </section>}

      {!empty && <WorkoutMuscleMap overview={overview} />}

      {!empty && <section className="card wo-breakdown" aria-labelledby="wo-breakdown-title">
        <h2 className="lab" id="wo-breakdown-title">Exercise breakdown</h2>
        <ol>
          {overview.exercises.map(exercise => <li key={exercise.exerciseId} data-overview-exercise={exercise.exerciseId}>
            <div className="wo-ex-head">
              <b>{exercise.name ?? 'Unknown exercise'}</b>
              {prIds.has(exercise.exerciseId) && <span className="pr-flag">PR ★</span>}
            </div>
            <p className="small">{exerciseLine(exercise)}</p>
            {exercise.primary.length > 0 && <p className="wo-ex-muscles">
              <span><i className="primary" aria-hidden="true" />Main: {regionNames(exercise.primary)}</span>
              {exercise.secondary.length > 0 && <span><i className="secondary" aria-hidden="true" />Assisting: {regionNames(exercise.secondary)}</span>}
            </p>}
          </li>)}
        </ol>
      </section>}

      <div className="card">
        <span className="lab" style={{ display: 'block' }}>Notes</span>
        <textarea
          aria-label="Workout notes" className="text-in" rows={2} style={{ marginTop: 8, resize: 'none' }}
          placeholder="Felt strong. Try seat 5 on leg press next time."
          value={notes}
          onChange={(e) => { setNotes(e.target.value); setNotesSaved(false) }}
        />
        <div style={{ height: 8 }} />
        <button className="ghost-btn" disabled={action.busy} onClick={() => void action.run(saveNotes)}>{notesSaved ? 'Saved ✓' : 'Save note'}</button>
      </div>

      {sets.length > 0 && <section className="summary-sets" aria-label="Logged sets">
        <h2 className="section-label">Logged sets</h2>
        <p className="small">Correct the reps or weight below. Changes keep an Edited label and update your totals.</p>
        {[...new Set(sets.map(set => set.exerciseId))].map(exerciseId => <div className="card" key={exerciseId}>
          <h3 className="summary-exercise-name">{exercises.get(exerciseId)?.name ?? 'Exercise'}</h3>
          {sets.filter(set => set.exerciseId === exerciseId).sort((a, b) => a.setNumber - b.setNumber).map(set => <div className="summary-set" key={set.id}>
            <div className="summary-set-values"><span className="lab">Set {set.setNumber}</span><b>{set.recordingFormat === 'reps' ? `${set.reps} reps` : `${set.weightLb} lb × ${set.reps} reps`}</b><EditedSetLabel set={set} /></div>
            {set.machineId && machines[set.machineId] && <p className="small">{machines[set.machineId]}</p>}
            <button className="text-button" aria-label={`Edit ${exercises.get(exerciseId)?.name ?? 'exercise'} set ${set.setNumber}`} disabled={action.busy || editingSetId !== null} onClick={() => setEditingSetId(set.id)}>Edit set</button>
            {editingSetId === set.id && <SetEditor set={set} exerciseName={exercises.get(exerciseId)?.name ?? 'Exercise'} onSave={saveSetEdit} onCancel={() => setEditingSetId(null)} />}
          </div>)}
        </div>)}
      </section>}
      <button className="big-btn" onClick={() => go({ name: 'home' })}>Back to Home →</button>
      <button className="ghost-btn" onClick={() => go({ name: 'history' })}>Back to Stats →</button>
    </div>
  )
}
