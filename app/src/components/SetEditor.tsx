import { useId, useState } from 'react'
import type { WorkoutSet } from '../types'
import { useAction } from './Feedback'

export function EditedSetLabel({ set }: { set: WorkoutSet }) {
  return set.editedAt ? <span className="edited-set-label">Edited</span> : null
}

export function SetEditor({ set, exerciseName, onSave, onCancel }: {
  set: WorkoutSet
  exerciseName: string
  onSave: (values: Pick<WorkoutSet, 'weightLb' | 'reps'>, expected: WorkoutSet) => Promise<void>
  onCancel: () => void
}) {
  const id = useId()
  const [original] = useState(set)
  const [weight, setWeight] = useState(String(set.weightLb))
  const [reps, setReps] = useState(String(set.reps))
  const action = useAction()
  const weightLb = Number(weight)
  const repCount = Number(reps)
  const valid = !!weight.trim() && Number.isFinite(weightLb) && weightLb >= 0
    && !!reps.trim() && Number.isInteger(repCount) && repCount > 0
  const changed = weightLb !== original.weightLb || repCount !== original.reps
  return <form className="set-editor" aria-label={`Edit ${exerciseName} set ${set.setNumber}`}
    onSubmit={event => { event.preventDefault(); if (valid && changed) void action.run(() => onSave({ weightLb, reps: repCount }, original)) }}>
    <b>Edit set {set.setNumber}</b>
    <p className="small">{exerciseName} · saved as {original.weightLb} lb × {original.reps} reps</p>
    <div className="in-grid">
      <div className="field"><label htmlFor={`${id}-weight`}>Weight (lb)</label><input id={`${id}-weight`} className="text-in" inputMode="decimal" value={weight} disabled={action.busy} onChange={event => setWeight(event.target.value)} /></div>
      <div className="field"><label htmlFor={`${id}-reps`}>Reps</label><input id={`${id}-reps`} className="text-in" inputMode="numeric" autoFocus value={reps} disabled={action.busy} onFocus={event => event.target.select()} onChange={event => setReps(event.target.value)} /></div>
    </div>
    {!valid && <p className="small" role="status">Enter a weight of 0 or more and a whole-number rep count above 0.</p>}
    {original.editedAt && <p className="small">Last edited {new Date(original.editedAt).toLocaleString()}.{original.originalValues && ` Originally ${original.originalValues.weightLb} lb × ${original.originalValues.reps} reps.`}</p>}
    <p className="small">Saving adds an Edited label. It does not add a set or restart rest.</p>
    <div className="set-edit-actions"><button type="button" className="ghost-btn" disabled={action.busy} onClick={onCancel}>Cancel</button><button className="big-btn" type="submit" disabled={action.busy || !valid || !changed}>{action.busy ? 'Saving…' : 'Save changes'}</button></div>
  </form>
}
