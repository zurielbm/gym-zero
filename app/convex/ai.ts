import Anthropic from '@anthropic-ai/sdk'
import { ConvexError, v, type Infer } from 'convex/values'
import { action, internalMutation, query, type QueryCtx } from './_generated/server'
import { internal } from './_generated/api'
import type { Id } from './_generated/dataModel'
import { requireUserId } from './auth'
import {
  costMicros, DEFAULT_GLOBAL_MONTHLY_USD, DEFAULT_USER_MONTHLY_USD, envUsd, estimateMicros, FEATURES, monthKey, monthResetsAt,
  PHOTO_MAX_CALLS, PHOTO_WINDOW_MS, RATE_MAX_CALLS, RATE_WINDOW_MS, usdToMicros,
} from './aiPolicy'
import { AI_REQUEST_LIMITS, buildAiPrompt, claudeMessages, parseAiJson, PHOTO_DATA_URL, PHOTO_FEATURES, sanitizeAiRequest, type AiRequest } from '../src/lib/ai-prompts'

/**
 * Household AI: one Anthropic key held in the Convex environment
 * (ANTHROPIC_API_KEY), metered per person. Phones send a feature + its inputs;
 * the prompt is always built here.
 */

const followup = v.optional(v.object({ priorRaw: v.string(), answer: v.string() }))
export const aiRequestValidator = v.union(
  v.object({ feature: v.literal('foodText'), text: v.string(), followup }),
  v.object({ feature: v.literal('foodPhoto'), photo: v.string(), note: v.optional(v.string()), followup }),
  v.object({ feature: v.literal('exercisePhoto'), photo: v.string(), note: v.optional(v.string()), exercisesJson: v.string() }),
  v.object({ feature: v.literal('exerciseDescription'), description: v.string(), exercisesJson: v.string() }),
  v.object({ feature: v.literal('machineInfo'), qrUrl: v.string(), code: v.string(), catalogJson: v.string(), feedback: v.optional(v.string()) }),
  v.object({ feature: v.literal('program'), payloadJson: v.string() }),
  v.object({ feature: v.literal('workoutReview'), payloadJson: v.string() }),
)
// The validator and the shared type must describe the same requests.
type _SameShape = Infer<typeof aiRequestValidator> extends AiRequest ? AiRequest extends Infer<typeof aiRequestValidator> ? true : never : never
const _check: _SameShape = true
void _check

export type AiBlockReason = 'unconfigured' | 'paused' | 'blocked' | 'limit' | 'household-limit' | 'rate' | 'photos'

export interface AiLimitState {
  month: string
  resetsAt: number
  spentMicros: number
  capMicros: number | null
  householdSpentMicros: number
  householdCapMicros: number
  defaultUserMicros: number
  paused: boolean
  blocked: boolean
}

export async function globalAiSettings(ctx: QueryCtx) {
  const row = await ctx.db.query('aiSettings').withIndex('by_key', q => q.eq('key', 'global')).unique()
  return {
    row,
    paused: row?.paused ?? false,
    householdCapMicros: row?.monthlyMicros ?? usdToMicros(envUsd('AI_GLOBAL_MONTHLY_USD', DEFAULT_GLOBAL_MONTHLY_USD)),
    defaultUserMicros: row?.defaultUserMicros ?? usdToMicros(envUsd('AI_USER_MONTHLY_USD', DEFAULT_USER_MONTHLY_USD)),
  }
}

export async function householdSpent(ctx: QueryCtx, month: string): Promise<number> {
  const rows = await ctx.db.query('aiMonthly').withIndex('by_month', q => q.eq('month', month)).take(1000)
  return rows.reduce((sum, row) => sum + row.costMicros, 0)
}

export async function limitState(ctx: QueryCtx, userId: string, now: number): Promise<AiLimitState> {
  const month = monthKey(now)
  const global = await globalAiSettings(ctx)
  const limits = await ctx.db.query('aiLimits').withIndex('by_user', q => q.eq('userId', userId)).unique()
  const monthly = await ctx.db.query('aiMonthly').withIndex('by_user_month', q => q.eq('userId', userId).eq('month', month)).unique()
  // monthlyMicros of 0 means "no cap" for that person; the household cap still applies.
  const personal = limits?.monthlyMicros ?? global.defaultUserMicros
  return {
    month,
    resetsAt: monthResetsAt(now),
    spentMicros: monthly?.costMicros ?? 0,
    capMicros: personal > 0 ? personal : null,
    householdSpentMicros: await householdSpent(ctx, month),
    householdCapMicros: global.householdCapMicros,
    defaultUserMicros: global.defaultUserMicros,
    paused: global.paused,
    blocked: limits?.blocked ?? false,
  }
}

/** First reason a call costing `extra` can't go ahead, if any. */
export function blockReason(state: AiLimitState, extra: number): AiBlockReason | null {
  if (!process.env.ANTHROPIC_API_KEY) return 'unconfigured'
  if (state.paused) return 'paused'
  if (state.blocked) return 'blocked'
  if (state.capMicros !== null && state.spentMicros + extra > state.capMicros) return 'limit'
  if (state.householdSpentMicros + extra > state.householdCapMicros) return 'household-limit'
  return null
}

const usd = (micros: number) => `$${(micros / 1_000_000).toFixed(micros % 1_000_000 === 0 ? 0 : 2)}`
const day = (ms: number) => new Date(ms).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

export function blockMessage(reason: AiBlockReason, state: AiLimitState): string {
  switch (reason) {
    case 'unconfigured': return 'Household AI isn’t set up on this server yet.'
    case 'paused': return 'Household AI is paused right now. You can still enter everything by hand.'
    case 'blocked': return 'Household AI is turned off for your account.'
    case 'limit': return `Your ${usd(state.capMicros ?? 0)} of household AI for this month is used up. It refreshes ${day(state.resetsAt)}.`
    case 'household-limit': return `The household’s AI budget for this month is used up. It refreshes ${day(state.resetsAt)}.`
    case 'rate': return 'That’s a lot of AI requests in a few minutes. Wait a little and try again.'
    case 'photos': return 'You’ve hit today’s limit for AI photo checks. Try again tomorrow, or type it in.'
  }
}

export const reserve = internalMutation({
  args: { userId: v.string(), feature: v.string(), model: v.string(), photo: v.boolean(), estimateMicros: v.number() },
  handler: async (ctx, { userId, feature, model, photo, estimateMicros }): Promise<Id<'aiUsage'>> => {
    const now = Date.now()
    const state = await limitState(ctx, userId, now)
    const reason = blockReason(state, estimateMicros)
    if (reason) throw new ConvexError(blockMessage(reason, state))
    const recent = await ctx.db.query('aiUsage')
      .withIndex('by_user_at', q => q.eq('userId', userId).gt('at', now - RATE_WINDOW_MS)).take(RATE_MAX_CALLS)
    if (recent.length >= RATE_MAX_CALLS) throw new ConvexError(blockMessage('rate', state))
    if (photo) {
      const today = await ctx.db.query('aiUsage')
        .withIndex('by_user_at', q => q.eq('userId', userId).gt('at', now - PHOTO_WINDOW_MS))
        .filter(q => q.eq(q.field('photo'), true)).take(PHOTO_MAX_CALLS)
      if (today.length >= PHOTO_MAX_CALLS) throw new ConvexError(blockMessage('photos', state))
    }
    const id = await ctx.db.insert('aiUsage', {
      userId, feature, model, status: 'pending', photo, reservedMicros: estimateMicros, costMicros: estimateMicros, at: now, month: state.month,
    })
    const monthly = await ctx.db.query('aiMonthly').withIndex('by_user_month', q => q.eq('userId', userId).eq('month', state.month)).unique()
    if (monthly) {
      await ctx.db.patch(monthly._id, { costMicros: monthly.costMicros + estimateMicros, requests: monthly.requests + 1, photos: monthly.photos + (photo ? 1 : 0) })
    } else {
      await ctx.db.insert('aiMonthly', { userId, month: state.month, costMicros: estimateMicros, requests: 1, photos: photo ? 1 : 0 })
    }
    return id
  },
})

/** Swap the reservation for what the call actually cost (0 when nothing was billed). */
export const settle = internalMutation({
  args: {
    id: v.id('aiUsage'),
    status: v.union(v.literal('ok'), v.literal('error'), v.literal('refused')),
    costMicros: v.number(),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    cacheReadTokens: v.optional(v.number()),
    cacheWriteTokens: v.optional(v.number()),
  },
  handler: async (ctx, { id, ...result }) => {
    const row = await ctx.db.get(id)
    if (!row || row.status !== 'pending') return
    await ctx.db.patch(id, result)
    const monthly = await ctx.db.query('aiMonthly').withIndex('by_user_month', q => q.eq('userId', row.userId).eq('month', row.month)).unique()
    if (monthly) await ctx.db.patch(monthly._id, { costMicros: Math.max(0, monthly.costMicros - row.reservedMicros + result.costMicros) })
  },
})

export interface HouseholdAiStatus {
  configured: boolean
  available: boolean
  reason: AiBlockReason | null
  message: string | null
  spentMicros: number
  capMicros: number | null
  resetsAt: number
}

export const myStatus = query({
  args: {},
  handler: async (ctx): Promise<HouseholdAiStatus> => {
    const userId = await requireUserId(ctx)
    const state = await limitState(ctx, userId, Date.now())
    // Gray out only when the cheapest call couldn't run; a near-full cap still allows a text log.
    const reason = blockReason(state, 1)
    return {
      configured: !!process.env.ANTHROPIC_API_KEY,
      available: !reason,
      reason,
      message: reason ? blockMessage(reason, state) : null,
      spentMicros: state.spentMicros,
      capMicros: state.capMicros,
      resetsAt: state.resetsAt,
    }
  },
})

/** Size and shape checks before anything is reserved or sent; returns the cleaned request. */
function validate(request: AiRequest): AiRequest {
  if (JSON.stringify(request).length > AI_REQUEST_LIMITS[request.feature]) {
    throw new ConvexError(PHOTO_FEATURES.includes(request.feature)
      ? 'That photo is too large. Try again with a smaller one.'
      : 'That request is too large for AI. Shorten it and try again.')
  }
  if ('photo' in request && !PHOTO_DATA_URL.test(request.photo)) throw new ConvexError('Choose a readable photo and try again.')
  try { return sanitizeAiRequest(request) }
  catch { throw new ConvexError('AI couldn’t read that request. Try again, or enter it by hand.') }
}

export const run = action({
  args: { request: aiRequestValidator },
  handler: async (ctx, { request }): Promise<{ text: string }> => {
    const userId = await requireUserId(ctx)
    request = validate(request)
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) throw new ConvexError('Household AI isn’t set up on this server yet.')
    const feature = FEATURES[request.feature]
    const photo = PHOTO_FEATURES.includes(request.feature)
    const usageId = await ctx.runMutation(internal.ai.reserve, {
      userId, feature: request.feature, model: feature.model, photo,
      estimateMicros: estimateMicros(feature, JSON.stringify(request).length - ('photo' in request ? request.photo.length : 0)),
    })
    const prompt = buildAiPrompt(request)
    let response: Anthropic.Message
    try {
      // Pin the official endpoint and key so stray ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN
      // variables can never reroute household traffic or bill a different account.
      const client = new Anthropic({ apiKey, authToken: null, baseURL: 'https://api.anthropic.com', maxRetries: 1, timeout: 90_000 })
      response = await client.messages.create({
        model: feature.model,
        max_tokens: feature.maxTokens,
        output_config: { effort: feature.effort },
        system: prompt.system,
        messages: claudeMessages(prompt),
      })
    } catch (error) {
      await ctx.runMutation(internal.ai.settle, { id: usageId, status: 'error', costMicros: 0 })
      if (error instanceof Anthropic.RateLimitError) throw new ConvexError('Household AI is busy right now. Try again in a minute.')
      if (error instanceof Anthropic.AuthenticationError || error instanceof Anthropic.PermissionDeniedError) {
        throw new ConvexError('Household AI’s key was rejected. Ask the admin to check it.')
      }
      if (error instanceof Anthropic.BadRequestError) throw new ConvexError('AI couldn’t read that request. Try again, or enter it by hand.')
      throw new ConvexError('Could not reach household AI. Try again in a moment.')
    }
    const usage = response.usage
    const refused = response.stop_reason === 'refusal'
    await ctx.runMutation(internal.ai.settle, {
      id: usageId,
      status: refused ? 'refused' : 'ok',
      costMicros: costMicros(feature.model, usage),
      inputTokens: usage.input_tokens,
      outputTokens: usage.output_tokens,
      cacheReadTokens: usage.cache_read_input_tokens ?? undefined,
      cacheWriteTokens: usage.cache_creation_input_tokens ?? undefined,
    })
    if (refused) throw new ConvexError('AI declined this one. Try rephrasing, or enter it by hand.')
    if (response.stop_reason === 'max_tokens') throw new ConvexError('AI’s answer was cut off. Try again.')
    const text = response.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('').trim()
    if (!text) throw new ConvexError('AI returned an empty response. Try again.')
    // Every feature answers with a JSON object; anything else isn't returned.
    let answer: unknown
    try { answer = parseAiJson(text) } catch { answer = null }
    if (!answer || typeof answer !== 'object' || Array.isArray(answer)) throw new ConvexError('AI sent an unreadable response. Try again or enter the details by hand.')
    return { text }
  },
})
