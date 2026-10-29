import { v, ConvexError } from 'convex/values'
import { action, internalMutation, internalQuery, mutation, query } from './_generated/server'
import { internal } from './_generated/api'
import { requireUserId } from './auth'
import { hashInvitationToken, INVITATION_LIFETIME_MS, isInvitationActive, validInvitationToken } from './invitationPolicy'
import type { Id } from './_generated/dataModel'

/** Raw bearer tokens are returned once and never stored in the database. */
export const create = action({
  args: {},
  handler: async (ctx): Promise<{ id: Id<'invitations'>; token: string; expiresAt: number }> => {
    const creatorId = await requireUserId(ctx)
    const bytes = crypto.getRandomValues(new Uint8Array(32))
    const token = Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
    const result = await ctx.runMutation(internal.invitations.store, {
      creatorId, tokenHash: await hashInvitationToken(token),
    })
    return { ...result, token }
  },
})

export const store = internalMutation({
  args: { creatorId: v.string(), tokenHash: v.string() },
  handler: async (ctx, { creatorId, tokenHash }) => {
    const now = Date.now()
    const recent = await ctx.db.query('invitations')
      .withIndex('by_creator_created', q => q.eq('creatorId', creatorId).gt('createdAt', now - 86_400_000))
      .take(20)
    if (recent.length >= 20) throw new ConvexError('You can create up to 20 invitations per day. Try again tomorrow.')
    const active = await ctx.db.query('invitations')
      .withIndex('by_creator_expiry', q => q.eq('creatorId', creatorId).gt('expiresAt', now))
      .filter(q => q.eq(q.field('revokedAt'), undefined)).take(10)
    if (active.length >= 10) throw new ConvexError('You have 10 active invitations. Revoke one before creating another.')
    const expiresAt = now + INVITATION_LIFETIME_MS
    const id = await ctx.db.insert('invitations', { creatorId, tokenHash, createdAt: now, expiresAt })
    return { id, expiresAt }
  },
})

export const list = query({
  args: {},
  handler: async ctx => {
    const creatorId = await requireUserId(ctx)
    const rows = await ctx.db.query('invitations')
      .withIndex('by_creator_created', q => q.eq('creatorId', creatorId)).order('desc').take(50)
    // Older active links must remain revocable even after many newer links.
    const active = await ctx.db.query('invitations')
      .withIndex('by_creator_expiry', q => q.eq('creatorId', creatorId).gt('expiresAt', Date.now()))
      .filter(q => q.eq(q.field('revokedAt'), undefined)).take(10)
    const visible = [...new Map([...active, ...rows].map(row => [row._id, row])).values()]
      .sort((a, b) => b.createdAt - a.createdAt)
    return visible.map(({ _id, createdAt, expiresAt, revokedAt }) => ({ id: _id, createdAt, expiresAt, revokedAt }))
  },
})

export const revoke = mutation({
  args: { id: v.id('invitations') },
  handler: async (ctx, { id }) => {
    const creatorId = await requireUserId(ctx)
    const invitation = await ctx.db.get(id)
    if (!invitation || invitation.creatorId !== creatorId) throw new ConvexError('Invitation not found.')
    if (invitation.revokedAt === undefined) await ctx.db.patch(id, { revokedAt: Date.now() })
  },
})

/** Only the signup hook may validate a token; no public token lookup endpoint. */
export const validate = internalQuery({
  args: { token: v.string() },
  handler: async (ctx, { token }): Promise<boolean> => {
    if (!validInvitationToken(token)) return false
    const tokenHash = await hashInvitationToken(token)
    const invitation = await ctx.db.query('invitations').withIndex('by_token', q => q.eq('tokenHash', tokenHash)).unique()
    return isInvitationActive(invitation, Date.now())
  },
})
