import { useEffect, useMemo, useRef, useState } from 'react'
import { useApp } from '../AppContext'
import { aiConfig, identifyExercisePhoto, identifyExerciseDescription, useAiAvailable, type AiExercisePhotoResult } from '../lib/ai'
import { Seg } from './Seg'
import { ExerciseReview, type ExerciseDraft } from './ExerciseReview'
import { downscalePhoto } from '../lib/image'
import type { Exercise } from '../types'

/**
 * "What is this machine?" from a photo instead of a QR sticker. The photo stays
 * on the device — the only place it ever goes is the user's own AI proxy, and
 * only when they tap Identify. Nothing is written to the database from an AI
 * guess: the user reviews and confirms the exercise, and that confirmation is
 * what saves it and starts the workout. Browsing and adding by hand need no AI
 * at all, so the manual path stays open when the proxy is off or unreachable.
 */
export function ExercisePhoto({ capturePhoto }: { capturePhoto?: () => string }) {
  const { api, go, settings, exercises, activeWorkout, setActiveWorkout, refreshExercises } = useApp()
  const ai = useAiAvailable(settings)
  const [photo, setPhoto] = useState<string | null>(null)
  const [mode, setMode] = useState<'photo' | 'describe'>('photo')
  const [description, setDescription] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<AiExercisePhotoResult | null>(null)
  /** manual review: browsing the catalog or adding by hand, with no AI involved */
  const [manual, setManual] = useState(false)
  const [reviewError, setReviewError] = useState<string | null>(null)
  const [reviewNote, setReviewNote] = useState<string | null>(null)
  /** bumped after a delete so the review re-derives from the refreshed catalog */
  const [reviewKey, setReviewKey] = useState(0)
  const takeRef = useRef<HTMLInputElement>(null)
  const uploadRef = useRef<HTMLInputElement>(null)
  // every photo/identify run takes a ticket; a stale run never writes state
  const gen = useRef(0)
  const alive = useRef(true)
  const operation = useRef(false)
  const logLock = useRef(false)

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false; gen.current += 1 }
  }, [])

  const catalog = useMemo(
    () => [...exercises.values()].sort((a, b) => a.name.localeCompare(b.name)),
    [exercises],
  )

  const clearResult = () => {
    setResult(null)
    setManual(false)
    setError(null)
    setReviewError(null)
    setReviewNote(null)
  }

  const usePhoto = (dataUrl: string, ticket: number) => {
    if (!alive.current || ticket !== gen.current) return
    setPhoto(dataUrl)
    clearResult()
  }

  const capture = () => {
    if (!capturePhoto || operation.current || logLock.current) return
    const ticket = gen.current += 1
    try {
      const dataUrl = capturePhoto()
      if (!dataUrl) throw new Error('empty frame')
      usePhoto(dataUrl, ticket)
    } catch {
      if (alive.current && ticket === gen.current) setError('Could not grab the camera frame — take or upload a photo instead.')
    }
  }

  const useFile = async (file: File) => {
    if (operation.current || logLock.current) return
    operation.current = true
    const ticket = gen.current += 1
    setBusy(true)
    setError(null)
    try {
      usePhoto(await downscalePhoto(file), ticket)
    } catch {
      if (alive.current && ticket === gen.current) {
        setError("Couldn't read that image — try a normal photo (JPEG or PNG).")
      }
    } finally {
      operation.current = false
      if (alive.current) setBusy(false)
    }
  }

  const identify = async () => {
    const config = aiConfig(settings)
    if (!config || (mode === 'photo' ? !photo : !description.trim()) || operation.current || logLock.current) return
    operation.current = true
    const ticket = gen.current += 1
    setBusy(true)
    setError(null)
    setResult(null)
    setManual(false)
    setReviewError(null)
    setReviewNote(null)
    try {
      const identified = mode === 'describe'
        ? await identifyExerciseDescription(config, description, catalog)
        : await identifyExercisePhoto(config, photo!, catalog, note.trim() || undefined)
      if (!alive.current || ticket !== gen.current) return
      setResult(identified)
    } catch (err) {
      if (alive.current && ticket === gen.current) setError(err instanceof Error ? err.message : String(err))
    } finally {
      operation.current = false
      if (alive.current) setBusy(false)
    }
  }

  const retake = () => {
    if (operation.current || logLock.current) return
    gen.current += 1
    setPhoto(null)
    setNote('')
    clearResult()
  }

  /**
   * The first and only write of this flow. saveExercise deduplicates, so a name
   * that already exists comes back as the existing record — we follow the id it
   * returns rather than assuming a new one was created.
   */
  const confirmExercise = async (draft: ExerciseDraft) => {
    if (logLock.current || operation.current) return
    logLock.current = true
    setSaving(true)
    setReviewError(null)
    setReviewNote(null)
    try {
      const saved = await api.saveExercise(draft)
      await refreshExercises()
      if (!alive.current) return
      if (!activeWorkout) {
        const workout = await api.startWorkout()
        if (!alive.current) return
        setActiveWorkout(workout)
      }
      if (alive.current) go({ name: 'workout', exerciseId: saved.id })
    } catch (err) {
      if (alive.current) setReviewError(err instanceof Error ? err.message : String(err))
    } finally {
      logLock.current = false
      if (alive.current) setSaving(false)
    }
  }

  /** The API refuses exercises that history references; that error is the message. */
  const deleteCustom = async (exercise: Exercise) => {
    if (logLock.current || operation.current) return
    logLock.current = true
    setSaving(true)
    setReviewError(null)
    setReviewNote(null)
    try {
      await api.deleteExercise(exercise.id)
      await refreshExercises()
      if (!alive.current) return
      setReviewKey((k) => k + 1)
      setReviewNote(`Deleted ${exercise.name}.`)
    } catch (err) {
      if (alive.current) setReviewError(err instanceof Error ? err.message : String(err))
    } finally {
      logLock.current = false
      if (alive.current) setSaving(false)
    }
  }

  const openManual = () => {
    if (operation.current || logLock.current) return
    setError(null)
    setReviewError(null)
    setReviewNote(null)
    setManual(true)
  }

  const reviewing = !!result || manual
  const disabled = !ai.available
  const openSettings = () => go({ name: 'settings' })

  return (
    <div className="card">
      <div className="row">
        <span className="lab lm">✦ Identify an exercise</span>
        {mode === 'photo' && photo && (
          <button className="back-link" style={{ margin: 0 }} disabled={busy || saving} onClick={retake}>
            Retake
          </button>
        )}
      </div>
      <Seg options={[{ v: 'photo', label: 'Photo' }, { v: 'describe', label: 'Describe it' }]}
        value={mode} onPick={(next) => {
          if (operation.current || logLock.current) return
          gen.current += 1
          setMode(next)
          clearResult()
        }} />
      <span className="small" style={{ display: 'block', margin: '6px 0 10px' }}>
        {mode === 'describe'
          ? 'Describe your position, the equipment, and how you move. AI suggests possible exercises for you to choose.'
          : 'Photograph an exercise or the whole machine. Tap Identify to send the photo to your AI service. This app does not save the photo.'}
      </span>

      {mode === 'describe' ? (
        <div className="field">
          <label htmlFor="exercise-description">Describe the exercise or workout movement</label>
          <textarea id="exercise-description" className="text-in" rows={4} maxLength={1000}
            style={{ resize: 'vertical', width: '100%' }} value={description} disabled={busy || saving}
            placeholder="I sit on a bench and pull a cable handle toward my stomach, keeping my elbows close."
            onChange={(e) => { setDescription(e.target.value); clearResult() }} />
        </div>
      ) : photo ? (
        <img
          src={photo}
          alt="Exercise or equipment photo to identify"
          style={{ width: '100%', display: 'block', maxHeight: 320, objectFit: 'contain', border: '1px solid var(--track)', marginBottom: 10 }}
        />
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          {capturePhoto && (
            <button className="ghost-btn" style={{ width: 'auto', flex: '1 1 140px' }} disabled={busy} onClick={capture}>
              ◉ Use camera shot
            </button>
          )}
          <button className="ghost-btn" style={{ width: 'auto', flex: '1 1 140px' }} disabled={busy} onClick={() => takeRef.current?.click()}>
            📷 Take photo
          </button>
          <button className="ghost-btn" style={{ width: 'auto', flex: '1 1 140px' }} disabled={busy} onClick={() => uploadRef.current?.click()}>
            ⬆ Upload photo
          </button>
        </div>
      )}
      <input
        ref={takeRef} type="file" accept="image/*" capture="environment"
        aria-label="Take a photo of the machine" style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = '' // same file twice must still fire change
          if (file) void useFile(file)
        }}
      />
      <input
        ref={uploadRef} type="file" accept="image/*"
        aria-label="Upload a photo of the machine" style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          e.target.value = ''
          if (file) void useFile(file)
        }}
      />

      {(mode === 'describe' || photo) && !reviewing && (
        <>
          {mode === 'photo' && <div className="field">
            <label htmlFor="exercise-photo-note">Anything to add? — optional</label>
            <input
              id="exercise-photo-note" className="text-in" value={note} disabled={busy} maxLength={1000}
              placeholder="The seat says chest press"
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && ai.available) void identify() }}
            />
          </div>}
          <button
            className={`big-btn${disabled ? ' soft-disabled' : ''}`}
            disabled={busy || (mode === 'describe' && !description.trim())}
            onClick={() => (ai.available ? void identify() : openSettings())}
          >
            {busy ? 'Finding matches…' : mode === 'describe' ? 'Find possible exercises →' : 'Identify exercise →'}
          </button>
        </>
      )}

      {disabled && !reviewing && (
        <button className="ai-hint" onClick={openSettings}>
          {ai.configured
            ? '⚡ AI offline — connect to Tailscale, or check the endpoint in Settings ›'
            : '⚡ AI is off — set your endpoint in Settings to identify exercises ›'}
        </button>
      )}

      {/* browsing and adding by hand never need the AI, so this stays open always */}
      {!reviewing && (
        <button className="ghost-btn" style={{ marginTop: 8 }} disabled={busy} onClick={openManual}>
          ☰ Pick or add it myself
        </button>
      )}

      <span className="small" role="status" aria-live="polite" style={{ display: busy ? 'block' : 'none', marginTop: 8 }}>
        {mode === 'describe' ? 'Reading your description…' : 'Reading the photo…'}
      </span>

      {error && !reviewing && (
        <div style={{ marginTop: 10 }}>
          <span className="small" role="alert" style={{ color: 'var(--danger)', display: 'block' }}>{error}</span>
          {(mode === 'describe' ? !!description.trim() : !!photo) && (
            <button className="ghost-btn" style={{ width: 'auto', padding: '8px 14px', marginTop: 8 }} disabled={busy}
              onClick={() => (ai.available ? void identify() : openSettings())}>
              Try again
            </button>
          )}
        </div>
      )}

      {reviewing && <>
        {reviewNote && <p className="small" role="status">{reviewNote}</p>}
        <ExerciseReview key={reviewKey} result={result} exercises={exercises} saving={saving}
          error={reviewError} onConfirm={(draft) => void confirmExercise(draft)}
          onDelete={(exercise) => void deleteCustom(exercise)}
          onCancel={clearResult} />
      </>}
    </div>
  )
}
