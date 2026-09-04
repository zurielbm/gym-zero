import { useEffect, useState } from 'react'
import { useApp } from '../AppContext'
import { Seg } from '../components/Seg'
import { VideoPlayer } from '../components/VideoPlayer'
import { aiConfig, fetchMachineInfo, recommendProgram, useAiAvailable } from '../lib/ai'
import type { AiProgram, EquipmentModel, Exercise, ExperienceLevel, GymMachine, MachineAiInfo, PrevPerformance, Settings, StrengthBaseline, TrainingGoal } from '../types'
import { epleyMaxLb, machineExerciseIds, machineSupportsExercise, normalizeMachineExercises } from '../types'

interface ExercisePickerProps {
  value: string[]
  exercises: Map<string, Exercise>
  onChange: (ids: string[]) => void
}

function ExercisePicker({ value, exercises, onChange }: ExercisePickerProps) {
  const available = [...exercises.values()].filter((exercise) => !value.includes(exercise.id))
  return (
    <div className="machine-exercise-editor">
      {value.map((id) => (
        <div className="machine-exercise-edit-row" key={id}>
          <span>
            <b>{exercises.get(id)?.name ?? id}</b>
            <small>{exercises.get(id)?.muscleGroups.join(' · ')}</small>
          </span>
          <button className="icon-btn" title={`Remove ${exercises.get(id)?.name ?? 'exercise'}`} onClick={() => onChange(value.filter((other) => other !== id))}>×</button>
        </div>
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
          <option value="">＋ Add another exercise…</option>
          {available.map((exercise) => <option key={exercise.id} value={exercise.id}>{exercise.name}</option>)}
        </select>
      )}
    </div>
  )
}

interface Props {
  machineId?: string
  /** movement selected before entering this physical machine */
  initialExerciseId?: string
  /** catalog match for a scanned-but-unmapped QR */
  modelId?: string
  /** raw scanned QR url when this machine isn't mapped yet */
  qrUrl?: string
}

export function MachineScreen({ machineId, initialExerciseId, modelId, qrUrl }: Props) {
  const { api, go, activeWorkout, setActiveWorkout, exercises, settings, refreshSettings } = useApp()
  const [machine, setMachine] = useState<GymMachine | null>(null)
  const [model, setModel] = useState<EquipmentModel | null>(null)
  const [perf, setPerf] = useState<PrevPerformance | undefined>()
  const [baseline, setBaseline] = useState<StrengthBaseline | undefined>()
  const [baseW, setBaseW] = useState('')
  const [baseR, setBaseR] = useState('')
  const [baseSaved, setBaseSaved] = useState(false)
  const [loaded, setLoaded] = useState(false)
  // map-new-machine form and mapped-machine exercise editor
  const [nickname, setNickname] = useState('')
  const [draftExerciseIds, setDraftExerciseIds] = useState<string[]>([])
  const [selectedExerciseId, setSelectedExerciseId] = useState('')
  const [editingExercises, setEditingExercises] = useState(false)
  const [editExerciseIds, setEditExerciseIds] = useState<string[]>([])
  const aiAvail = useAiAvailable(settings)
  const [aiInfo, setAiInfo] = useState<MachineAiInfo | null>(null)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiError, setAiError] = useState<string | null>(null)
  // starter program
  const [program, setProgram] = useState<AiProgram | null>(null)
  const [progBusy, setProgBusy] = useState(false)
  const [progError, setProgError] = useState<string | null>(null)
  // one-time inline profile prompt (defaults tuned for a new lifter)
  const [quickExp, setQuickExp] = useState<ExperienceLevel>('new')
  const [quickGoal, setQuickGoal] = useState<TrainingGoal>('recomp')

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
      const scannedUrl = qrUrl ?? m?.qrUrl
      const cached = scannedUrl ? await api.getMachineAiInfo(scannedUrl) : undefined
      if (!alive) return
      setMachine(m ?? null)
      setModel(mo ?? null)
      setAiInfo(cached ?? null)
      if (m) {
        const ids = machineExerciseIds(m)
        const selected = initialExerciseId && machineSupportsExercise(m, initialExerciseId)
          ? initialExerciseId
          : ids[0] ?? ''
        setSelectedExerciseId(selected)
        setEditExerciseIds(ids)
      } else if (mo) {
        setNickname(mo.modelName)
        setDraftExerciseIds(mo.exerciseIds.filter((id) => exercises.has(id)))
      } else if (cached) {
        const name = [cached.manufacturer, cached.modelName].filter(Boolean).join(' ')
        if (name) setNickname((cur) => cur || name)
        const ids = (cached.exerciseIds?.length ? cached.exerciseIds : cached.exerciseId ? [cached.exerciseId] : [])
          .filter((id) => exercises.has(id))
        setDraftExerciseIds(ids)
      }
      setLoaded(true)
    }
    load()
    return () => { alive = false }
  }, [api, exercises, initialExerciseId, machineId, modelId, qrUrl])

  useEffect(() => {
    if (!machine || !selectedExerciseId) return
    let alive = true
    setPerf(undefined)
    setBaseline(undefined)
    setProgram(null)
    setBaseW('')
    setBaseR('')
    setBaseSaved(false)
    Promise.all([
      api.getPrevPerformance(selectedExerciseId, activeWorkout?.id),
      api.getBaseline(selectedExerciseId),
      api.getAiProgram(machine.id, selectedExerciseId),
    ]).then(([nextPerf, nextBaseline, nextProgram]) => {
      if (!alive) return
      setPerf(nextPerf)
      setBaseline(nextBaseline)
      setProgram(nextProgram ?? null)
      setBaseW(nextBaseline ? String(nextBaseline.weightLb) : '')
      setBaseR(nextBaseline ? String(nextBaseline.reps) : '')
    })
    return () => { alive = false }
  }, [activeWorkout?.id, api, machine?.id, selectedExerciseId])

  if (!loaded) return null

  const videoUrl = model?.videoUrl ?? machine?.qrUrl ?? qrUrl

  const askAi = async () => {
    const config = aiConfig(settings)
    if (!config || !qrUrl || aiBusy) return
    setAiBusy(true)
    setAiError(null)
    try {
      const info = await fetchMachineInfo(config, qrUrl, [...exercises.values()])
      await api.saveMachineAiInfo(info)
      setAiInfo(info)
      const name = [info.manufacturer, info.modelName].filter(Boolean).join(' ')
      if (name) setNickname((cur) => cur || name)
      const ids = (info.exerciseIds?.length ? info.exerciseIds : info.exerciseId ? [info.exerciseId] : [])
        .filter((id) => exercises.has(id))
      if (ids.length) setDraftExerciseIds((cur) => cur.length ? cur : ids)
      if (!info.identified) setAiError("AI couldn't identify this machine — map it manually below.")
    } catch (err) {
      setAiError(err instanceof Error ? err.message : String(err))
    } finally {
      setAiBusy(false)
    }
  }

  const generateProgram = async (m: GymMachine, exerciseId: string, override?: Partial<Settings>) => {
    const config = aiConfig(settings)
    const exercise = exercises.get(exerciseId)
    if (!config || !exercise) return
    setProgBusy(true)
    setProgError(null)
    try {
      const prog = await recommendProgram(config, {
        machine: m, exercise, machineAi: aiInfo,
        settings: { ...settings, ...override }, prev: perf, baseline,
      })
      await api.saveAiProgram(prog)
      setProgram(prog)
    } catch (err) {
      setProgError(err instanceof Error ? err.message : String(err))
    } finally {
      setProgBusy(false)
    }
  }

  const hasProfile = !!settings.experience || !!settings.goal

  const quickSetupAndGenerate = async (m: GymMachine, exerciseId: string) => {
    await api.saveSettings({ ...settings, experience: quickExp, goal: quickGoal })
    await refreshSettings()
    await generateProgram(m, exerciseId, { experience: quickExp, goal: quickGoal })
  }

  const aiGuide = aiInfo && (aiInfo.setupTips || aiInfo.howTo.length > 0) ? (
    <div className="card">
      <div className="row">
        <span className="lab lm">✦ AI guide</span>
        <span className="lab">
          {aiInfo.confidence === 'high' ? 'Confidence high' : aiInfo.confidence === 'medium' ? 'Best guess' : 'Low confidence'}
        </span>
      </div>
      {aiInfo.setupTips && <span className="small" style={{ display: 'block', marginTop: 6 }}>{aiInfo.setupTips}</span>}
      {aiInfo.howTo.length > 0 && (
        <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          {aiInfo.howTo.map((cue, i) => <li key={i}>{cue}</li>)}
        </ul>
      )}
    </div>
  ) : null

  // ----- not mapped yet: name it once -----
  if (!machine) {
    const createMachine = async () => {
      if (!nickname.trim() || draftExerciseIds.length === 0) return
      const m = normalizeMachineExercises<GymMachine>({
        id: crypto.randomUUID(),
        nickname: nickname.trim(),
        exerciseId: draftExerciseIds[0]!,
        exerciseIds: draftExerciseIds,
        equipmentModelId: model?.id,
        qrUrl,
        favorite: true,
      })
      await api.saveMachine(m)
      setMachine(m)
      setSelectedExerciseId(m.exerciseId)
      setEditExerciseIds(machineExerciseIds(m))
      // profile already known → build the starter program right away; otherwise
      // the mapped view shows the one-time quick-setup prompt first
      if (aiAvail.available && hasProfile) void generateProgram(m, m.exerciseId)
    }
    return (
      <div className="page">
        <button className="back-link" onClick={() => go({ name: 'scan' })}>‹ Scanner</button>
        <h1 className="p-h1" style={{ fontSize: '1.6rem' }}>
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

        {aiGuide}
        {!model && qrUrl && !aiInfo && (
          <>
            <button className="ghost-btn" disabled={!aiAvail.available || aiBusy} onClick={() => void askAi()}>
              {aiBusy ? '✦ Asking AI…' : '✦ Ask AI what this is'}
            </button>
            {!aiAvail.available && (
              <span className="small" style={{ display: 'block', margin: '6px 0 0' }}>
                {aiAvail.configured ? 'AI offline — connect to Tailscale.' : 'Set up AI in Settings.'}
              </span>
            )}
            <div style={{ height: 10 }} />
          </>
        )}
        {aiError && <span className="small" style={{ color: 'var(--danger)', display: 'block', marginBottom: 8 }}>{aiError}</span>}

        <div className="card">
          <div className="field">
            <label>Nickname (how you'd find it at your club)</label>
            <input className="text-in" value={nickname} placeholder="Chest press by the windows"
              onChange={(e) => setNickname(e.target.value)} />
          </div>
          <div className="field">
            <label>Exercises on this machine</label>
            <span className="small" style={{ display: 'block', marginBottom: 8 }}>
              Add every movement this physical station can do. You will choose one when you train.
            </span>
            <ExercisePicker value={draftExerciseIds} exercises={exercises} onChange={setDraftExerciseIds} />
          </div>
          <button className="big-btn" onClick={createMachine} disabled={!nickname.trim() || draftExerciseIds.length === 0}>
            Save my machine →
          </button>
        </div>
      </div>
    )
  }

  // ----- mapped machine -----
  const supportedExerciseIds = machineExerciseIds(machine)
  const currentExerciseId = machineSupportsExercise(machine, selectedExerciseId)
    ? selectedExerciseId
    : supportedExerciseIds[0] ?? machine.exerciseId
  const ex = exercises.get(currentExerciseId)
  const patch = async (p: Partial<GymMachine>) => {
    const next = normalizeMachineExercises({ ...machine, ...p })
    setMachine(next)
    await api.saveMachine(next)
  }

  const selectExercise = (id: string) => {
    if (id === currentExerciseId) return
    setSelectedExerciseId(id)
    setPerf(undefined)
    setBaseline(undefined)
    setProgram(null)
    setBaseW('')
    setBaseR('')
    setBaseSaved(false)
    setProgError(null)
  }

  const saveExercises = async () => {
    if (editExerciseIds.length === 0) return
    const next = normalizeMachineExercises({
      ...machine,
      exerciseId: editExerciseIds.includes(machine.exerciseId) ? machine.exerciseId : editExerciseIds[0]!,
      exerciseIds: editExerciseIds,
    })
    setMachine(next)
    if (!machineSupportsExercise(next, currentExerciseId)) selectExercise(next.exerciseId)
    setEditExerciseIds(machineExerciseIds(next))
    setEditingExercises(false)
    await api.saveMachine(next)
  }

  const logSets = async () => {
    if (!activeWorkout) {
      const w = await api.startWorkout()
      setActiveWorkout(w)
    }
    go({ name: 'workout', exerciseId: currentExerciseId, machineId: machine.id })
  }

  return (
    <div className="page">
      <div className="row" style={{ marginBottom: 8 }}>
        <button
          className="back-link"
          style={{ margin: 0 }}
          onClick={() => go(initialExerciseId && activeWorkout
            ? { name: 'workout', exerciseId: currentExerciseId, machineId: machine.id }
            : { name: 'scan' })}
        >
          ‹ {initialExerciseId && activeWorkout ? 'Workout' : 'Scanner'}
        </button>
        <button
          className={`icon-btn${machine.favorite ? ' fav' : ''}`}
          title="Favorite"
          onClick={() => patch({ favorite: !machine.favorite })}
        >
          {machine.favorite ? '★' : '☆'}
        </button>
      </div>
      <h1 className="p-h1" style={{ fontSize: '1.6rem' }}>{machine.nickname}</h1>
      <p className="p-sub" style={{ textTransform: 'uppercase', fontSize: '0.62rem', letterSpacing: '0.1em', fontWeight: 700 }}>
        {model
          ? `${model.manufacturer} · ${model.modelName}`
          : supportedExerciseIds.map((id) => exercises.get(id)?.name).filter(Boolean).join(' · ')}
      </p>

      <VideoPlayer url={videoUrl} />

      {supportedExerciseIds.length > 1 && !editingExercises && (
        <div className="machine-movement-picker">
          <div className="row" style={{ marginBottom: 8 }}>
            <span className="lab lm">What are you training?</span>
            <button
              className="back-link"
              style={{ margin: 0 }}
              disabled={progBusy}
              onClick={() => { setEditExerciseIds(supportedExerciseIds); setEditingExercises(true) }}
            >
              Edit exercises
            </button>
          </div>
          {supportedExerciseIds.map((id) => {
            const exercise = exercises.get(id)
            return (
              <button
                key={id}
                className={`machine-movement${id === currentExerciseId ? ' current' : ''}`}
                disabled={progBusy}
                onClick={() => selectExercise(id)}
              >
                <b>{exercise?.name ?? id}</b>
                <span>{exercise?.muscleGroups.join(' · ')}</span>
              </button>
            )
          })}
        </div>
      )}

      {editingExercises && (
        <div className="card">
          <span className="lab lm">Exercises on this machine</span>
          <span className="small" style={{ display: 'block', margin: '6px 0 10px' }}>
            Keep every movement this physical station can do. Past workouts stay separate by exercise.
          </span>
          <ExercisePicker value={editExerciseIds} exercises={exercises} onChange={setEditExerciseIds} />
          <div className="machine-edit-actions">
            <button className="ghost-btn" onClick={() => { setEditExerciseIds(supportedExerciseIds); setEditingExercises(false) }}>Cancel</button>
            <button className="big-btn" disabled={editExerciseIds.length === 0} onClick={() => void saveExercises()}>Save exercises</button>
          </div>
        </div>
      )}

      <div style={{ marginBottom: 10 }}>
        {ex?.muscleGroups.map((m) => (
          <span key={m} className="chip green" style={{ textTransform: 'capitalize' }}>{m}</span>
        ))}
        {ex && <span className="chip blue" style={{ textTransform: 'capitalize' }}>{ex.equipment}</span>}
      </div>

      {aiGuide}

      {program ? (
        <div className="card">
          <div className="row">
            <span className="lab lm">✦ Your starter program</span>
            {aiAvail.available && (
              <button
                className="ghost-btn" style={{ width: 'auto', padding: '6px 12px', fontSize: '0.7rem' }}
                disabled={progBusy || editingExercises} onClick={() => void generateProgram(machine, currentExerciseId)}
              >
                {progBusy ? 'Recalculating…' : '↻ Recalculate'}
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: 22, margin: '10px 0 8px' }}>
            <span>
              <span className="num" style={{ fontSize: '1.4rem', display: 'block' }}>{program.sets}×{program.reps}</span>
              <span className="lab">Sets × reps</span>
            </span>
            {program.startWeightLb != null && (
              <span>
                <span className="num" style={{ fontSize: '1.4rem', display: 'block' }}>~{program.startWeightLb}</span>
                <span className="lab">{perf || baseline ? 'Start lb' : 'Start lb · guess'}</span>
              </span>
            )}
            <span>
              <span className="num" style={{ fontSize: '1.4rem', display: 'block' }}>{program.restSeconds}s</span>
              <span className="lab">Rest</span>
            </span>
          </div>
          <span className="small" style={{ display: 'block' }}>{program.effortCheck} <b>{program.progression}</b></span>
          {program.warmup && <span className="small" style={{ display: 'block', marginTop: 4 }}>Warm-up: {program.warmup}</span>}
          {program.cautions && <span className="small" style={{ display: 'block', marginTop: 4, color: 'var(--danger)' }}>⚑ {program.cautions}</span>}
        </div>
      ) : !hasProfile && aiAvail.available ? (
        <div className="card">
          <span className="lab lm">✦ Quick setup — sizes your program</span>
          <span className="small" style={{ display: 'block', margin: '6px 0 2px' }}>How much have you trained before?</span>
          <Seg
            options={[{ v: 'new', label: "I'm new" }, { v: 'returning', label: 'Some' }, { v: 'experienced', label: 'A lot' }]}
            value={quickExp} onPick={setQuickExp}
          />
          <span className="small" style={{ display: 'block', margin: '2px 0 2px' }}>Main goal?</span>
          <Seg
            options={[
              { v: 'recomp', label: 'Muscle + abs' }, { v: 'muscle', label: 'Muscle' },
              { v: 'fat-loss', label: 'Fat loss' }, { v: 'strength', label: 'Strength' },
            ]}
            value={quickGoal} onPick={setQuickGoal}
          />
          <button className="big-btn" disabled={progBusy || editingExercises} onClick={() => void quickSetupAndGenerate(machine, currentExerciseId)}>
            {progBusy ? 'Building your program…' : 'Get my program →'}
          </button>
          <div style={{ height: 8 }} />
          <button className="ghost-btn" disabled={progBusy || editingExercises} onClick={() => void generateProgram(machine, currentExerciseId)}>
            Skip — use safe defaults
          </button>
        </div>
      ) : (
        <>
          <button className="ghost-btn" disabled={!aiAvail.available || progBusy || editingExercises} onClick={() => void generateProgram(machine, currentExerciseId)}>
            {progBusy ? '✦ Building your program…' : '✦ Get my starter program'}
          </button>
          {!aiAvail.available && (
            <span className="small" style={{ display: 'block', margin: '6px 0 0' }}>
              {aiAvail.configured ? 'AI offline — connect to Tailscale.' : 'Set up AI in Settings.'}
            </span>
          )}
          <div style={{ height: 10 }} />
        </>
      )}
      {progError && <span className="small" style={{ color: 'var(--danger)', display: 'block', marginBottom: 8 }}>{progError}</span>}

      {!perf && (
        <div className="card">
          <div className="row">
            <span className="lab lm">I know my weight</span>
            {baseline && (
              <span className="lab">est. max ~{epleyMaxLb(baseline.weightLb, baseline.reps)} lb</span>
            )}
          </div>
          <span className="small" style={{ display: 'block', margin: '6px 0 8px' }}>
            Done this machine before? Enter one set's worth: the weight and how many reps you get at it (e.g. 50 × 10, not number of sets). Your program starts from it instead of a guess.
          </span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              className="text-in" inputMode="decimal" placeholder="lb" style={{ width: 74, textAlign: 'center' }}
              value={baseW} onChange={(e) => { setBaseW(e.target.value); setBaseSaved(false) }}
            />
            <span className="lab">×</span>
            <input
              className="text-in" inputMode="numeric" placeholder="reps" style={{ width: 62, textAlign: 'center' }}
              value={baseR} onChange={(e) => { setBaseR(e.target.value); setBaseSaved(false) }}
            />
            <button
              className="ghost-btn" style={{ width: 'auto', padding: '10px 18px' }}
              disabled={!(parseFloat(baseW) > 0 && parseInt(baseR, 10) > 0)}
              onClick={async () => {
                const saved = await api.saveBaseline({
                  id: currentExerciseId,
                  weightLb: parseFloat(baseW),
                  reps: parseInt(baseR, 10),
                })
                setBaseline(saved)
                setBaseSaved(true)
              }}
            >
              {baseSaved ? 'Saved ✓' : 'Save'}
            </button>
          </div>
          {(() => {
            const w = parseFloat(baseW)
            const r = parseInt(baseR, 10)
            if (!(w > 0 && r > 0)) return null
            const max = epleyMaxLb(w, r)
            const start = Math.max(5, Math.round((max * 0.72) / 5) * 5)
            return (
              <span className="small" style={{ display: 'block', marginTop: 6 }}>
                {r <= 5
                  ? `${w}×${r} reads as a near-max effort (max ~${max} lb). If ${w} lb is a normal set for you, enter the reps you actually get at it.`
                  : `One set of ${r} at ${w} lb → max ~${max} lb. Your program will start near ~${start} lb and grow as you log heavier sets.`}
              </span>
            )
          })()}
          {baseSaved && program && aiAvail.available && (
            <span className="small" style={{ display: 'block', marginTop: 6 }}>
              Tap ↻ Recalculate above to rebuild the program from this weight.
            </span>
          )}
        </div>
      )}

      <div className="card">
        <div className="row">
          <b style={{ fontSize: '0.85rem' }}>My setup</b>
          {supportedExerciseIds.length === 1 && !editingExercises && (
            <button
              className="back-link"
              style={{ margin: 0 }}
              disabled={progBusy}
              onClick={() => { setEditExerciseIds(supportedExerciseIds); setEditingExercises(true) }}
            >
              Edit exercises
            </button>
          )}
        </div>
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
            <span className="lab">Your numbers here</span>
            <span className="lab">{perf.workoutDate.slice(5).replace('-', '.')}</span>
          </div>
          <div style={{ display: 'flex', gap: 22, marginTop: 8, flexWrap: 'wrap' }}>
            {perf.sets.map((s, i) => (
              <span key={i}>
                <span className="num" style={{ fontSize: '1.3rem', display: 'block' }}>{s.weightLb}×{s.reps}</span>
                <span className="lab">Set {i + 1}</span>
              </span>
            ))}
          </div>
        </div>
      )}

      <button className="big-btn" onClick={logSets}>Log {ex?.name ?? 'exercise'} sets →</button>
    </div>
  )
}
