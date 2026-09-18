import { useEffect, useState } from 'react'
import { useAction } from '../components/Feedback'
import { useApp } from '../AppContext'
import { GearIcon } from '../components/icons'
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
  const action = useAction()
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
      <div className="row">
        <h1 className="p-h1">Train<span className="dot">.</span></h1>
        <button className="icon-btn" title="Settings" aria-label="Settings" onClick={() => go({ name: 'settings' })}><GearIcon /></button>
      </div>
      <p className="p-sub">Choose routine · previous weights load automatically</p>

      <div style={{ display: 'flex', gap: 8 }}>
        <button
          className="ghost-btn" style={{ flex: 1 }} aria-label="＋ Start empty workout"
          disabled={action.busy}
          onClick={() => void action.run(async () => {
            // freestyle session without a routine
            const w = await api.startWorkout()
            setActiveWorkout(w)
            go({ name: 'workout' })
          })}
        >
          ＋ Empty workout
        </button>
        <button className="ghost-btn" style={{ flex: 1 }} onClick={() => go({ name: 'routine-edit' })}>
          ＋ New routine
        </button>
      </div>

      {activeWorkout && (
        <div className="card" style={{ borderColor: 'var(--lime)', background: 'var(--lime-dim)' }}>
          <div className="row">
            <div>
              <span className="lab lm">In progress</span>
              <p className="t" style={{ fontSize: '0.95rem', margin: '2px 0 0' }}>Your workout is still open</p>
              <p className="small" style={{ margin: '2px 0 0', fontSize: '0.76rem' }}>Starting a routine resumes it. Finish or discard it first to start another.</p>
            </div>
            <button className="big-btn" style={{ width: 'auto', minHeight: 38, fontSize: '0.82rem' }} onClick={() => go({ name: 'workout' })}>
              Resume
            </button>
          </div>
        </div>
      )}

      <p className="section-label">My routines</p>
      {ordered.map((r) => {
        const isNext = r.id === upNextId
        return (
          <div key={r.id} className="card routine-card">
            <button className="routine-open" disabled={action.busy} onClick={() => void action.run(() => start(r))}>
              <p className="t">{r.emoji ? `${r.emoji} ` : ''}{r.name}</p>
              <p className="small" style={{ margin: '4px 0 0' }}>
                {r.items.map((i) => exercises.get(i.exerciseId)?.name ?? i.exerciseId).join(' · ')}
              </p>
              <div className="row" style={{ margin: '10px 0 12px' }}>
                <span className="lab">{r.items.length} exercises · last {relativeDay(r.lastUsedAt)}</span>
                {isNext && <span className="chip solid" style={{ margin: 0, fontSize: '0.62rem', padding: '3px 9px' }}>Up next</span>}
              </div>
            </button>
            <button
              className="icon-btn routine-edit" title="Edit routine" aria-label={`Edit ${r.name} routine`}
              onClick={() => go({ name: 'routine-edit', routineId: r.id })}
            >
              ⋯
            </button>
            <button
              className={isNext ? 'big-btn' : 'ghost-btn'} disabled={action.busy}
              aria-label={`Start ${r.name} routine`}
              onClick={() => void action.run(() => start(r))}
            >
              Start routine
            </button>
          </div>
        )
      })}
    </div>
  )
}
