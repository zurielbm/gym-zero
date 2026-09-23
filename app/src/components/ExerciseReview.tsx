import { useMemo, useState } from 'react'
import {
  ACTIVITY_CATEGORIES, FORMAT_LABELS, MUSCLE_GROUPS, RECORDING_FORMATS,
  type ActivityCategory, type EquipmentKind, type Exercise, type MuscleGroup, type RecordingFormat,
} from '../types'
import type { AiExercisePhotoResult } from '../lib/ai'
import { exerciseNameKey, exerciseNames } from '../lib/exercises'
import './exercise-review.css'

/** What the caller persists with api.saveExercise — an id means "edit that one". */
export type ExerciseDraft = Omit<Exercise, 'id'> & { id?: string }

type MatchKind = 'exact' | 'possible' | 'none'

/**
 * Fields the AI layer is growing. Read defensively so this screen compiles and
 * behaves the same whether or not the model (or the parser) filled them in.
 */
interface SuggestionExtras {
  categories?: unknown
  primaryCategory?: unknown
  primaryMuscles?: unknown
  supportingMuscles?: unknown
  recordingFormat?: unknown
  equipment?: unknown
  matchKind?: unknown
  matchReasons?: unknown
}

const EQUIPMENT_KINDS: EquipmentKind[] = ['machine', 'cable', 'free', 'bodyweight']
const EQUIPMENT_LABELS: Record<EquipmentKind, string> = {
  machine: 'Machine', cable: 'Cable', free: 'Free weights', bodyweight: 'Bodyweight',
}
const CATEGORY_LABELS: Record<ActivityCategory, string> = {
  strength: 'Strength', cardio: 'Cardio', mobility: 'Mobility',
}
/** A picked category only *suggests* a format — the user can change it after. */
const CATEGORY_FORMAT: Record<ActivityCategory, RecordingFormat> = {
  strength: 'weight-reps', cardio: 'duration-distance', mobility: 'duration',
}
const FIT_LABELS: Record<MatchKind, string> = {
  exact: 'Catalog fit: exact', possible: 'Catalog fit: possible', none: 'Catalog fit: none',
}
const EQUIPMENT_READ: Record<AiExercisePhotoResult['confidence'], string> = {
  high: 'Equipment read: clear', medium: 'Equipment read: best guess', low: 'Equipment read: unsure',
}

const isCategory = (v: unknown): v is ActivityCategory => ACTIVITY_CATEGORIES.includes(v as ActivityCategory)
const isMuscle = (v: unknown): v is MuscleGroup => MUSCLE_GROUPS.includes(v as MuscleGroup)
const isFormat = (v: unknown): v is RecordingFormat => RECORDING_FORMATS.includes(v as RecordingFormat)
const isEquipment = (v: unknown): v is EquipmentKind => EQUIPMENT_KINDS.includes(v as EquipmentKind)

const pickList = <T,>(v: unknown, keep: (x: unknown) => x is T): T[] =>
  Array.isArray(v) ? [...new Set(v.filter(keep))] : []
/** Stable display order so chips never reshuffle while tapping. */
const inMuscleOrder = (groups: MuscleGroup[]): MuscleGroup[] =>
  MUSCLE_GROUPS.filter((m) => groups.includes(m))

interface Suggestion {
  name: string
  identified: boolean
  explanation: string
  confidence: AiExercisePhotoResult['confidence']
  matchKind: MatchKind
  matchReasons: Record<string, string>
  exerciseIds: string[]
  categories: ActivityCategory[]
  primaryCategory: ActivityCategory | ''
  primaryMuscles: MuscleGroup[]
  supportingMuscles: MuscleGroup[]
  scanMuscles: MuscleGroup[]
  recordingFormat: RecordingFormat | ''
  equipment: EquipmentKind | ''
}

function normalize(result: AiExercisePhotoResult): Suggestion {
  // the extra fields may not exist on the type yet; nothing here trusts them
  const extra = result as unknown as SuggestionExtras
  const categories = pickList(extra.categories, isCategory)
  const primaryCategory = isCategory(extra.primaryCategory) ? extra.primaryCategory
    : categories.length === 1 ? categories[0] : ''
  const reasons: Record<string, string> = {}
  if (extra.matchReasons && typeof extra.matchReasons === 'object' && !Array.isArray(extra.matchReasons)) {
    for (const [id, why] of Object.entries(extra.matchReasons as Record<string, unknown>)) {
      if (typeof why === 'string' && why.trim()) reasons[id] = why.trim().slice(0, 120)
    }
  }
  const exerciseIds = (result.exerciseIds ?? []).slice(0, 3)
  return {
    name: result.identified ? result.name.trim() : '',
    identified: result.identified,
    explanation: result.explanation ?? '',
    confidence: result.confidence,
    matchKind: extra.matchKind === 'exact' || extra.matchKind === 'possible' || extra.matchKind === 'none'
      ? extra.matchKind
      : exerciseIds.length === 0 ? 'none' : result.confidence === 'high' ? 'exact' : 'possible',
    matchReasons: reasons,
    exerciseIds,
    categories: primaryCategory && !categories.includes(primaryCategory) ? [primaryCategory, ...categories] : categories,
    primaryCategory,
    primaryMuscles: pickList(extra.primaryMuscles, isMuscle),
    supportingMuscles: pickList(extra.supportingMuscles, isMuscle),
    scanMuscles: pickList(result.muscleGroups, isMuscle),
    recordingFormat: isFormat(extra.recordingFormat) ? extra.recordingFormat : '',
    equipment: isEquipment(extra.equipment) ? extra.equipment : '',
  }
}

type Choice = { kind: 'existing'; exercise: Exercise } | { kind: 'custom'; blank: boolean }

interface Form {
  name: string
  equipment: EquipmentKind | ''
  categories: ActivityCategory[]
  primaryCategory: ActivityCategory | ''
  format: RecordingFormat | ''
  primary: MuscleGroup[]
  supporting: MuscleGroup[]
  /** legacy muscleGroups with no roles assigned — kept verbatim until edited */
  legacyRoles: MuscleGroup[] | null
  rolesTouched: boolean
  formatTouched: boolean
}

/** A saved exercise wins over any scan guess: never overwrite what the user already keeps. */
function formFor(choice: Choice, suggestion: Suggestion | null): Form {
  if (choice.kind === 'existing') {
    const ex = choice.exercise
    const hasRoles = Array.isArray(ex.primaryMuscles) || Array.isArray(ex.supportingMuscles)
    const categories = pickList(ex.categories, isCategory)
    const primaryCategory = isCategory(ex.primaryCategory) ? ex.primaryCategory : categories[0] ?? 'strength'
    return {
      name: ex.name,
      equipment: ex.equipment,
      // old saved records predate categories, so they are strength by definition
      categories: categories.length ? categories : [primaryCategory],
      primaryCategory,
      format: ex.recordingFormat ?? 'weight-reps',
      primary: hasRoles ? inMuscleOrder(pickList(ex.primaryMuscles, isMuscle)) : [],
      supporting: hasRoles ? inMuscleOrder(pickList(ex.supportingMuscles, isMuscle)) : [],
      legacyRoles: hasRoles ? null : inMuscleOrder(pickList(ex.muscleGroups, isMuscle)),
      rolesTouched: false,
      formatTouched: true,
    }
  }
  const s = choice.blank ? null : suggestion
  const primary = inMuscleOrder(s?.primaryMuscles ?? [])
  return {
    name: s?.name ?? '',
    equipment: s?.equipment ?? '',
    categories: s?.categories ?? [],
    primaryCategory: s?.primaryCategory ?? '',
    format: s?.recordingFormat ?? '',
    primary,
    supporting: inMuscleOrder((s?.supportingMuscles ?? []).filter((m) => !primary.includes(m))),
    legacyRoles: !primary.length && !s?.supportingMuscles.length && s?.scanMuscles.length ? s.scanMuscles : null,
    rolesTouched: false,
    formatTouched: false,
  }
}

/**
 * The confirm step between "the AI thinks this is X" and anything hitting the
 * database. It never writes: it hands a reviewed draft back to the caller. The
 * user can accept a ranked match, edit a saved exercise, make a reusable custom
 * one, or browse the catalog by hand — the last two work with AI off entirely.
 */
export function ExerciseReview({ result, exercises, saving = false, error, onConfirm, onCancel, onDelete }: {
  /** null when AI is off, offline or failed — manual paths still work */
  result: AiExercisePhotoResult | null
  exercises: Map<string, Exercise>
  saving?: boolean
  error?: string | null
  onConfirm: (draft: ExerciseDraft) => void
  onCancel: () => void
  /** only offered for unused personal exercises; the API rejects referenced ones */
  onDelete?: (exercise: Exercise) => void
}) {
  const suggestion = useMemo(() => (result ? normalize(result) : null), [result])
  const catalog = useMemo(
    () => [...exercises.values()].sort((a, b) => a.name.localeCompare(b.name)),
    [exercises],
  )
  const matches = useMemo(
    () => (suggestion?.exerciseIds ?? [])
      .map((id) => exercises.get(id))
      .filter((e): e is Exercise => !!e),
    [suggestion, exercises],
  )

  // one unambiguous hit may start selected; anything the user must disambiguate does not
  const initial = useMemo<Choice | null>(
    () => (suggestion?.matchKind === 'exact' && matches.length === 1
      ? { kind: 'existing', exercise: matches[0] }
      : null),
    [suggestion, matches],
  )

  const [choice, setChoice] = useState<Choice | null>(initial)
  const [form, setForm] = useState<Form | null>(() => (initial ? formFor(initial, suggestion) : null))
  const [browsing, setBrowsing] = useState(!result)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ActivityCategory | 'all'>(suggestion?.primaryCategory || 'all')
  const [showSupporting, setShowSupporting] = useState(false)
  const [armDelete, setArmDelete] = useState(false)

  const pick = (next: Choice) => {
    if (saving) return
    setChoice(next)
    setForm(formFor(next, suggestion))
    setBrowsing(false)
    setShowSupporting(false)
    setArmDelete(false)
  }
  const backToPicks = () => {
    if (saving) return
    setChoice(null)
    setForm(null)
    setArmDelete(false)
    setBrowsing(!result)
  }
  const edit = (patch: Partial<Form>) => setForm((f) => (f ? { ...f, ...patch } : f))

  const browseList = useMemo(() => {
    const q = query.trim().toLowerCase()
    return catalog.filter((ex) => {
      const cats = pickList(ex.categories, isCategory)
      const effective = cats.length ? cats : [ex.primaryCategory ?? 'strength']
      if (filter !== 'all' && !effective.includes(filter)) return false
      if (!q) return true
      return ex.name.toLowerCase().includes(q)
        || (ex.aliases ?? []).some((a) => a.toLowerCase().includes(q))
        || ex.muscleGroups.some((m) => m.includes(q))
    })
  }, [catalog, query, filter])

  // ---------- picking ----------
  if (!choice || !form) {
    const ambiguous = matches.length > 1
    return (
      <div className="xr" aria-live="polite">
        <div className="row">
          <span className="lab lm">{suggestion ? 'Confirm the exercise' : 'Choose an exercise'}</span>
          <button className="back-link" style={{ margin: 0 }} disabled={saving} onClick={onCancel}>Cancel</button>
        </div>

        {suggestion && (
          <>
            <div className="xr-badges">
              <span className="chip">{EQUIPMENT_READ[suggestion.confidence]}</span>
              <span className={`chip${suggestion.matchKind === 'exact' ? ' green' : ''}`}>
                {FIT_LABELS[suggestion.matchKind]}
              </span>
            </div>
            {suggestion.explanation && <p className="small xr-clamp">{suggestion.explanation}</p>}
          </>
        )}

        {matches.length > 0 && (
          <div role="group" aria-label="Possible matches from your catalog">
            <span className="lab xr-head">
              {ambiguous ? 'Which one are you doing?' : 'Is this it?'}
            </span>
            {ambiguous && (
              <p className="small xr-note">This equipment does more than one movement — pick yours.</p>
            )}
            {matches.map((ex) => (
              <button key={ex.id} className="xr-option" disabled={saving}
                onClick={() => pick({ kind: 'existing', exercise: ex })}>
                <b>{ex.name}</b>
                <span className="xr-option-sub">{ex.muscleGroups.join(' · ') || 'No muscles saved'}</span>
                {suggestion?.matchReasons[ex.id] && (
                  <span className="xr-reason">{suggestion.matchReasons[ex.id]}</span>
                )}
              </button>
            ))}
          </div>
        )}

        {suggestion && suggestion.name && (
          <div>
            <span className="lab xr-head">
              {matches.length ? 'Not in that list?' : 'Nothing in your catalog matches'}
            </span>
            <button className="xr-option" disabled={saving} onClick={() => pick({ kind: 'custom', blank: false })}>
              <b>Save “{suggestion.name}” as your own</b>
              <span className="xr-option-sub">You can rename it on the next step and reuse it later</span>
            </button>
          </div>
        )}

        <div className="xr-manual">
          <button className="ghost-btn" disabled={saving} aria-expanded={browsing}
            onClick={() => setBrowsing((b) => !b)}>
            {browsing ? 'Hide catalog' : suggestion?.primaryCategory ? `Browse similar ${CATEGORY_LABELS[suggestion.primaryCategory].toLowerCase()}` : '☰ Browse my exercises'}
          </button>
          <button className="ghost-btn" disabled={saving} onClick={() => pick({ kind: 'custom', blank: true })}>
            ✎ Add one manually
          </button>
        </div>

        {browsing && (
          <div className="xr-browse">
            <div className="field">
              <label htmlFor="xr-search">Search your exercises</label>
              <input id="xr-search" className="text-in" type="search" value={query} maxLength={60}
                placeholder="chest press" disabled={saving}
                onChange={(e) => setQuery(e.target.value)} />
            </div>
            <div className="seg" role="group" aria-label="Filter by activity type">
              {(['all', ...ACTIVITY_CATEGORIES] as const).map((c) => (
                <button key={c} className={filter === c ? 'on' : ''} aria-pressed={filter === c}
                  disabled={saving} onClick={() => setFilter(c)}>
                  {c === 'all' ? 'All' : CATEGORY_LABELS[c]}
                </button>
              ))}
            </div>
            {browseList.length === 0 ? (
              <p className="small xr-note">Nothing matches — clear the search, or add it manually.</p>
            ) : (
              <div className="xr-list">
                {browseList.map((ex) => (
                  <button key={ex.id} className="xr-option" disabled={saving}
                    onClick={() => pick({ kind: 'existing', exercise: ex })}>
                    <b>{ex.name}</b>
                    <span className="xr-option-sub">{ex.muscleGroups.join(' · ') || 'No muscles saved'}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {error && <span className="small xr-error" role="alert">{error}</span>}
      </div>
    )
  }

  // ---------- reviewing & editing ----------
  const existing = choice.kind === 'existing' ? choice.exercise : null
  const name = form.name.trim()
  const rolesLocked = !!form.legacyRoles && !form.rolesTouched
  const muscleGroups = rolesLocked
    ? form.legacyRoles!
    : inMuscleOrder([...form.primary, ...form.supporting, ...(form.legacyRoles ?? [])])
  const duplicate = catalog.find((ex) => ex.id !== existing?.id && exerciseNames(ex).includes(exerciseNameKey(name)))
  const ready = !duplicate && !!name && !!form.equipment && !!form.primaryCategory && !!form.format && !saving

  const toggleCategory = (c: ActivityCategory) => {
    const on = form.categories.includes(c)
    const categories = on ? form.categories.filter((x) => x !== c) : [...form.categories, c]
    const primaryCategory = categories.includes(form.primaryCategory as ActivityCategory)
      ? form.primaryCategory
      : categories[0] ?? ''
    // a fresh category suggests its usual format until the user picks one
    const format = !form.formatTouched && primaryCategory
      ? CATEGORY_FORMAT[primaryCategory as ActivityCategory]
      : form.format
    edit({ categories, primaryCategory, format })
  }
  const setPrimaryCategory = (c: ActivityCategory) => edit({
    primaryCategory: c,
    categories: form.categories.includes(c) ? form.categories : [...form.categories, c],
    format: form.formatTouched ? form.format : CATEGORY_FORMAT[c],
  })
  /** A muscle has one role at a time — picking a side drops it from the other. */
  const toggleMuscle = (m: MuscleGroup, role: 'primary' | 'supporting') => {
    const from = role === 'primary' ? form.primary : form.supporting
    const other = role === 'primary' ? form.supporting : form.primary
    const next = from.includes(m) ? from.filter((x) => x !== m) : inMuscleOrder([...from, m])
    const cleaned = other.filter((x) => x !== m)
    const legacyRoles = form.legacyRoles?.filter((x) => x !== m) ?? null
    edit(role === 'primary'
      ? { primary: next, supporting: cleaned, legacyRoles, rolesTouched: true }
      : { supporting: next, primary: cleaned, legacyRoles, rolesTouched: true })
  }

  const confirm = () => {
    if (!ready) return
    onConfirm({
      ...(existing ? { id: existing.id } : {}),
      name,
      equipment: form.equipment as EquipmentKind,
      muscleGroups,
      categories: form.categories,
      primaryCategory: form.primaryCategory as ActivityCategory,
      // untouched legacy records keep "roles not assigned" rather than gaining a guess
      ...(rolesLocked ? {} : { primaryMuscles: form.primary, supportingMuscles: form.supporting }),
      recordingFormat: form.format as RecordingFormat,
      ...(existing ? { aliases: existing.aliases } : {}),
      ...(existing ? { custom: existing.custom } : { custom: true }),
    })
  }

  return (
    <div className="xr" aria-live="polite">
      <div className="row">
        <span className="lab lm">{existing ? 'Check and log' : 'Check and save'}</span>
        <button className="back-link" style={{ margin: 0 }} disabled={saving} onClick={backToPicks}>Change</button>
      </div>

      {suggestion && <div className="xr-badges">
        <span className="chip">{EQUIPMENT_READ[suggestion.confidence]}</span>
        <span className="chip">{FIT_LABELS[suggestion.matchKind]}</span>
      </div>}
      <div className="field">
        <label htmlFor="xr-name">Exercise name</label>
        <input id="xr-name" className="text-in" value={form.name} maxLength={80} disabled={saving}
          placeholder="Seated chest press"
          onChange={(e) => edit({ name: e.target.value })} />
        {existing && <span className="small">Editing your saved exercise — it keeps its history.</span>}
        {duplicate && <div role="status">
          <p className="small">“{duplicate.name}” already exists. Reuse it to keep your history together.</p>
          <button className="ghost-btn" disabled={saving} onClick={() => pick({ kind: 'existing', exercise: duplicate })}>Use existing exercise</button>
        </div>}
      </div>

      <div className="field">
        <label id="xr-cats">Activity type — pick all that fit</label>
        <div className="xr-chips" role="group" aria-labelledby="xr-cats">
          {ACTIVITY_CATEGORIES.map((c) => (
            <button key={c} className={`chip btn${form.categories.includes(c) ? ' solid' : ''}`}
              aria-pressed={form.categories.includes(c)} disabled={saving} onClick={() => toggleCategory(c)}>
              {CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>
        {form.categories.length > 1 && (
          <div className="seg" role="group" aria-label="Main activity type">
            {form.categories.map((c) => (
              <button key={c} className={form.primaryCategory === c ? 'on' : ''}
                aria-pressed={form.primaryCategory === c} disabled={saving}
                onClick={() => setPrimaryCategory(c)}>
                Mainly {CATEGORY_LABELS[c].toLowerCase()}
              </button>
            ))}
          </div>
        )}
        {!form.primaryCategory && (
          <span className="small xr-ask">What kind of activity is this? Pick one to continue.</span>
        )}
      </div>

      <div className="field">
        <label id="xr-format">How you record it</label>
        <div className="seg" role="group" aria-labelledby="xr-format">
          {RECORDING_FORMATS.map((f) => (
            <button key={f} className={form.format === f ? 'on' : ''} aria-pressed={form.format === f}
              disabled={saving} onClick={() => edit({ format: f, formatTouched: true })}>
              {FORMAT_LABELS[f]}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label id="xr-equip">Equipment</label>
        <div className="seg" role="group" aria-labelledby="xr-equip">
          {EQUIPMENT_KINDS.map((e) => (
            <button key={e} className={form.equipment === e ? 'on' : ''} aria-pressed={form.equipment === e}
              disabled={saving} onClick={() => edit({ equipment: e })}>
              {EQUIPMENT_LABELS[e]}
            </button>
          ))}
        </div>
        {!form.equipment && <span className="small xr-ask">Pick the equipment to continue.</span>}
      </div>

      {rolesLocked ? (
        <div className="field">
          <label>Muscles</label>
          <div className="xr-chips">
            {form.legacyRoles!.length
              ? form.legacyRoles!.map((m) => <span key={m} className="chip xr-cap">{m}</span>)
              : <span className="small">None saved.</span>}
          </div>
          <span className="small">Involved — roles not assigned.</span>
          <button className="ghost-btn xr-inline-btn" disabled={saving}
            onClick={() => edit({ rolesTouched: true })}>
            Assign main and supporting
          </button>
        </div>
      ) : (
        <>
          {!!form.legacyRoles?.length && <div className="field">
            <label>Involved — roles not assigned</label>
            <p className="small">Choose a main or supporting role below, or remove an area that does not fit.</p>
            <div className="xr-chips">{form.legacyRoles.map((m) => <button key={m} className="chip btn xr-cap" disabled={saving}
              aria-label={`Remove unassigned ${m}`} onClick={() => edit({ legacyRoles: form.legacyRoles!.filter((x) => x !== m) })}>{m} ×</button>)}</div>
          </div>}
          <div className="field">
            <label id="xr-primary">Main muscles — optional</label>
            <div className="xr-chips" role="group" aria-labelledby="xr-primary">
              {MUSCLE_GROUPS.map((m) => (
                <button key={m} className={`chip btn xr-cap${form.primary.includes(m) ? ' solid' : ''}`}
                  aria-pressed={form.primary.includes(m)} disabled={saving}
                  onClick={() => toggleMuscle(m, 'primary')}>
                  {m}
                </button>
              ))}
            </div>
            {!existing && suggestion && suggestion.scanMuscles.length > 0
              && form.primary.length === 0 && form.supporting.length === 0 && (
              <span className="small">From the scan: {suggestion.scanMuscles.join(', ')} — tap the ones that fit.</span>
            )}
          </div>
          <div className="field">
            <button className="xr-disclose" aria-expanded={showSupporting} disabled={saving}
              onClick={() => setShowSupporting((s) => !s)}>
              <span className="lab">Supporting muscles — optional</span>
              <span className="chev">{showSupporting ? '–' : '+'}</span>
            </button>
            {form.supporting.length > 0 && !showSupporting && (
              <span className="small xr-cap">{form.supporting.join(' · ')}</span>
            )}
            {showSupporting && (
              <div className="xr-chips" role="group" aria-label="Supporting muscles">
                {MUSCLE_GROUPS.map((m) => (
                  <button key={m} className={`chip btn xr-cap${form.supporting.includes(m) ? ' solid' : ''}`}
                    aria-pressed={form.supporting.includes(m)} disabled={saving}
                    onClick={() => toggleMuscle(m, 'supporting')}>
                    {m}
                  </button>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <p className="small xr-next">
        This only confirms what you are doing — nothing is saved until you tap below.
        Next you enter your time or reps.
      </p>

      {error && <span className="small xr-error" role="alert">{error}</span>}

      <button className="big-btn" disabled={!ready} onClick={confirm}>
        {saving ? 'Saving…' : 'Confirm & continue →'}
      </button>
      <button className="ghost-btn xr-inline-btn" disabled={saving} onClick={backToPicks}>Pick something else</button>

      {existing?.custom && onDelete && (
        <button className="ghost-btn danger xr-inline-btn" disabled={saving}
          onClick={() => (armDelete ? onDelete(existing) : setArmDelete(true))}>
          {armDelete ? 'Tap again to delete it' : 'Delete this custom exercise'}
        </button>
      )}
    </div>
  )
}
