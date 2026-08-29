import { useEffect, useState } from 'react'
import { useApp } from '../AppContext'
import type { WorkoutSummary } from '../types'

export function SummaryScreen({ workoutId }: { workoutId: string }) {
  const { api, go, exercises } = useApp()
  const [summary, setSummary] = useState<WorkoutSummary | null>(null)
  const [notes, setNotes] = useState('')
  const [notesSaved, setNotesSaved] = useState(false)

  useEffect(() => {
    api.getWorkoutSummary(workoutId).then((s) => {
      setSummary(s ?? null)
      setNotes(s?.workout.notes ?? '')
    })
  }, [api, workoutId])

  if (!summary) return null

  const saveNotes = async () => {
    // v1: finishWorkout doubles as the notes writer (re-stamps finishedAt by a few seconds)
    await api.finishWorkout(workoutId, notes.trim() || undefined)
    setNotesSaved(true)
  }

  return (
    <>
      <h1 className="p-h1">Workout done 🎉</h1>
      <p className="p-sub">Saved locally — no account needed</p>

      <div className="rings">
        <div className="ring-card">
          <span className="stat-num">{Math.max(1, Math.round(summary.durationSec / 60))}<span className="small"> min</span></span>
          <br /><span className="small">Duration</span>
        </div>
        <div className="ring-card">
          <span className="stat-num">{Math.round(summary.totalVolumeLb).toLocaleString()}<span className="small"> lb</span></span>
          <br /><span className="small">Volume</span>
        </div>
      </div>

      <div className="card">
        <b style={{ fontSize: '0.85rem' }}>Highlights</b>
        {summary.prs.length > 0 ? (
          summary.prs.map((pr) => (
            <div key={pr.exerciseId} className="meal-row">
              <span>{exercises.get(pr.exerciseId)?.name ?? pr.exerciseId} {pr.weightLb}×{pr.reps}</span>
              <span className="pr-flag">PR</span>
            </div>
          ))
        ) : (
          <div className="meal-row"><span className="small">{summary.setCount} sets logged — keep stacking.</span></div>
        )}
      </div>

      <div className="card">
        <b style={{ fontSize: '0.85rem' }}>Notes</b>
        <textarea
          className="text-in" rows={2} style={{ marginTop: 8, resize: 'none' }}
          placeholder="Felt strong. Try seat 5 on leg press next time."
          value={notes}
          onChange={(e) => { setNotes(e.target.value); setNotesSaved(false) }}
        />
        <div style={{ height: 8 }} />
        <button className="ghost-btn" onClick={saveNotes}>{notesSaved ? 'Saved ✓' : 'Save note'}</button>
      </div>

      <button className="big-btn" onClick={() => go({ name: 'home' })}>Back to Home</button>
    </>
  )
}
