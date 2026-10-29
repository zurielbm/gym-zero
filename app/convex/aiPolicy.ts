import type { AiFeature } from '../src/lib/ai-prompts'

/** Money is tracked in micro-dollars (1 = $0.000001) so sums stay exact integers. */
export const MICROS_PER_USD = 1_000_000

export const HOUSEHOLD_MODEL = 'claude-haiku-5-5'

interface Prices { input: number; output: number; cacheRead: number; cacheWrite: number }

/** Per-token prices in micro-dollars (Anthropic list price per million tokens). */
export const MODEL_PRICES: Record<string, Prices & { longContext?: Prices & { above: number } }> = {
  // Haiku 5.5's list price covers prompts up to 100K tokens; longer prompts cost 5x.
  'claude-haiku-5-5': {
    input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125,
    longContext: { above: 100_000, input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 },
  },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
}

export interface FeatureConfig {
  model: string
  effort: 'low' | 'medium'
  maxTokens: number
  /** reserved before the call so parallel requests can't overshoot a cap */
  estimateMicros: number
}

export const FEATURES: Record<AiFeature, FeatureConfig> = {
  foodText: { model: HOUSEHOLD_MODEL, effort: 'low', maxTokens: 4000, estimateMicros: 1_000 },
  foodPhoto: { model: HOUSEHOLD_MODEL, effort: 'low', maxTokens: 4000, estimateMicros: 2_000 },
  exercisePhoto: { model: HOUSEHOLD_MODEL, effort: 'medium', maxTokens: 6000, estimateMicros: 4_000 },
  exerciseDescription: { model: HOUSEHOLD_MODEL, effort: 'low', maxTokens: 4000, estimateMicros: 2_000 },
  machineInfo: { model: HOUSEHOLD_MODEL, effort: 'low', maxTokens: 4000, estimateMicros: 2_000 },
  program: { model: HOUSEHOLD_MODEL, effort: 'medium', maxTokens: 4000, estimateMicros: 3_000 },
  workoutReview: { model: HOUSEHOLD_MODEL, effort: 'medium', maxTokens: 10000, estimateMicros: 8_000 },
}

/** Burst limits: stop a stuck button or a loop long before money matters. */
export const RATE_WINDOW_MS = 10 * 60_000
export const RATE_MAX_CALLS = 15
export const PHOTO_WINDOW_MS = 24 * 60 * 60_000
export const PHOTO_MAX_CALLS = 40

export const DEFAULT_USER_MONTHLY_USD = 1
export const DEFAULT_GLOBAL_MONTHLY_USD = 20

export interface TokenUsage {
  input_tokens?: number | null
  output_tokens?: number | null
  cache_read_input_tokens?: number | null
  cache_creation_input_tokens?: number | null
}

export function costMicros(model: string, usage: TokenUsage): number {
  const base = MODEL_PRICES[model] ?? MODEL_PRICES['claude-sonnet-5-5']
  const prompt = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0)
  const price = base.longContext && prompt > base.longContext.above ? base.longContext : base
  return Math.ceil(
    (usage.input_tokens ?? 0) * price.input
    + (usage.output_tokens ?? 0) * price.output
    + (usage.cache_read_input_tokens ?? 0) * price.cacheRead
    + (usage.cache_creation_input_tokens ?? 0) * price.cacheWrite,
  )
}

/**
 * What to reserve before a call: the feature's floor, or more for big inputs
 * (about 3 characters per token of text; photos are billed far below their
 * base64 length, so they're left out).
 */
export function estimateMicros(feature: FeatureConfig, textChars: number): number {
  return Math.max(feature.estimateMicros, costMicros(feature.model, {
    input_tokens: Math.ceil(textChars / 3), output_tokens: Math.ceil(feature.maxTokens / 2),
  }))
}

/** Calendar month in UTC, e.g. "2026-11"; limits reset when it changes. */
export function monthKey(now: number): string {
  return new Date(now).toISOString().slice(0, 7)
}

export function monthResetsAt(now: number): number {
  const d = new Date(now)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)
}

export function usdToMicros(usd: number): number {
  return Math.round(usd * MICROS_PER_USD)
}

/** Positive dollar amount from an env var, else the fallback. */
export function envUsd(name: string, fallback: number): number {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

export function adminEmails(): string[] {
  return (process.env.AI_ADMIN_EMAILS ?? '').split(',').map(email => email.trim().toLowerCase()).filter(Boolean)
}

export function isAdminEmail(email: string | null | undefined): boolean {
  return !!email && adminEmails().includes(email.trim().toLowerCase())
}
