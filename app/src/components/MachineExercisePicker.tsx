import { useState } from 'react'
import { MuscleMap } from './MuscleMap'
import { exerciseMuscles } from '../lib/exercise-muscles'
import type { Exercise } from '../types'

interface Props {
  value: string[]
  exercises: Map<string, Exercise>
  onChange: (ids: string[]) => void
  /** labels the row the machine opens on by default */
  defaultId?: string
}

/** Linked-exercise list for one physical machine: remove rows, add from the catalog. */
export function MachineExercisePicker({ value, exercises, onChange, defaultId }: Props) {
  const [previewId, setPreviewId] = useState('')
  const available = [...exercises.values()]
    .filter((exercise) => !value.includes(exercise.id))
    .sort((a, b) => a.name.localeCompare(b.name))
  return (
    <div className="machine-exercise-editor">
      {value.map((id) => (
        <div key={id}><div className="machine-exercise-edit-row">
          <span>
            <b>
              {exercises.get(id)?.name ?? id}
              {id === defaultId && value.length > 1 && <span className="lab lm" style={{ marginLeft: 8 }}>Default</span>}
            </b>
            <small>{exercises.get(id) ? exerciseMuscles(exercises.get(id)!).focus : ''}</small>
            <button type="button" className="text-button" aria-expanded={previewId === id} onClick={() => setPreviewId(previewId === id ? '' : id)}>{previewId === id ? 'Hide muscles' : 'Preview muscles'}</button>
          </span>
          <button
            type="button"
            className="icon-btn"
            title={`Remove ${exercises.get(id)?.name ?? 'exercise'}`}
            aria-label={`Remove ${exercises.get(id)?.name ?? 'exercise'}`}
            onClick={() => { onChange(value.filter((other) => other !== id)); if (previewId === id) setPreviewId('') }}
          >
            ×
          </button>
        </div>{previewId === id && exercises.get(id) && <MuscleMap exercise={exercises.get(id)!} />}</div>
      ))}
      {available.length > 0 && (
        <select
          className="text-in"
          value=""
          aria-label="Add another exercise"
          onChange={(event) => {
            if (event.target.value) onChange([...value, event.target.value])
          }}
        >
          <option value="">＋ Add {value.length ? 'another' : 'an'} exercise…</option>
          {available.map((exercise) => <option key={exercise.id} value={exercise.id}>{exercise.name}</option>)}
        </select>
      )}
    </div>
  )
}
