import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useApp } from '../AppContext'
import type { Screen } from '../AppContext'
import { MachineExercisePicker } from '../components/MachineExercisePicker'
import type { EquipmentModel, GymMachine } from '../types'
import { machineExerciseIds, normalizeMachineExercises } from '../types'
import './machines.css'

/** The fields this screen owns; everything else on the record is left untouched. */
interface Draft {
  nickname: string
  seatSetting: string
  setupNotes: string
  favorite: boolean
  exerciseIds: string[]
}

const draftOf = (m: GymMachine): Draft => ({
  nickname: m.nickname,
  seatSetting: m.seatSetting ?? '',
  setupNotes: m.setupNotes ?? '',
  favorite: m.favorite,
  exerciseIds: machineExerciseIds(m),
})

const EMPTY: Draft = { nickname: '', seatSetting: '', setupNotes: '', favorite: false, exerciseIds: [] }

const sameIds = (a: string[], b: string[]) => a.length === b.length && a.every((id, i) => id === b[i])

/** Only the fields the user actually changed, so a sync that landed meanwhile keeps its edits. */
function changedFields(draft: Draft, original: Draft, fresh: GymMachine): Partial<GymMachine> {
  const p: Partial<GymMachine> = {}
  const nickname = draft.nickname.trim()
  const seat = draft.seatSetting.trim()
  const notes = draft.setupNotes.trim()
  if (nickname !== original.nickname.trim()) p.nickname = nickname
  if (seat !== original.seatSetting.trim()) p.seatSetting = seat || undefined
  if (notes !== original.setupNotes.trim()) p.setupNotes = notes || undefined
  if (draft.favorite !== original.favorite) p.favorite = draft.favorite
  if (!sameIds(draft.exerciseIds, original.exerciseIds)) {
    p.exerciseIds = draft.exerciseIds
    // keep the default movement when it survived the edit
    p.exerciseId = draft.exerciseIds.includes(fresh.exerciseId) ? fresh.exerciseId : draft.exerciseIds[0]!
  }
  return p
}

interface Props {
  machineId?: string
  from?: 'machines' | 'machine'
}

export function MachineSettingsScreen({ machineId, from }: Props) {
  const { api, go, exercises } = useApp()
  const [status, setStatus] = useState<'loading' | 'ready' | 'not-found' | 'error'>(machineId ? 'loading' : 'ready')
  const [loadError, setLoadError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const [machine, setMachine] = useState<GymMachine | null>(null)
  const [model, setModel] = useState<EquipmentModel | null>(null)
  const [original, setOriginal] = useState<Draft>(EMPTY)
  const [draft, setDraft] = useState<Draft>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!machineId) return
    let alive = true
    setStatus('loading')
    const load = async () => {
      const m = await api.getMachine(machineId)
      const mo = m?.equipmentModelId ? await api.getEquipmentModel(m.equipmentModelId) : undefined
      if (!alive) return
      if (!m) { setStatus('not-found'); return }
      setMachine(m)
      setModel(mo ?? null)
      setOriginal(draftOf(m))
      setDraft(draftOf(m))
      setStatus('ready')
    }
    load().catch((err) => {
      if (!alive) return
      setLoadError(err instanceof Error ? err.message : String(err))
      setStatus('error')
    })
    return () => { alive = false }
  }, [api, machineId, attempt])

  const isNew = !machineId
  const exitTo: Screen = from === 'machine' && machineId ? { name: 'machine', machineId } : { name: 'machines' }
  const exitLabel = from === 'machine' ? 'Machine' : 'My machines'

  const dirty = draft.nickname.trim() !== original.nickname.trim()
    || draft.seatSetting.trim() !== original.seatSetting.trim()
    || draft.setupNotes.trim() !== original.setupNotes.trim()
    || draft.favorite !== original.favorite
    || !sameIds(draft.exerciseIds, original.exerciseIds)
  const nameMissing = !draft.nickname.trim()
  const exercisesMissing = draft.exerciseIds.length === 0
  const canSave = dirty && !nameMissing && !exercisesMissing && !saving

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((cur) => ({ ...cur, [key]: value }))
    setSaveError(null)
  }

  const cancel = () => {
    if (dirty && !saving && !window.confirm('Discard your changes to this machine?')) return
    go(exitTo)
  }

  const save = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!canSave) return
    setSaving(true)
    setSaveError(null)
    try {
      let next: GymMachine
      if (machineId) {
        // re-read right before writing: the loaded copy may be stale after a sync
        const fresh = await api.getMachine(machineId)
        if (!fresh) { setStatus('not-found'); return }
        next = normalizeMachineExercises({ ...fresh, ...changedFields(draft, original, fresh) })
      } else {
        next = normalizeMachineExercises<GymMachine>({
          id: crypto.randomUUID(),
          nickname: draft.nickname.trim(),
          exerciseId: draft.exerciseIds[0]!,
          exerciseIds: draft.exerciseIds,
          seatSetting: draft.seatSetting.trim() || undefined,
          setupNotes: draft.setupNotes.trim() || undefined,
          favorite: draft.favorite,
        })
      }
      await api.saveMachine(next)
      go({ name: 'machines', notice: `${isNew ? 'Added' : 'Saved'} “${next.nickname}”.` })
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err))
    } finally {
      setSaving(false)
    }
  }

  const back = (
    <button className="back-link" onClick={cancel}>‹ {exitLabel}</button>
  )

  if (status === 'loading') {
    return (
      <div className="page">
        {back}
        <p className="small" role="status">Loading machine…</p>
      </div>
    )
  }

  if (status === 'error') {
    return (
      <div className="page">
        {back}
        <h1 className="p-h1">Machine settings<span className="dot">.</span></h1>
        <div className="card" role="alert">
          <span className="small" style={{ color: 'var(--danger)', display: 'block', marginBottom: 10 }}>
            Couldn't load this machine — {loadError}
          </span>
          <button className="ghost-btn" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
        </div>
      </div>
    )
  }

  if (status === 'not-found') {
    return (
      <div className="page">
        <button className="back-link" onClick={() => go({ name: 'machines' })}>‹ My machines</button>
        <h1 className="p-h1">Machine not found<span className="dot">.</span></h1>
        <p className="p-sub">It may have been removed on another device. Nothing was changed.</p>
        <button className="ghost-btn" onClick={() => go({ name: 'machines' })}>Back to my machines</button>
      </div>
    )
  }

  const defaultId = machine && draft.exerciseIds.includes(machine.exerciseId) ? machine.exerciseId : draft.exerciseIds[0]

  return (
    <div className="page">
      {back}
      <h1 className="p-h1">{isNew ? 'Add a machine' : 'Machine settings'}<span className="dot">.</span></h1>
      <p className="p-sub">
        {isNew
          ? 'For a machine without a QR code, or one you want set up before you get there.'
          : model
            ? `${model.manufacturer} · ${model.modelName}`
            : 'Changes apply everywhere this machine shows up.'}
      </p>

      <form className="machine-settings" onSubmit={(e) => void save(e)} noValidate>
        <div className="card">
          <div className="field">
            <label htmlFor="ms-nickname">Nickname</label>
            <input
              id="ms-nickname" className="text-in" value={draft.nickname} placeholder="Chest press by the windows"
              aria-invalid={nameMissing} aria-describedby="ms-nickname-hint"
              onChange={(e) => set('nickname', e.target.value)}
            />
            <span id="ms-nickname-hint" className={`small ms-hint${nameMissing && dirty ? ' bad' : ''}`}>
              {nameMissing ? 'Needs a name so you can find it.' : "How you'd find it at your club."}
            </span>
          </div>
          <div className="in-grid">
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="ms-seat">Seat / position</label>
              <input
                id="ms-seat" className="text-in" value={draft.seatSetting} placeholder="4"
                onChange={(e) => set('seatSetting', e.target.value)}
              />
            </div>
            <div className="field" style={{ margin: 0 }}>
              <label htmlFor="ms-notes">Notes</label>
              <input
                id="ms-notes" className="text-in" value={draft.setupNotes} placeholder="Feet high, slow negatives"
                onChange={(e) => set('setupNotes', e.target.value)}
              />
            </div>
          </div>
        </div>

        <div className="card">
          <button
            type="button"
            className={`ms-fav${draft.favorite ? ' on' : ''}`}
            aria-pressed={draft.favorite}
            onClick={() => set('favorite', !draft.favorite)}
          >
            <span className="ms-fav-star" aria-hidden="true">{draft.favorite ? '★' : '☆'}</span>
            <span>
              <b>Favorite</b>
              <small>Favorites sit at the top of My machines.</small>
            </span>
          </button>
        </div>

        <div className="card">
          <span className="lab" id="ms-exercises-label" style={{ display: 'block' }}>Exercises on this machine</span>
          <span className={`small ms-hint${exercisesMissing && dirty ? ' bad' : ''}`} style={{ margin: '4px 0 10px' }}>
            {exercisesMissing
              ? 'Add at least one exercise — you pick from these when you train.'
              : 'Every movement this station can do. Past workouts stay with their exercise.'}
          </span>
          <div role="group" aria-labelledby="ms-exercises-label">
            <MachineExercisePicker
              value={draft.exerciseIds} exercises={exercises} defaultId={defaultId}
              onChange={(ids) => set('exerciseIds', ids)}
            />
          </div>
        </div>

        {machine?.qrUrl && (
          <div className="card">
            <span className="lab" style={{ display: 'block' }}>Linked QR code</span>
            <span className="small ms-qr">{machine.qrUrl}</span>
            <span className="small" style={{ display: 'block', marginTop: 4 }}>
              Stays linked — scanning it still opens this machine.
            </span>
          </div>
        )}

        {saveError && (
          <p className="small" role="alert" style={{ color: 'var(--danger)', margin: '8px 0' }}>
            Couldn't save — {saveError}. Your edits are still here.
          </p>
        )}

        <div className="machine-edit-actions ms-actions">
          <button type="button" className="ghost-btn" disabled={saving} onClick={cancel}>Cancel</button>
          <button type="submit" className="big-btn" disabled={!canSave}>
            {saving ? 'Saving…' : isNew ? 'Add machine' : 'Save'}
          </button>
        </div>
        {!dirty && !isNew && <p className="small ms-hint" style={{ textAlign: 'center' }}>No changes yet.</p>}
      </form>
    </div>
  )
}
