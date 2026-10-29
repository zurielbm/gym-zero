import { ConvexHttpClient } from 'convex/browser'
import { ConvexError } from 'convex/values'
import { api } from '../../convex/_generated/api'
import type { HouseholdAiStatus } from '../../convex/ai'
import type { AiOverview } from '../../convex/aiAdmin'
import { syncConfigured } from '../data/sync'
import { authClient } from './auth-client'
import type { AiRequest } from './ai-prompts'

export type { HouseholdAiStatus } from '../../convex/ai'
export type { AiOverview, AiPerson } from '../../convex/aiAdmin'

/** Household AI needs the account server; local-only builds never offer it. */
export const householdAiPossible = syncConfigured

async function client() {
  if (!navigator.onLine) throw new Error('You’re offline. Connect to use household AI.')
  const url = import.meta.env.VITE_CONVEX_URL
  if (!url) throw new Error('Household AI needs the account server.')
  const result = await authClient.convex.token({ fetchOptions: { throw: false } })
  if (!result.data?.token) throw new Error('Could not verify your session. Try signing in again.')
  const client = new ConvexHttpClient(url)
  client.setAuth(result.data.token)
  return client
}

/** ConvexError messages are written for people; anything else gets a generic line. */
export function householdError(error: unknown, fallback = 'Could not reach household AI. Try again in a moment.'): Error {
  if (error instanceof ConvexError && typeof error.data === 'string') return new Error(error.data)
  if (error instanceof Error && !error.message.includes('[CONVEX') && !error.message.includes('[Request ID')) return error
  return new Error(fallback)
}

export async function runHouseholdAi(request: AiRequest, signal?: AbortSignal): Promise<string> {
  signal?.throwIfAborted()
  // ConvexHttpClient can't cancel in flight; stop waiting so the UI frees up.
  // Listen before the token fetch so a cancel during it is never missed.
  const aborted = new Promise<never>((_, reject) => signal?.addEventListener('abort', () => reject(signal.reason), { once: true }))
  aborted.catch(() => {})
  try {
    const convex = await Promise.race([client(), aborted])
    signal?.throwIfAborted()
    const { text } = await Promise.race([convex.action(api.ai.run, { request }), aborted])
    return text
  } catch (error) {
    signal?.throwIfAborted()
    throw householdError(error)
  }
}

export async function householdStatus(): Promise<HouseholdAiStatus> {
  try { return await (await client()).query(api.ai.myStatus, {}) }
  catch (error) { throw householdError(error) }
}

export async function amIAiAdmin(): Promise<boolean> {
  try { return await (await client()).query(api.aiAdmin.amIAdmin, {}) }
  catch { return false }
}

export async function aiOverview(): Promise<AiOverview> {
  try { return await (await client()).query(api.aiAdmin.overview, {}) }
  catch (error) { throw householdError(error, 'Could not load AI usage. Check your connection and try again.') }
}

export async function setAiPerson(userId: string, change: { monthlyUsd?: number | null; blocked?: boolean }): Promise<void> {
  try { await (await client()).mutation(api.aiAdmin.setPerson, { userId, ...change }) }
  catch (error) { throw householdError(error, 'Could not save that change. Try again.') }
}

export async function setAiHousehold(change: { paused?: boolean; monthlyUsd?: number; defaultUserUsd?: number }): Promise<void> {
  try { await (await client()).mutation(api.aiAdmin.setHousehold, change) }
  catch (error) { throw householdError(error, 'Could not save that change. Try again.') }
}
