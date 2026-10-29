import { afterEach, describe, expect, it, vi } from 'vitest'
import { convexTest } from 'convex-test'
import betterAuth from '@convex-dev/better-auth/test'
import schema from '../convex/schema'
import { api, components, internal } from '../convex/_generated/api'
import { hashInvitationToken, INVITATION_LIFETIME_MS } from '../convex/invitationPolicy'
import { invitationFromUrl } from '../src/lib/invitation-link'

process.env.SITE_URL = 'https://gym.example.com'
process.env.CONVEX_SITE_URL = 'https://backend.example.com'
process.env.BETTER_AUTH_SECRET = 'test-only-auth-secret-longer-than-thirty-two-characters'
const modules = import.meta.glob('../convex/**/*.ts')

function setup() {
  const t = convexTest(schema, modules)
  betterAuth.register(t)
  return t
}

async function account(t: ReturnType<typeof setup>, email: string) {
  const now = Date.now()
  const user = await t.mutation(components.betterAuth.adapter.create, { input: {
    model: 'user', data: { name: email, email, emailVerified: false, createdAt: now, updatedAt: now },
  } })
  const session = await t.mutation(components.betterAuth.adapter.create, { input: {
    model: 'session', data: { userId: user._id, token: crypto.randomUUID(), expiresAt: now + 86_400_000, createdAt: now, updatedAt: now },
  } })
  return t.withIdentity({ subject: user._id, sessionId: session._id })
}

function signup(t: ReturnType<typeof setup>, email: string, headers: Record<string, string> = {}, password = 'Strong-test-password-123!') {
  return t.fetch('/api/auth/sign-up/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: 'https://gym.example.com', ...headers },
    body: JSON.stringify({ name: 'Guest', email, password }),
  })
}

afterEach(() => { vi.useRealTimers(); delete process.env.INVITE_CODE })

describe('private account invitations', () => {
  it('requires a live account session for creating, listing, and revoking invitations', async () => {
    const t = setup()
    await expect(t.action(api.invitations.create, {})).rejects.toThrow('Unauthenticated')
    await expect(t.query(api.invitations.list, {})).rejects.toThrow('Unauthenticated')
    const owner = await account(t, 'owner@example.com')
    const invite = await owner.action(api.invitations.create, {})
    await expect(t.mutation(api.invitations.revoke, { id: invite.id })).rejects.toThrow('Unauthenticated')
    const expiredSession = t.withIdentity({ subject: 'no-user', sessionId: 'no-session' })
    await expect(expiredSession.action(api.invitations.create, {})).rejects.toThrow()
  })

  it('stores only hashes, hides other users’ invites, and restricts revocation to the creator', async () => {
    const t = setup()
    const owner = await account(t, 'owner@example.com')
    const other = await account(t, 'other@example.com')
    const before = Date.now()
    const invite = await owner.action(api.invitations.create, {})
    expect(invite.token).toMatch(/^[a-f0-9]{64}$/)
    expect(invite.expiresAt).toBeGreaterThanOrEqual(before + INVITATION_LIFETIME_MS)
    const stored = await t.run(ctx => ctx.db.get(invite.id))
    expect(stored?.tokenHash).toBe(await hashInvitationToken(invite.token))
    expect(JSON.stringify(stored)).not.toContain(invite.token)
    const listed = await owner.query(api.invitations.list, {})
    expect(listed).toHaveLength(1)
    expect(JSON.stringify(listed)).not.toContain('token')
    expect(await other.query(api.invitations.list, {})).toEqual([])
    await expect(other.mutation(api.invitations.revoke, { id: invite.id })).rejects.toThrow('Invitation not found')
    expect(await t.query(internal.invitations.validate, { token: invite.token })).toBe(true)
    await owner.mutation(api.invitations.revoke, { id: invite.id })
    await owner.mutation(api.invitations.revoke, { id: invite.id })
    expect(await t.query(internal.invitations.validate, { token: invite.token })).toBe(false)
  })

  it('rejects malformed, unknown, and expired tokens, including the exact expiry instant', async () => {
    const t = setup()
    const owner = await account(t, 'owner@example.com')
    const invite = await owner.action(api.invitations.create, {})
    for (const token of ['', 'bad', '0'.repeat(64), 'a'.repeat(10000)]) {
      expect(await t.query(internal.invitations.validate, { token })).toBe(false)
    }
    vi.useFakeTimers()
    vi.setSystemTime(invite.expiresAt - 1)
    expect(await t.query(internal.invitations.validate, { token: invite.token })).toBe(true)
    vi.setSystemTime(invite.expiresAt)
    expect(await t.query(internal.invitations.validate, { token: invite.token })).toBe(false)
  })

  it('keeps older active invitations visible when the recent history fills up', async () => {
    const t = setup()
    const owner = await account(t, 'owner@example.com')
    const invite = await owner.action(api.invitations.create, {})
    await t.run(async ctx => {
      const original = (await ctx.db.get(invite.id))!
      for (let i = 1; i <= 55; i++) {
        await ctx.db.insert('invitations', {
          creatorId: original.creatorId, tokenHash: `revoked-test-${i}`,
          createdAt: original.createdAt + i, expiresAt: original.expiresAt, revokedAt: original.createdAt + i,
        })
      }
    })
    expect((await owner.query(api.invitations.list, {})).some(row => row.id === invite.id)).toBe(true)
  })

  it('caps active invitations and daily creation, even after revocation', async () => {
    const t = setup()
    const owner = await account(t, 'owner@example.com')
    const invites = []
    for (let i = 0; i < 10; i++) invites.push(await owner.action(api.invitations.create, {}))
    await expect(owner.action(api.invitations.create, {})).rejects.toThrow('10 active invitations')
    for (const invite of invites) await owner.mutation(api.invitations.revoke, { id: invite.id })
    for (let i = 0; i < 10; i++) {
      const invite = await owner.action(api.invitations.create, {})
      await owner.mutation(api.invitations.revoke, { id: invite.id })
    }
    await expect(owner.action(api.invitations.create, {})).rejects.toThrow('20 invitations per day')
  })

  it('accepts an invite through the real signup endpoint, retries failed forms, and keeps personal data separate', async () => {
    const t = setup()
    const owner = await account(t, 'owner@example.com')
    await owner.mutation(api.sync.push, { changes: [{ table: 'food', id: 'private-food', doc: { note: 'owner-only' }, deleted: false, updatedAt: Date.now() }] })
    const invite = await owner.action(api.invitations.create, {})
    const headers = { 'x-invitation-token': invite.token }
    expect((await signup(t, 'guest@example.com', headers, 'short')).status).toBeGreaterThanOrEqual(400)
    const response = await signup(t, 'guest@example.com', headers)
    expect(response.status).toBe(200)
    const body = await response.json()
    expect(body.user.email).toBe('guest@example.com')
    const session = await t.query(components.betterAuth.adapter.findOne, { model: 'session', where: [{ field: 'userId', value: body.user.id }] })
    const guest = t.withIdentity({ subject: body.user.id, sessionId: session!._id })
    expect(await guest.query(api.sync.pull, { since: 0 })).toEqual([])
    expect(await guest.query(api.invitations.list, {})).toEqual([])
    expect((await owner.query(api.sync.pull, { since: 0 }))).toHaveLength(1)
    // Deliberately reusable until revoked or expired.
    expect((await signup(t, 'another@example.com', headers)).status).toBe(200)
    await owner.mutation(api.invitations.revoke, { id: invite.id })
    expect((await signup(t, 'blocked@example.com', headers)).status).toBe(403)
  })

  it('preserves legacy family codes and fails closed without either invitation mechanism', async () => {
    const t = setup()
    expect((await signup(t, 'closed@example.com')).status).toBe(403)
    process.env.INVITE_CODE = 'test-family-code'
    expect((await signup(t, 'wrong@example.com', { 'x-invite-code': 'wrong' })).status).toBe(403)
    expect((await signup(t, 'family@example.com', { 'x-invite-code': 'test-family-code' })).status).toBe(200)
    expect((await signup(t, 'invalid@example.com', { 'x-invite-code': 'test-family-code', 'x-invitation-token': '' })).status).toBe(403)
    const cors = await t.fetch('/api/auth/sign-up/email', { method: 'OPTIONS', headers: {
      origin: 'https://gym.example.com', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-invitation-token',
    } })
    expect(cors.headers.get('access-control-allow-headers')).toContain('x-invitation-token')
  })

  it('reads invitations from fragments, keeping missing and empty tokens distinct', () => {
    expect(invitationFromUrl('https://gym.example.com/#invite=abc')).toBe('abc')
    expect(invitationFromUrl('https://gym.example.com/#invite=')).toBe('')
    expect(invitationFromUrl('https://gym.example.com/?invite=abc')).toBeNull()
    expect(invitationFromUrl('https://gym.example.com/')).toBeNull()
  })
})
