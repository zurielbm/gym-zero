import { useEffect, useMemo, useState } from 'react'
import { useApp } from '../AppContext'
import type { EquipmentModel, GymMachine } from '../types'
import { machineExerciseIds } from '../types'
import './machines.css'

interface Row {
  machine: GymMachine
  model?: EquipmentModel
  exerciseNames: string[]
  /** lowercased text the search box matches against */
  haystack: string
}

/** Favorites first, then alphabetical — the order you'd look for them at the club. */
const byFavoriteThenName = (a: Row, b: Row) =>
  Number(b.machine.favorite) - Number(a.machine.favorite)
  || a.machine.nickname.localeCompare(b.machine.nickname)

export function MachinesScreen({ notice }: { notice?: string }) {
  const { api, go, exercises } = useApp()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let alive = true
    setError(null)
    const load = async () => {
      const machines = await api.listMachines()
      const modelIds = [...new Set(machines.map((m) => m.equipmentModelId).filter((id): id is string => !!id))]
      const models = new Map(
        (await Promise.all(modelIds.map((id) => api.getEquipmentModel(id))))
          .filter((m): m is EquipmentModel => !!m)
          .map((m) => [m.id, m]),
      )
      return machines.map((machine): Row => {
        const model = machine.equipmentModelId ? models.get(machine.equipmentModelId) : undefined
        const exerciseNames = machineExerciseIds(machine).map((id) => exercises.get(id)?.name ?? id)
        return {
          machine, model, exerciseNames,
          haystack: [
            machine.nickname, machine.seatSetting, machine.setupNotes,
            model?.manufacturer, model?.modelName, ...exerciseNames,
          ].filter(Boolean).join(' ').toLowerCase(),
        }
      }).sort(byFavoriteThenName)
    }
    load()
      .then((next) => { if (alive) setRows(next) })
      .catch((err) => { if (alive) setError(err instanceof Error ? err.message : String(err)) })
    return () => { alive = false }
  }, [api, exercises, attempt])

  const shown = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean)
    return (rows ?? []).filter((row) => words.every((w) => row.haystack.includes(w)))
  }, [rows, query])

  return (
    <div className="page">
      <button className="back-link" onClick={() => go({ name: 'settings' })}>‹ Settings</button>
      <h1 className="p-h1">My machines<span className="dot">.</span></h1>
      <p className="p-sub">Edit names, seat settings and exercises without scanning the QR again.</p>

      {notice && <p className="machines-notice" role="status">✓ {notice}</p>}

      {error ? (
        <div className="card" role="alert">
          <span className="small" style={{ color: 'var(--danger)', display: 'block', marginBottom: 10 }}>
            Couldn't load your machines — {error}
          </span>
          <button className="ghost-btn" onClick={() => { setRows(null); setAttempt((n) => n + 1) }}>Try again</button>
        </div>
      ) : !rows ? (
        <p className="small" role="status">Loading your machines…</p>
      ) : (
        <>
          {rows.length > 0 && (
            <div className="field machines-search">
              <label htmlFor="machines-search">Search</label>
              <input
                id="machines-search" className="text-in" type="search" value={query}
                placeholder="Name, exercise, seat, notes…" autoCapitalize="off" autoCorrect="off"
                onChange={(e) => setQuery(e.target.value)}
              />
              <span className="small machines-count" aria-live="polite">
                {query.trim()
                  ? `${shown.length} of ${rows.length} machine${rows.length === 1 ? '' : 's'}`
                  : `${rows.length} machine${rows.length === 1 ? '' : 's'} · ${rows.filter((r) => r.machine.favorite).length} favorite`}
              </span>
            </div>
          )}

          {rows.length === 0 && (
            <div className="card">
              <span className="small" style={{ display: 'block' }}>
                No machines yet. Scan a machine's QR code at the gym, or add one by hand below.
              </span>
            </div>
          )}

          {rows.length > 0 && shown.length === 0 && (
            <p className="small" role="status">Nothing matches “{query.trim()}”.</p>
          )}

          <ul className="machine-list">
            {shown.map(({ machine, model, exerciseNames }) => {
              const setup = [
                machine.seatSetting?.trim() && `Seat ${machine.seatSetting.trim()}`,
                machine.setupNotes?.trim(),
              ].filter(Boolean).join(' · ')
              return (
                <li key={machine.id}>
                  <button
                    className="card machine-card tappable"
                    onClick={() => go({ name: 'machine-settings', machineId: machine.id, from: 'machines' })}
                  >
                    <span className="machine-card-main">
                      <span className="machine-card-name">
                        {machine.favorite && <><span className="machine-card-star" aria-hidden="true">★</span><span className="sr-only">Favorite: </span></>}
                        <b>{machine.nickname}</b>
                      </span>
                      <span className="machine-card-ex">
                        {exerciseNames.join(' · ')}
                      </span>
                      <span className="machine-card-setup">
                        {setup || <span className="faint">No seat or notes yet</span>}
                      </span>
                      {model && <span className="lab machine-card-model">{model.manufacturer} · {model.modelName}</span>}
                    </span>
                    <span className="chev" aria-hidden="true">›</span>
                  </button>
                </li>
              )
            })}
          </ul>

          <button className="ghost-btn" style={{ marginTop: 14 }} onClick={() => go({ name: 'machine-settings', from: 'machines' })}>
            ＋ Add a machine without scanning
          </button>
        </>
      )}
    </div>
  )
}
