import { useEffect, useState } from 'react'
import { normalizeQrUrl } from '../data/qr'
import type { ActivityCategory, EquipmentKind, RecordingFormat, AiProgram, Exercise, GymMachine, MachineAiInfo, MealSlot, MuscleGroup, Settings, StrengthBaseline, PrevPerformance } from '../types'
import { ACTIVITY_CATEGORIES, RECORDING_FORMATS, aiProgramId } from '../types'
import { AI_MUSCLES, buildAiPrompt, claudeMessages, parseAiJson, type AiFollowup, type AiPrompt, type AiRequest } from './ai-prompts'
import { householdAiPossible, householdStatus, runHouseholdAi, type HouseholdAiStatus } from './household-ai'

/**
 * AI comes from one of two places, chosen per person in Settings:
 * - household: the server's Anthropic key, metered and capped (convex/ai.ts);
 * - own: the person's own key, called straight from the device — Anthropic,
 *   OpenAI, or any OpenAI-compatible endpoint such as a tailnet-only CLIProxyAPI.
 * Prompts are identical either way (ai-prompts.ts). `useAiAvailable` drives the
 * shared connection indicator.
 */

export type AiProvider = 'anthropic' | 'openai' | 'custom'

export type AiConfig =
  | { source: 'household' }
  | { source: 'own'; provider: AiProvider; endpoint: string; apiKey?: string; model?: string; fallback: boolean }

export const DEFAULT_MODELS: Record<AiProvider, string> = {
  anthropic: 'claude-haiku-5-5',
  openai: 'gpt-6-luna',
  custom: 'gpt-5.6-luna',
}
const OPENAI_ENDPOINT = 'https://api.openai.com'
const MEALS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack']
const MUSCLES: MuscleGroup[] = [...AI_MUSCLES]

/** An endpoint saved before the household option existed keeps meaning "my own key". */
export function aiSourceOf(settings: Settings): 'household' | 'own' {
  return settings.aiSource ?? (settings.aiEndpoint?.trim() ? 'own' : 'household')
}

export function normalizeEndpoint(raw: string | undefined): string {
  let endpoint = raw?.trim().replace(/\/+$/, '') ?? ''
  if (!endpoint) return ''
  if (!/^https?:\/\//i.test(endpoint)) endpoint = `https://${endpoint}`
  return endpoint.replace(/\/v1$/, '')
}

/**
 * Household fallback is on for anyone who picks "your own key" now, but off for
 * people migrated from the old endpoint-only setup until they opt in, so their
 * AI never starts spending the household budget unasked.
 */
export function fallbackPreference(settings: Settings): boolean {
  return settings.aiFallback ?? settings.aiSource !== undefined
}

export function aiConfig(settings: Settings): AiConfig | null {
  if (aiSourceOf(settings) === 'household') return householdAiPossible ? { source: 'household' } : null
  const provider = settings.aiProvider ?? 'custom'
  const apiKey = settings.aiApiKey?.trim() || undefined
  const endpoint = provider === 'custom' ? normalizeEndpoint(settings.aiEndpoint) : provider === 'openai' ? OPENAI_ENDPOINT : ''
  if (provider === 'custom' ? !endpoint : !apiKey) return null
  return {
    source: 'own', provider, endpoint, apiKey,
    model: settings.aiModel?.trim() || undefined,
    fallback: householdAiPossible && fallbackPreference(settings),
  }
}

type OwnConfig = Extract<AiConfig, { source: 'own' }>

async function anthropicClient(config: OwnConfig, timeout: number) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  return { Anthropic, client: new Anthropic({ apiKey: config.apiKey, dangerouslyAllowBrowser: true, maxRetries: 0, timeout }) }
}

function openAiHeaders(config: OwnConfig, json: boolean): Record<string, string> {
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
  }
}

// ---------- connection status ----------

/** Cheap reachability check for an own key; also used by Settings "Test & save". */
export async function probeAi(config: OwnConfig): Promise<boolean> {
  try {
    if (config.provider === 'anthropic') {
      const { client } = await anthropicClient(config, 4000)
      await client.models.list({ limit: 1 })
      return true
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 2500)
    try {
      const res = await fetch(`${config.endpoint}/v1/models`, { headers: openAiHeaders(config, false), signal: controller.signal })
      return res.ok
    } finally {
      clearTimeout(timer)
    }
  } catch {
    return false
  }
}

export interface AiAvailability {
  configured: boolean
  available: boolean
  checking: boolean
  status: 'unconfigured' | 'checking' | 'ready' | 'unavailable'
  source: 'household' | 'own'
  /** own key unreachable, household AI standing in */
  viaFallback: boolean
  /** plain-words reason when unavailable (or a fallback note) */
  message?: string
  household?: HouseholdAiStatus
  recheck: () => void
}

type Check = Pick<AiAvailability, 'status' | 'viaFallback' | 'message' | 'household'>

/** One result per config shared app-wide, so every AI screen agrees without re-probing. */
const checkCache = new Map<string, { at: number; result: Check }>()
/** last known result per config, kept across forgetAiStatus so re-checks don't flash "checking" */
const lastResult = new Map<string, Check>()
const inflight = new Map<string, Promise<Check>>()
const CHECK_TTL_MS = 60_000
const statusListeners = new Set<() => void>()

/** Spend or settings changed: drop cached results and have every mounted AI screen re-check. */
export function forgetAiStatus() {
  checkCache.clear()
  for (const listener of statusListeners) listener()
}

/** Concurrent screens share one check per config instead of each probing. */
function checkShared(key: string, config: AiConfig): Promise<Check> {
  let pending = inflight.get(key)
  if (!pending) {
    pending = checkAi(config).then((result) => {
      checkCache.set(key, { at: Date.now(), result })
      lastResult.set(key, result)
      return result
    }).finally(() => inflight.delete(key))
    inflight.set(key, pending)
  }
  return pending
}

async function checkHousehold(): Promise<Check> {
  try {
    const household = await householdStatus()
    return household.available
      ? { status: 'ready', viaFallback: false, household }
      : { status: 'unavailable', viaFallback: false, household, message: household.message ?? undefined }
  } catch (error) {
    return { status: 'unavailable', viaFallback: false, message: error instanceof Error ? error.message : 'Could not reach household AI.' }
  }
}

async function checkAi(config: AiConfig): Promise<Check> {
  if (config.source === 'household') return checkHousehold()
  if (await probeAi(config)) return { status: 'ready', viaFallback: false }
  if (config.fallback) {
    const household = await checkHousehold()
    if (household.status === 'ready') return { ...household, viaFallback: true, message: 'Your own key isn’t reachable right now, so household AI is standing in.' }
  }
  return {
    status: 'unavailable', viaFallback: false,
    message: config.provider === 'custom'
      ? 'Can’t reach your AI endpoint. Check your connection or Tailscale. You can still enter everything by hand.'
      : 'Can’t reach your AI provider with this key. Check the key in Settings. You can still enter everything by hand.',
  }
}

const configKey = (config: AiConfig | null) => !config ? '' : config.source === 'household'
  ? 'household'
  : `${config.provider}|${config.endpoint}|${config.apiKey ?? ''}|${config.fallback}`

export function useAiAvailable(settings: Settings): AiAvailability {
  const config = aiConfig(settings)
  const key = configKey(config)
  const source = aiSourceOf(settings)
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState<{ key: string; check: Check }>({ key: '', check: { status: 'unconfigured', viaFallback: false } })
  useEffect(() => {
    if (!config) { setState({ key, check: { status: 'unconfigured', viaFallback: false } }); return }
    let alive = true
    const offline: Check = { status: 'unavailable', viaFallback: false, message: 'You’re offline. AI needs a connection. You can still enter everything by hand.' }
    const check = async (force = false) => {
      if (!navigator.onLine) { if (alive) setState({ key, check: offline }); return }
      const cached = checkCache.get(key)
      if (!force && cached && Date.now() - cached.at < CHECK_TTL_MS) {
        if (alive) setState({ key, check: cached.result })
        return
      }
      // keep showing the last result while a background re-check runs, so screens don't flicker
      if (alive) setState({ key, check: lastResult.get(key) ?? { status: 'checking', viaFallback: false } })
      const result = await checkShared(key, config)
      if (alive) setState({ key, check: navigator.onLine ? result : offline })
    }
    void check(attempt > 0)
    const onForget = () => void check()
    statusListeners.add(onForget)
    const onOnline = () => void check(true)
    const onOffline = () => setState({ key, check: offline })
    const onVisible = () => { if (document.visibilityState === 'visible') void check() }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      statusListeners.delete(onForget)
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVisible)
    }
    // config is derived from key
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, attempt])
  const check: Check = state.key === key ? state.check : { status: config ? 'checking' : 'unconfigured', viaFallback: false }
  return {
    ...check,
    configured: !!config,
    available: check.status === 'ready',
    checking: check.status === 'checking',
    source,
    recheck: () => setAttempt((n) => n + 1),
  }
}

// ---------- calls ----------

export interface AiRequestOptions {
  signal?: AbortSignal
  onRetry?: () => void
  /** own key failed to connect and household AI is taking over */
  onFallback?: () => void
}

/** A failure worth retrying, or handing to household AI: the request never got a real answer. */
class UnreachableError extends Error {}

function readJson(text: string): unknown {
  try { return parseAiJson(text) }
  catch { throw new Error('AI sent an unreadable response. Try again or enter the details by hand.') }
}

async function ownAnthropic(config: OwnConfig, prompt: AiPrompt, signal: AbortSignal): Promise<string> {
  const { Anthropic, client } = await anthropicClient(config, 60_000)
  try {
    const response = await client.messages.create({
      model: config.model || DEFAULT_MODELS.anthropic,
      max_tokens: 10_000,
      system: prompt.system,
      messages: claudeMessages(prompt),
    }, { signal })
    if (response.stop_reason === 'refusal') throw new Error('AI declined this one. Try rephrasing, or enter it by hand.')
    if (response.stop_reason === 'max_tokens') throw new Error('AI’s answer was cut off. Try again.')
    const text = response.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('').trim()
    if (!text) throw new Error('AI returned an empty response.')
    return text
  } catch (error) {
    if (error instanceof Anthropic.APIUserAbortError) throw new UnreachableError('AI took too long to respond. Your draft is safe. Try again.')
    if (error instanceof Anthropic.APIConnectionError) throw new UnreachableError('Could not reach Anthropic. Check your connection, then try again.')
    if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) throw new Error('Anthropic rejected your API key — check it in Settings.')
    if (error instanceof Anthropic.RateLimitError) throw new Error('Your Anthropic key is rate limited right now. Try again in a minute.')
    if (error instanceof Anthropic.APIError && (error.status ?? 0) >= 500) throw new UnreachableError(`Anthropic had a problem (${error.status}). Try again.`)
    if (error instanceof Anthropic.APIError) throw new Error(`Anthropic couldn’t run this request (${error.status}). Check the model name in Settings.`)
    throw error
  }
}

/** OpenAI-compatible multimodal message part; plain strings stay valid for text-only calls. */
type OpenAiPart = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } }

async function ownOpenAi(config: OwnConfig, prompt: AiPrompt, signal: AbortSignal): Promise<string> {
  const user = typeof prompt.user === 'string' ? prompt.user : prompt.user.map((part): OpenAiPart =>
    part.type === 'text' ? part : { type: 'image_url', image_url: { url: part.dataUrl } })
  const body = JSON.stringify({
    model: config.model || DEFAULT_MODELS[config.provider],
    messages: [{ role: 'system', content: prompt.system }, { role: 'user', content: user }, ...prompt.history],
    // OpenAI's reasoning models only accept the default temperature
    ...(config.provider === 'custom' ? { temperature: 0.2 } : {}),
    response_format: { type: 'json_object' },
  })
  let res: Response
  try {
    res = await fetch(`${config.endpoint}/v1/chat/completions`, { method: 'POST', headers: openAiHeaders(config, true), body, signal })
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw new UnreachableError('AI took too long to respond. Your draft is safe. Try again.')
    throw new UnreachableError(config.provider === 'custom'
      ? 'Could not reach AI. Check your connection or Tailscale, then try again.'
      : 'Could not reach OpenAI. Check your connection, then try again.')
  }
  if (res.status >= 500) throw new UnreachableError(`AI proxy error (${res.status}).`)
  if (!res.ok) throw new Error(res.status === 401 || res.status === 403 ? 'AI rejected the API key — check it in Settings.' : `AI proxy error (${res.status}).`)
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
  const content = data.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) throw new Error('AI returned an empty response.')
  return content
}

async function runOwn(config: OwnConfig, prompt: AiPrompt, options: AiRequestOptions): Promise<string> {
  const attempt = async () => {
    options.signal?.throwIfAborted()
    const controller = new AbortController()
    const abort = () => controller.abort()
    options.signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(abort, 30_000)
    try {
      return config.provider === 'anthropic'
        ? await ownAnthropic(config, prompt, controller.signal)
        : await ownOpenAi(config, prompt, controller.signal)
    } finally {
      clearTimeout(timer)
      options.signal?.removeEventListener('abort', abort)
    }
  }
  try { return await attempt() }
  catch (error) {
    options.signal?.throwIfAborted()
    if (!(error instanceof UnreachableError)) throw error
    options.onRetry?.()
    return await attempt()
  }
}

async function runHousehold(request: AiRequest, options: AiRequestOptions): Promise<unknown> {
  try { return readJson(await runHouseholdAi(request, options.signal)) }
  finally { forgetAiStatus() }
}

/** Run one AI feature wherever this person's AI lives; returns the model's parsed JSON. */
export async function runAi(config: AiConfig, request: AiRequest, options: AiRequestOptions = {}): Promise<unknown> {
  if (config.source === 'household') return runHousehold(request, options)
  try {
    return readJson(await runOwn(config, buildAiPrompt(request), options))
  } catch (error) {
    options.signal?.throwIfAborted()
    if (!(error instanceof UnreachableError) || !config.fallback) throw error
    options.onFallback?.()
    return runHousehold(request, options)
  }
}

const int = (value: unknown, max: number): number | undefined => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? parseFloat(value) : NaN
  return isFinite(n) ? Math.min(max, Math.max(0, Math.round(n))) : undefined
}

// ---------- food parsing ----------

export interface AiFoodItem {
  name: string
  calories: number
  protein: number
  carbs?: number
  fat?: number
  meal?: MealSlot
}

/** A clarification the model wants before it can estimate well; always answerable in free text too. */
export interface AiFoodQuestion {
  text: string
  options: string[]
}

export interface AiFoodResult {
  items: AiFoodItem[]
  question?: AiFoodQuestion
  /** verbatim assistant reply, replayed as context when the user answers a question */
  raw: string
}

/** What was originally sent, kept around so answers can continue the same conversation. */
export type AiFoodRequest =
  | { kind: 'text'; text: string }
  | { kind: 'photo'; photoDataUrl: string; note?: string }

function toFoodResult(raw: unknown, emptyMessage: string): AiFoodResult {
  const parsed = (raw && typeof raw === 'object' ? raw : {}) as { items?: unknown; question?: unknown }
  const list = Array.isArray(parsed.items) ? parsed.items : []
  const items: AiFoodItem[] = []
  for (const entry of list.slice(0, 12)) {
    if (!entry || typeof entry !== 'object') continue
    const item = entry as Record<string, unknown>
    const name = typeof item.name === 'string' ? item.name.trim().slice(0, 60) : ''
    const calories = int(item.calories, 5000)
    if (!name || calories === undefined) continue
    items.push({
      name,
      calories,
      protein: int(item.protein, 1000) ?? 0,
      carbs: int(item.carbs, 1000),
      fat: int(item.fat, 1000),
      meal: MEALS.includes(item.meal as MealSlot) ? item.meal as MealSlot : undefined,
    })
  }
  let question: AiFoodQuestion | undefined
  const q = parsed.question as Record<string, unknown> | undefined
  if (q && typeof q.text === 'string' && q.text.trim()) {
    question = {
      text: q.text.trim().slice(0, 160),
      options: (Array.isArray(q.options) ? q.options : [])
        .filter((o): o is string => typeof o === 'string' && !!o.trim())
        .map((o) => o.trim().slice(0, 40))
        .slice(0, 4),
    }
  }
  // a question with no items is still useful ("is that food or a menu photo?")
  if (!items.length && !question) throw new Error(emptyMessage)
  return { items, question, raw: JSON.stringify(parsed) }
}

/** The user's answer to a question, or unprompted feedback ("I actually ate 3 of these"). */
export type AiFoodAnswer = AiFollowup

export async function parseFood(config: AiConfig, text: string, followup?: AiFoodAnswer, options?: AiRequestOptions): Promise<AiFoodResult> {
  const raw = await runAi(config, { feature: 'foodText', text: text.trim(), followup }, options)
  return toFoodResult(raw, "Couldn't read any food from that — try rephrasing.")
}

export async function parseFoodPhoto(config: AiConfig, photoDataUrl: string, note?: string, followup?: AiFoodAnswer, options?: AiRequestOptions): Promise<AiFoodResult> {
  const raw = await runAi(config, { feature: 'foodPhoto', photo: photoDataUrl, note: note?.trim() || undefined, followup }, options)
  return toFoodResult(raw, "Couldn't spot any food in that photo — try a clearer shot.")
}

// ---------- exercise photo identification ----------

export interface AiExercisePhotoResult {
  identified: boolean
  name: string
  confidence: 'high' | 'medium' | 'low'
  explanation: string
  muscleGroups: MuscleGroup[]
  exerciseIds: string[]
  howTo: string[]
  categories: ActivityCategory[]
  primaryCategory?: ActivityCategory
  primaryMuscles: MuscleGroup[]
  supportingMuscles: MuscleGroup[]
  recordingFormat?: RecordingFormat
  equipment?: EquipmentKind
  matchKind: 'exact' | 'possible' | 'none'
  matchReasons: Record<string, string>
}

export async function identifyExercisePhoto(
  config: AiConfig,
  photoDataUrl: string,
  exercises: Exercise[],
  note?: string,
  options?: AiRequestOptions,
): Promise<AiExercisePhotoResult> {
  if (!/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(photoDataUrl)) {
    throw new Error('Choose a readable photo before identifying an exercise.')
  }
  const raw = await runAi(config, {
    feature: 'exercisePhoto', photo: photoDataUrl, note: note?.trim() || undefined, exercisesJson: JSON.stringify(exercises),
  }, options)
  return parseExerciseIdentification(raw, exercises)
}

/** Text-only identification works with the configured model without vision support. */
export async function identifyExerciseDescription(
  config: AiConfig,
  description: string,
  exercises: Exercise[],
  options?: AiRequestOptions,
): Promise<AiExercisePhotoResult> {
  const text = description.trim()
  if (!text) throw new Error('Describe the movement or machine first.')
  const raw = await runAi(config, { feature: 'exerciseDescription', description: text, exercisesJson: JSON.stringify(exercises) }, options)
  return parseExerciseIdentification(raw, exercises)
}

function parseExerciseIdentification(raw: unknown, exercises: Exercise[]): AiExercisePhotoResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('AI returned an unreadable result. Please try again.')
  }
  const value = raw as Record<string, unknown>
  if (typeof value.identified !== 'boolean') {
    throw new Error('AI returned an unreadable result. Please try again.')
  }
  const clean = (v: unknown, max: number) => typeof v === 'string' ? v.trim().slice(0, max) : ''
  const validIds = new Set(exercises.map((exercise) => exercise.id))
  const identified = value.identified && !!clean(value.name, 100)
  const pick = <T extends string>(raw: unknown, allowed: readonly T[]): T[] => identified && Array.isArray(raw)
    ? [...new Set(raw.filter((item): item is T => typeof item === 'string' && allowed.includes(item as T)))] : []
  const categories = pick(value.categories, ACTIVITY_CATEGORIES)
  const primaryMuscles = pick(value.primaryMuscles, MUSCLES)
  const supportingMuscles = pick(value.supportingMuscles, MUSCLES).filter((m) => !primaryMuscles.includes(m))
  const exerciseIds = identified && Array.isArray(value.exerciseIds)
    ? [...new Set(value.exerciseIds.filter((id): id is string => typeof id === 'string' && validIds.has(id)))].slice(0, 3) : []
  const reasons = value.matchReasons && typeof value.matchReasons === 'object' ? value.matchReasons as Record<string, unknown> : {}
  return {
    identified,
    categories,
    primaryCategory: categories.includes(value.primaryCategory as ActivityCategory) ? value.primaryCategory as ActivityCategory : categories[0],
    primaryMuscles,
    supportingMuscles,
    recordingFormat: identified && RECORDING_FORMATS.includes(value.recordingFormat as RecordingFormat) ? value.recordingFormat as RecordingFormat : undefined,
    equipment: identified && ['machine', 'cable', 'free', 'bodyweight'].includes(value.equipment as string) ? value.equipment as EquipmentKind : undefined,
    matchKind: !exerciseIds.length ? 'none' : exerciseIds.length === 1 && value.matchKind === 'exact' ? 'exact' : 'possible',
    matchReasons: Object.fromEntries(exerciseIds.map((id) => [id, clean(reasons[id], 160)])),
    name: identified ? clean(value.name, 100) : 'No clear exercise found',
    confidence: identified && (value.confidence === 'high' || value.confidence === 'medium') ? value.confidence : 'low',
    explanation: clean(value.explanation, 500) || (identified
      ? 'Check the suggested exercise before logging.'
      : 'Add details about the equipment, body position, and movement, or try a clearer photo.'),
    muscleGroups: identified && Array.isArray(value.muscleGroups)
      ? [...new Set(value.muscleGroups.filter((m): m is MuscleGroup => MUSCLES.includes(m as MuscleGroup)))] : [],
    exerciseIds,
    howTo: identified && Array.isArray(value.howTo)
      ? value.howTo.map((cue) => clean(cue, 160)).filter(Boolean).slice(0, 4) : [],
  }
}

// ---------- starter program recommendation ----------

const GOAL_LABELS: Record<NonNullable<Settings['goal']>, string> = {
  'muscle': 'build muscle',
  'recomp': 'body recomposition — build muscle while losing fat for visible abs',
  'fat-loss': 'lose fat',
  'strength': 'get stronger',
  'general': 'general fitness',
}

export interface ProgramInput {
  machine: GymMachine
  exercise: Exercise
  machineAi?: MachineAiInfo | null
  settings: Settings
  prev?: PrevPerformance
  /** self-reported "weight I can do"; used when there is no logged history */
  baseline?: StrengthBaseline
  feedback?: string
  previousProgram?: AiProgram | null
}

export async function recommendProgram(config: AiConfig, input: ProgramInput, options?: AiRequestOptions): Promise<AiProgram> {
  const { machine, exercise, machineAi, settings, prev, baseline } = input
  const profile = {
    experience: settings.experience ?? 'new',
    goal: GOAL_LABELS[settings.goal ?? 'general'],
    daysPerWeek: settings.daysPerWeek,
    sessionMinutes: settings.sessionMinutes,
    age: settings.birthYear ? new Date().getFullYear() - settings.birthYear : undefined,
    sex: settings.sex,
    bodyWeightLb: settings.bodyWeightLb,
    heightIn: settings.heightIn,
    limitations: settings.limitations,
  }
  const raw = await runAi(config, { feature: 'program', payloadJson: JSON.stringify({
    machine: [machineAi?.manufacturer, machineAi?.modelName].filter(Boolean).join(' ') || machine.nickname,
    exercise: { name: exercise.name, muscleGroups: exercise.muscleGroups, equipment: exercise.equipment },
    profile,
    userFeedback: input.feedback,
    previousProgram: input.previousProgram,
    previousSets: prev?.sets,
    reportedWorkingWeight: baseline
      ? { weightLb: baseline.weightLb, reps: baseline.reps, weeksAgo: Math.max(0, Math.round((Date.now() - baseline.at) / 604_800_000)) }
      : undefined,
  }) }, options) as Record<string, unknown>

  const text = (value: unknown, max: number) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined
  if (!raw || typeof raw !== 'object' || !int(raw.sets, 6) || !int(raw.reps, 30)) throw new Error('AI did not return a usable program. Try again; your saved program is unchanged.')
  const sets = int(raw.sets, 6) || 3
  const reps = int(raw.reps, 30) || 12
  const startWeightLb = int(raw.startWeightLb, 1000)
  return {
    id: aiProgramId(machine.id, exercise.id),
    exerciseId: exercise.id,
    sets: Math.max(1, sets),
    reps: Math.max(1, reps),
    startWeightLb: startWeightLb || undefined,
    effortCheck: text(raw.effortCheck, 200) ?? 'Pick a weight where the last 2 reps feel hard but doable.',
    restSeconds: Math.min(300, Math.max(15, int(raw.restSeconds, 300) || settings.restSeconds)),
    progression: text(raw.progression, 250) ?? `Got all ${sets}×${reps}? Add a small plate next visit.`,
    warmup: text(raw.warmup, 200),
    cautions: text(raw.cautions, 200),
    createdAt: Date.now(),
  }
}

export async function fetchMachineInfo(config: AiConfig, qrUrl: string, exercises: Exercise[], feedback?: string, options?: AiRequestOptions): Promise<MachineAiInfo> {
  const key = normalizeQrUrl(qrUrl)
  const catalog = exercises.map((exercise) => ({ id: exercise.id, name: exercise.name }))
  const raw = await runAi(config, {
    feature: 'machineInfo', qrUrl, code: key, catalogJson: JSON.stringify(catalog), feedback: feedback || undefined,
  }, options) as Record<string, unknown>

  if (!raw || typeof raw !== 'object' || typeof raw.identified !== 'boolean') throw new Error('AI did not return a usable machine guide. Add more details and try again.')
  const confidence = raw.confidence === 'high' || raw.confidence === 'medium' ? raw.confidence : 'low'
  const muscleGroups = (Array.isArray(raw.muscleGroups) ? raw.muscleGroups : [])
    .filter((group): group is MuscleGroup => MUSCLES.includes(group as MuscleGroup))
  const validExerciseIds = new Set(exercises.map((exercise) => exercise.id))
  const rawExerciseIds = Array.isArray(raw.exerciseIds)
    ? raw.exerciseIds
    : typeof raw.exerciseId === 'string' ? [raw.exerciseId] : []
  const exerciseIds = [...new Set(rawExerciseIds.filter(
    (id): id is string => typeof id === 'string' && validExerciseIds.has(id),
  ))]
  const exerciseId = exerciseIds[0]
  const text = (value: unknown, max: number) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined
  return {
    id: key,
    qrUrl,
    identified: raw.identified === true,
    manufacturer: text(raw.manufacturer, 40),
    modelName: text(raw.modelName, 60),
    confidence,
    muscleGroups,
    exerciseId,
    exerciseIds,
    setupTips: text(raw.setupTips, 200),
    howTo: (Array.isArray(raw.howTo) ? raw.howTo : [])
      .filter((cue): cue is string => typeof cue === 'string' && !!cue.trim())
      .map((cue) => cue.trim().slice(0, 120))
      .slice(0, 6),
    createdAt: Date.now(),
  }
}
