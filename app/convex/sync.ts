import { mutation, query } from './_generated/server'
import { v } from 'convex/values'

const change = v.object({
  table: v.string(),
  id: v.string(),
  doc: v.optional(v.any()),
  deleted: v.boolean(),
  updatedAt: v.number(),
})

/** Upsert a batch of rows, last-write-wins on the client's updatedAt. */
export const push = mutation({
  args: { profileKey: v.string(), changes: v.array(change) },
  handler: async (ctx, { profileKey, changes }) => {
    const syncedAt = Date.now()
    for (const c of changes) {
      const existing = await ctx.db
        .query('records')
        .withIndex('by_key', (q) => q.eq('profileKey', profileKey).eq('table', c.table).eq('id', c.id))
        .unique()
      if (existing) {
        if (existing.updatedAt <= c.updatedAt) {
          await ctx.db.patch(existing._id, { doc: c.doc, deleted: c.deleted, updatedAt: c.updatedAt, syncedAt })
        }
      } else {
        await ctx.db.insert('records', { profileKey, table: c.table, id: c.id, doc: c.doc, deleted: c.deleted, updatedAt: c.updatedAt, syncedAt })
      }
    }
    return syncedAt
  },
})

/** Everything accepted by the server after `since` (a prior pull's cursor). */
export const pull = query({
  args: { profileKey: v.string(), since: v.number() },
  handler: async (ctx, { profileKey, since }) => {
    const records = await ctx.db
      .query('records')
      .withIndex('by_synced', (q) => q.eq('profileKey', profileKey).gt('syncedAt', since))
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
