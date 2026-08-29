import { mutation, query } from './_generated/server'
import { v } from 'convex/values'
import { requireUserId } from './auth'

const change = v.object({
  table: v.string(),
  id: v.string(),
  doc: v.optional(v.any()),
  deleted: v.boolean(),
  updatedAt: v.number(),
})

/** Upsert a batch of the caller's rows, last-write-wins on the client's updatedAt. */
export const push = mutation({
  args: { changes: v.array(change) },
  handler: async (ctx, { changes }) => {
    const userId = await requireUserId(ctx)
    const syncedAt = Date.now()
    for (const c of changes) {
      const existing = await ctx.db
        .query('records')
        .withIndex('by_user_key', (q) => q.eq('userId', userId).eq('table', c.table).eq('id', c.id))
        .unique()
      if (existing) {
        if (existing.updatedAt <= c.updatedAt) {
          await ctx.db.patch(existing._id, { doc: c.doc, deleted: c.deleted, updatedAt: c.updatedAt, syncedAt })
        }
      } else {
        await ctx.db.insert('records', { userId, table: c.table, id: c.id, doc: c.doc, deleted: c.deleted, updatedAt: c.updatedAt, syncedAt })
      }
    }
    return syncedAt
  },
})

/** Everything of the caller's accepted by the server after `since` (a prior pull's cursor). */
export const pull = query({
  args: { since: v.number() },
  handler: async (ctx, { since }) => {
    const userId = await requireUserId(ctx)
    const records = await ctx.db
      .query('records')
      .withIndex('by_user_synced', (q) => q.eq('userId', userId).gt('syncedAt', since))
      .collect()
    return records.map((r) => ({
      table: r.table,
      id: r.id,
      doc: r.doc,
      deleted: r.deleted,
      updatedAt: r.updatedAt,
      syncedAt: r.syncedAt,
    }))
  },
})

/**
 * Adopt rows written under the pre-auth passphrase scheme into the calling
 * account. Works in batches (call until it returns 0). Claimed rows get a
 * fresh syncedAt so every device of the account pulls them regardless of its
 * cursor. If the account already has a row with the same table/id, the newer
 * write (by updatedAt) wins and the loser is deleted.
 */
export const claimLegacyProfile = mutation({
  args: { profileKey: v.string() },
  handler: async (ctx, { profileKey }) => {
    const userId = await requireUserId(ctx)
    const syncedAt = Date.now()
    const batch = await ctx.db
      .query('records')
      .withIndex('by_key', (q) => q.eq('profileKey', profileKey))
      .take(200)
    for (const legacy of batch) {
      const owned = await ctx.db
        .query('records')
        .withIndex('by_user_key', (q) => q.eq('userId', userId).eq('table', legacy.table).eq('id', legacy.id))
        .unique()
      if (owned && owned.updatedAt > legacy.updatedAt) {
        await ctx.db.delete(legacy._id)
        continue
      }
      if (owned) await ctx.db.delete(owned._id)
      await ctx.db.patch(legacy._id, { userId, profileKey: undefined, syncedAt })
    }
    return batch.length
  },
})
