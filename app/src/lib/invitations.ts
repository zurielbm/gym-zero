import { ConvexHttpClient } from 'convex/browser'
import { ConvexError } from 'convex/values'
import { api } from '../../convex/_generated/api'
import type { Id } from '../../convex/_generated/dataModel'
import { authClient } from './auth-client'
import { observeAuthRequest } from './auth-diagnostics'

export interface Invitation {
  id: Id<'invitations'>
  createdAt: number
  expiresAt: number
  revokedAt?: number
}

async function client() {
  if (!navigator.onLine) throw new Error('Connect to the internet to manage invitations.')
  const url = import.meta.env.VITE_CONVEX_URL
  if (!url || !import.meta.env.VITE_CONVEX_SITE_URL) throw new Error('Invitations require an account server.')
  const result = await observeAuthRequest('session-token', () => authClient.convex.token({ fetchOptions: { throw: false } }))
  if (!result.data?.token) throw new Error('Could not verify your session. Try signing in again.')
  const client = new ConvexHttpClient(url)
  client.setAuth(result.data.token)
  return client
}

export async function listInvitations(): Promise<Invitation[]> {
  return (await client()).query(api.invitations.list, {})
}

export async function createInvitation(): Promise<{ id: Id<'invitations'>; url: string; expiresAt: number }> {
  const invitation = await (await client()).action(api.invitations.create, {})
  const url = new URL(window.location.href)
  url.search = ''
  url.hash = new URLSearchParams({ invite: invitation.token }).toString()
  return { id: invitation.id, url: url.toString(), expiresAt: invitation.expiresAt }
}

export async function revokeInvitation(id: Id<'invitations'>): Promise<void> {
  await (await client()).mutation(api.invitations.revoke, { id })
}

export function invitationError(error: unknown): string {
  if (error instanceof ConvexError && typeof error.data === 'string') return error.data
  if (error instanceof Error && !error.message.includes('[CONVEX')) return error.message
  return 'Could not update invitations. Check your connection and try again.'
}
