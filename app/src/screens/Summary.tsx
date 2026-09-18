import { useEffect, useState } from 'react'
import { SetEditor, EditedSetLabel } from '../components/SetEditor'
import { useAction, useFeedback } from '../components/Feedback'
import { useApp } from '../AppContext'
import type { WorkoutSummary, WorkoutSet } from '../types'
import { formatActivity } from '../lib/exercises'
import type { ActivityLog } from '../types'

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

  return (
    <div className="page">
      <button className="back-link" onClick={() => go({ name: 'history' })}>‹ Stats</button>
      <span className="lab lm">Workout complete</span>
      <h1 className="p-h1" style={{ fontSize: '2.8rem', margin: '6px 0 2px' }}>Done<span className="dot">.</span></h1>
      <p className="p-sub">{new Date(summary.workout.startedAt).toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} · Saved workout</p>

      <div className="stat-strip">
        <span>
          <span className="num">{Math.max(1, Math.round(summary.durationSec / 60))}</span>
          <span className="lab">Minutes</span>
        </span>
        <span>
          <span className="num">{summary.setCount}</span>
          <span className="lab">Sets</span>
        </span>
        <span>
          <span className="num">{Math.round(summary.totalVolumeLb).toLocaleString()}</span>
          <span className="lab">Lb volume</span>
        </span>
      </div>

      {summary.activityCount > 0 && <div className="card">
        <span className="lab lm">Timed activity · {Number((summary.timedDurationSec / 60).toFixed(1))} min</span>
        <p className="small">{Number((summary.cardioDurationSec / 60).toFixed(1))} cardio min · {Number(summary.distanceMiles.toFixed(2))} mi recorded</p>
        {activities.map((entry) => <div key={entry.id} className="meal-row">
          <span><b>{exercises.get(entry.exerciseId)?.name ?? 'Exercise'}</b><br /><span className="small">{formatActivity(entry)}</span></span>
        </div>)}
      </div>}

      <div className="card">
        <span className="lab" style={{ display: 'block', marginBottom: 4 }}>Highlights</span>
        {summary.prs.length > 0 ? (
          summary.prs.map((pr) => (
            <div key={pr.exerciseId} className="meal-row">
              <span>{exercises.get(pr.exerciseId)?.name ?? pr.exerciseId} — {pr.weightLb}×{pr.reps}</span>
              <span className="pr-flag">PR ★</span>
            </div>
          ))
        ) : (
          <div className="meal-row"><span className="small">{summary.setCount} lifting sets · {summary.activityCount} timed entries logged.</span></div>
        )}
      </div>

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
      <button className="ghost-btn" onClick={() => go({ name: 'history' })}>Back to Stats →</button>
      <div style={{ height: 8 }} />
      <button className="big-btn" onClick={() => go({ name: 'home' })}>Back to Home →</button>
    </div>
  )
}
