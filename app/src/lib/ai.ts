import { useEffect, useState } from 'react'
import { normalizeQrUrl } from '../data/qr'
import type { AiProgram, Exercise, GymMachine, MachineAiInfo, MealSlot, MuscleGroup, PrevPerformance, Settings, StrengthBaseline } from '../types'

/**
 * Direct client for a self-hosted CLIProxyAPI (OpenAI-compatible) endpoint.
 * The proxy is only reachable inside the user's tailnet, so the endpoint, key
 * and model live in Settings and calls go straight from the device — no server
 * hop. `useAiAvailable` drives the gray-out state of every AI button.
 */

export interface AiConfig {
  endpoint: string
  apiKey?: string
  model?: string
}

const DEFAULT_MODEL = 'gemini-2.5-flash'
const MEALS: MealSlot[] = ['breakfast', 'lunch', 'dinner', 'snack']
const MUSCLES: MuscleGroup[] = ['chest', 'back', 'shoulders', 'biceps', 'triceps', 'quads', 'hamstrings', 'glutes', 'calves', 'core', 'hips']

export function aiConfig(settings: Settings): AiConfig | null {
  const endpoint = settings.aiEndpoint?.trim().replace(/\/+$/, '')
  if (!endpoint) return null
  return {
    endpoint,
    apiKey: settings.aiApiKey?.trim() || undefined,
    model: settings.aiModel?.trim() || undefined,
  }
}

function headers(config: AiConfig, json: boolean): Record<string, string> {
  return {
    ...(json ? { 'Content-Type': 'application/json' } : {}),
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
  }
}

// ---------- reachability (drives grayed-out AI buttons) ----------

/** One probe result shared app-wide; keyed on endpoint+key so edits re-probe. */
let probeCache: { key: string; ok: boolean; at: number } | null = null
const PROBE_TTL_MS = 60_000

/** Cheap reachability check; also used by Settings "Test & save". */
export async function probeAi(config: AiConfig): Promise<boolean> {
  const key = `${config.endpoint}|${config.apiKey ?? ''}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2500)
  let ok = false
  try {
    const res = await fetch(`${config.endpoint}/v1/models`, { headers: headers(config, false), signal: controller.signal })
    ok = res.ok
  } catch {
    ok = false
  } finally {
    clearTimeout(timer)
  }
  probeCache = { key, ok, at: Date.now() }
  return ok
}

export interface AiAvailability {
  /** an endpoint is set in Settings */
  configured: boolean
  /** the proxy answered the last probe — safe to enable AI buttons */
  available: boolean
}

/** Reachability of the configured proxy: probes on mount/focus, cached 60s, flips on online/offline. */
export function useAiAvailable(settings: Settings): AiAvailability {
  const endpoint = settings.aiEndpoint?.trim().replace(/\/+$/, '') ?? ''
  const apiKey = settings.aiApiKey?.trim() ?? ''
  const key = endpoint ? `${endpoint}|${apiKey}` : ''
  const [available, setAvailable] = useState(() => probeCache?.key === key && probeCache.ok)

  useEffect(() => {
    if (!key) {
      setAvailable(false)
      return
    }
    const config: AiConfig = { endpoint, apiKey: apiKey || undefined }
    let alive = true
    const check = async (force = false) => {
      if (!navigator.onLine) { if (alive) setAvailable(false); return }
      if (!force && probeCache?.key === key && Date.now() - probeCache.at < PROBE_TTL_MS) {
        if (alive) setAvailable(probeCache.ok)
        return
      }
      const ok = await probeAi(config)
      if (alive) setAvailable(ok)
    }
    void check()
    const onOnline = () => void check(true)
    const onOffline = () => setAvailable(false)
    const onVisible = () => { if (document.visibilityState === 'visible') void check() }
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      alive = false
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [key])

  return { configured: !!key, available: !!key && available }
}

// ---------- proxy call ----------

async function callProxy(config: AiConfig, system: string, user: string): Promise<unknown> {
  const body = JSON.stringify({
    model: config.model || DEFAULT_MODEL,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    temperature: 0.2,
    response_format: { type: 'json_object' },
  })

  const attempt = async (): Promise<unknown> => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 30_000)
    try {
      const res = await fetch(`${config.endpoint}/v1/chat/completions`, {
        method: 'POST',
        headers: headers(config, true),
        body,
        signal: controller.signal,
      })
      if (!res.ok) {
        const err = new Error(res.status === 401 || res.status === 403
          ? 'AI proxy rejected the API key — check it in Settings.'
          : `AI proxy error (${res.status}).`)
        ;(err as { status?: number }).status = res.status
        throw err
      }
      const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> }
      const content = data.choices?.[0]?.message?.content
      if (typeof content !== 'string' || !content.trim()) throw new Error('AI returned an empty response.')
      // some models fence JSON in markdown despite response_format
      return JSON.parse(content.trim().replace(/^```(?:json)?\s*|\s*```$/g, ''))
    } finally {
      clearTimeout(timer)
    }
  }

  try {
    return await attempt()
  } catch (err) {
    const status = (err as { status?: number }).status
    const network = err instanceof TypeError || (err as Error).name === 'AbortError'
    if (network || (status !== undefined && status >= 500)) return attempt() // single retry
    throw err
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

const FOOD_SYSTEM = `You are the nutrition assistant of a gym tracking app. The user describes food they ate in plain language (any language). Split the description into distinct items and estimate macros for realistic serving sizes.
Reply with ONLY this JSON, no prose:
{"items":[{"name":"short label, capitalized, include quantity","calories":0,"protein":0,"carbs":0,"fat":0,"meal":"breakfast|lunch|dinner|snack"}]}
calories in kcal, protein/carbs/fat in grams, all integers. Include "meal" only when the text implies it. At most 12 items.`

export async function parseFood(config: AiConfig, text: string): Promise<AiFoodItem[]> {
  const raw = await callProxy(config, FOOD_SYSTEM, text.trim()) as { items?: unknown }
  const list = Array.isArray(raw.items) ? raw.items : []
  const items: AiFoodItem[] = []
  for (const entry of list.slice(0, 12)) {
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
  if (!items.length) throw new Error("Couldn't read any food from that — try rephrasing.")
  return items
}

// ---------- machine identification ----------

const MACHINE_SYSTEM = `You identify gym machines from the URL on their QR sticker (often Life Fitness lfconnect.com links where the "m" query param is the machine model code, or a YouTube instruction video). Use the URL, the normalized code, and your knowledge of gym equipment.
Reply with ONLY this JSON, no prose:
{"identified":true,"manufacturer":"","modelName":"","confidence":"high|medium|low","muscleGroups":[],"exerciseId":"","setupTips":"one short sentence","howTo":["3-5 short form cues"]}
muscleGroups is a subset of: ${MUSCLES.join(', ')}. exerciseId must be the id of the best-matching exercise from the provided list, or "" if none fits. If you cannot identify the machine set identified:false and confidence:"low".`

// ---------- starter program recommendation ----------

const GOAL_LABELS: Record<NonNullable<Settings['goal']>, string> = {
  'muscle': 'build muscle',
  'recomp': 'body recomposition — build muscle while losing fat for visible abs',
  'fat-loss': 'lose fat',
  'strength': 'get stronger',
  'general': 'general fitness',
}

const PROGRAM_SYSTEM = `You are a friendly coach inside a gym tracking app, writing a starter program for ONE machine. Assume the user is a complete beginner unless the profile says otherwise: prefer 10-15 reps, conservative starts, and plain words a first-timer understands (no jargon).
startWeightLb is a rough guess for a typical machine of this type (round to 5); machine stacks vary by brand, so the effortCheck sentence must let the user self-correct. If previous sets are provided, base everything on those real numbers instead of guessing. reportedWorkingWeight is a weight the user says they can do for that many reps on this machine — treat it as real data too (previous sets win when both are present). Its weeksAgo says how old that report is: strength grows with training, so a report 4+ weeks old is a floor, not a ceiling — lean slightly heavier. Respect any limitations with a caution. Match reps/rest to the goal (muscle/recomp: 10-12 reps, 60-90s rest; strength: 6-8 reps, 120-180s; fat loss/general: 12-15 reps, 45-75s).
Reply with ONLY this JSON, no prose:
{"sets":3,"reps":12,"startWeightLb":90,"restSeconds":75,"effortCheck":"one sentence: how the right weight should feel and what to do if it's off","progression":"one or two sentences: exactly when and how much to add","warmup":"one short sentence","cautions":"one short sentence, only if limitations warrant it, else empty string"}`

export interface ProgramInput {
  machine: GymMachine
  exercise: Exercise
  machineAi?: MachineAiInfo | null
  settings: Settings
  prev?: PrevPerformance
  /** self-reported "weight I can do"; used when there is no logged history */
  baseline?: StrengthBaseline
}

export async function recommendProgram(config: AiConfig, input: ProgramInput): Promise<AiProgram> {
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
  const raw = await callProxy(config, PROGRAM_SYSTEM, JSON.stringify({
    machine: [machineAi?.manufacturer, machineAi?.modelName].filter(Boolean).join(' ') || machine.nickname,
    exercise: { name: exercise.name, muscleGroups: exercise.muscleGroups, equipment: exercise.equipment },
    profile,
    previousSets: prev?.sets,
    reportedWorkingWeight: baseline
      ? { weightLb: baseline.weightLb, reps: baseline.reps, weeksAgo: Math.max(0, Math.round((Date.now() - baseline.at) / 604_800_000)) }
      : undefined,
  })) as Record<string, unknown>

  const text = (value: unknown, max: number) => typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined
  const sets = int(raw.sets, 6) || 3
  const reps = int(raw.reps, 30) || 12
  const startWeightLb = int(raw.startWeightLb, 1000)
  return {
    id: machine.id,
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

export async function fetchMachineInfo(config: AiConfig, qrUrl: string, exercises: Exercise[]): Promise<MachineAiInfo> {
  const key = normalizeQrUrl(qrUrl)
  const catalog = exercises.map((exercise) => ({ id: exercise.id, name: exercise.name }))
  const raw = await callProxy(
    config,
    MACHINE_SYSTEM,
    `QR url: ${qrUrl}\nNormalized code: ${key}\nExercise list: ${JSON.stringify(catalog)}`,
  ) as Record<string, unknown>

  const confidence = raw.confidence === 'high' || raw.confidence === 'medium' ? raw.confidence : 'low'
  const muscleGroups = (Array.isArray(raw.muscleGroups) ? raw.muscleGroups : [])
    .filter((group): group is MuscleGroup => MUSCLES.includes(group as MuscleGroup))
  const exerciseId = typeof raw.exerciseId === 'string' && exercises.some((exercise) => exercise.id === raw.exerciseId)
    ? raw.exerciseId
    : undefined
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
    setupTips: text(raw.setupTips, 200),
    howTo: (Array.isArray(raw.howTo) ? raw.howTo : [])
      .filter((cue): cue is string => typeof cue === 'string' && !!cue.trim())
      .map((cue) => cue.trim().slice(0, 120))
      .slice(0, 6),
    createdAt: Date.now(),
  }
}
