import { useEffect, useState } from 'react'
import { useApp } from '../AppContext'
import { VideoPlayer } from '../components/VideoPlayer'
import type { EquipmentModel, GymMachine, PrevPerformance } from '../types'

interface Props {
  machineId?: string
  /** catalog match for a scanned-but-unmapped QR */
  modelId?: string
  /** raw scanned QR url when this machine isn't mapped yet */
  qrUrl?: string
}

export function MachineScreen({ machineId, modelId, qrUrl }: Props) {
  const { api, go, activeWorkout, setActiveWorkout, exercises } = useApp()
  const [machine, setMachine] = useState<GymMachine | null>(null)
  const [model, setModel] = useState<EquipmentModel | null>(null)
  const [perf, setPerf] = useState<PrevPerformance | undefined>()
  const [loaded, setLoaded] = useState(false)
  // map-new-machine form
  const [nickname, setNickname] = useState('')
  const [exerciseId, setExerciseId] = useState('')

  useEffect(() => {
    let alive = true
    const load = async () => {
      let m: GymMachine | undefined
      let mo: EquipmentModel | undefined
      if (machineId) {
        m = await api.getMachine(machineId)
        if (m?.equipmentModelId) mo = await api.getEquipmentModel(m.equipmentModelId)
      } else if (modelId) {
        mo = await api.getEquipmentModel(modelId)
      }
      if (!alive) return
      setMachine(m ?? null)
      setModel(mo ?? null)
      if (mo && !m) {
        setNickname(mo.modelName)
        setExerciseId(mo.exerciseIds[0] ?? '')
      }
      setLoaded(true)
    }
    load()
    return () => { alive = false }
  }, [api, machineId, modelId])

  useEffect(() => {
    const exId = machine?.exerciseId
    if (exId) api.getPrevPerformance(exId, activeWorkout?.id).then(setPerf)
  }, [api, machine, activeWorkout])

  if (!loaded) return null

  const videoUrl = model?.videoUrl ?? machine?.qrUrl ?? qrUrl

  // ----- not mapped yet: name it once -----
  if (!machine) {
    const createMachine = async () => {
      if (!nickname.trim() || !exerciseId) return
      const m: GymMachine = {
        id: crypto.randomUUID(),
        nickname: nickname.trim(),
        exerciseId,
        equipmentModelId: model?.id,
        qrUrl,
        favorite: true,
      }
      await api.saveMachine(m)
      setMachine(m)
    }
    return (
      <>
        <button className="back-link" onClick={() => go({ name: 'scan' })}>‹ Scanner</button>
        <h1 className="p-h1" style={{ fontSize: '1.25rem' }}>
          {model
            ? `${model.manufacturer} ${model.modelName}`
            : qrUrl && /lfconnect\.com|lifefitness\.com/.test(qrUrl)
              ? 'Life Fitness machine'
              : 'New machine'}
        </h1>
        <p className="p-sub">
          {model ? 'Recognized from the catalog — save it as your machine.' : 'Unknown QR code — map it once and it sticks.'}
        </p>

        <VideoPlayer url={videoUrl} />

        <div className="card">
          <div className="field">
            <label>Nickname (how you'd find it at your club)</label>
            <input className="text-in" value={nickname} placeholder="Chest press by the windows"
              onChange={(e) => setNickname(e.target.value)} />
          </div>
          <div className="field">
            <label>Exercise</label>
            <select className="text-in" value={exerciseId} onChange={(e) => setExerciseId(e.target.value)}>
              <option value="" disabled>Pick an exercise…</option>
              {[...exercises.values()].map((ex) => (
                <option key={ex.id} value={ex.id}>{ex.name}</option>
              ))}
            </select>
          </div>
          <button className="big-btn" onClick={createMachine} disabled={!nickname.trim() || !exerciseId}>
            Save my machine
          </button>
        </div>
      </>
    )
  }

  // ----- mapped machine -----
  const ex = exercises.get(machine.exerciseId)
  const patch = async (p: Partial<GymMachine>) => {
    const next = { ...machine, ...p }
    setMachine(next)
    await api.saveMachine(next)
  }

  const logSets = async () => {
    if (!activeWorkout) {
      const w = await api.startWorkout()
      setActiveWorkout(w)
    }
    go({ name: 'workout', exerciseId: machine.exerciseId })
  }

  return (
    <>
      <div className="row" style={{ marginBottom: 8 }}>
        <button className="back-link" style={{ margin: 0 }} onClick={() => go({ name: 'scan' })}>‹ Scanner</button>
        <button
          className={`icon-btn${machine.favorite ? ' fav' : ''}`}
          title="Favorite"
          onClick={() => patch({ favorite: !machine.favorite })}
        >
          {machine.favorite ? '★' : '☆'}
        </button>
      </div>
      <h1 className="p-h1" style={{ fontSize: '1.25rem' }}>{machine.nickname}</h1>
      <p className="p-sub">
        {model ? `${model.manufacturer} · ${model.modelName}` : ex?.name ?? ''}
      </p>

      <VideoPlayer url={videoUrl} />

      <div style={{ marginBottom: 10 }}>
        {ex?.muscleGroups.map((m) => (
          <span key={m} className="chip green" style={{ textTransform: 'capitalize' }}>{m}</span>
        ))}
        {ex && <span className="chip blue" style={{ textTransform: 'capitalize' }}>{ex.equipment}</span>}
      </div>

      <div className="card">
        <b style={{ fontSize: '0.85rem' }}>My setup</b>
        <div className="in-grid" style={{ marginTop: 8 }}>
          <div className="field" style={{ margin: 0 }}>
            <label>Seat / position</label>
            <input className="text-in" value={machine.seatSetting ?? ''} placeholder="4"
              onChange={(e) => patch({ seatSetting: e.target.value })} />
          </div>
          <div className="field" style={{ margin: 0 }}>
            <label>Notes</label>
            <input className="text-in" value={machine.setupNotes ?? ''} placeholder="Feet high, slow negatives"
              onChange={(e) => patch({ setupNotes: e.target.value })} />
          </div>
        </div>
      </div>

      {perf && (
        <div className="card">
          <div className="row">
            <b style={{ fontSize: '0.85rem' }}>Last time</b>
            <span className="small">{perf.workoutDate.slice(5).replace('-', '/')}</span>
          </div>
          <span className="small">{perf.sets.map((s) => `${s.weightLb}×${s.reps}`).join(' · ')}</span>
        </div>
      )}

      <button className="big-btn" onClick={logSets}>Log sets on this machine</button>
    </>
  )
}
