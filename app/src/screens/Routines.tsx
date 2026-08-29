import { useEffect, useState } from 'react'
import { useApp } from '../AppContext'
import type { Routine } from '../types'

function relativeDay(ts?: number) {
  if (!ts) return 'never'
  const days = Math.floor((Date.now() - ts) / 86400_000)
  if (days === 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days}d ago`
}

export function RoutinesScreen() {
  const { api, go, activeWorkout, setActiveWorkout, exercises } = useApp()
  const [routines, setRoutines] = useState<Routine[]>([])

  useEffect(() => {
    api.listRoutines().then(setRoutines)
  }, [api])

  // least-recently-used routine first: that's the one that's "up next"
  const ordered = [...routines].sort((a, b) => (a.lastUsedAt ?? 0) - (b.lastUsedAt ?? 0))
  const upNextId = ordered[0]?.id

  const start = async (r: Routine) => {
    const w = await api.startWorkout(r.id)
    setActiveWorkout(w)
    go({ name: 'workout' })
  }

  return (
    <div className="page">
      <button className="back-link" onClick={() => go({ name: 'home' })}>‹ Home</button>
      <h1 className="p-h1">Choose routine<span className="dot">.</span></h1>
      <p className="p-sub">Previous weights load automatically</p>

      {activeWorkout && (
        <button className="big-btn" style={{ marginBottom: 16 }} onClick={() => go({ name: 'workout' })}>
          Resume current workout →
        </button>
      )}

      {ordered.map((r) => (
        <div key={r.id} className="card tappable" onClick={() => start(r)}>
          <div className="row">
            <b style={{ fontSize: '1rem' }}>{r.emoji ? `${r.emoji} ` : ''}{r.name}</b>
            {r.id === upNextId && <span className="chip solid" style={{ margin: 0 }}>Up next</span>}
          </div>
          <span className="small" style={{ display: 'block', margin: '4px 0 6px' }}>
            {r.items.map((i) => exercises.get(i.exerciseId)?.name ?? i.exerciseId).join(' · ')}
          </span>
          <div className="row">
            <span className="lab">{r.items.length} exercises</span>
            <span className="lab">Last · {relativeDay(r.lastUsedAt)}</span>
          </div>
        </div>
      ))}

      <button
        className="ghost-btn"
        style={{ marginTop: 10 }}
        onClick={async () => {
          // freestyle session without a routine
          const w = await api.startWorkout()
          setActiveWorkout(w)
          go({ name: 'workout' })
        }}
      >
        ＋ Start empty workout
      </button>
    </div>
  )
}
