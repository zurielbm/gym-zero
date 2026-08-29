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
    <div className="page">
      <span className="lab lm">Workout complete</span>
      <h1 className="p-h1" style={{ fontSize: '2.8rem', margin: '6px 0 2px' }}>Done<span className="dot">.</span></h1>
      <p className="p-sub">Saved locally — no account needed</p>

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
          <div className="meal-row"><span className="small">{summary.setCount} sets logged — keep stacking.</span></div>
        )}
      </div>

      <div className="card">
        <span className="lab" style={{ display: 'block' }}>Notes</span>
        <textarea
          className="text-in" rows={2} style={{ marginTop: 8, resize: 'none' }}
          placeholder="Felt strong. Try seat 5 on leg press next time."
          value={notes}
          onChange={(e) => { setNotes(e.target.value); setNotesSaved(false) }}
        />
        <div style={{ height: 8 }} />
        <button className="ghost-btn" onClick={saveNotes}>{notesSaved ? 'Saved ✓' : 'Save note'}</button>
      </div>

      <button className="big-btn" onClick={() => go({ name: 'home' })}>Back to Home →</button>
    </div>
  )
}
