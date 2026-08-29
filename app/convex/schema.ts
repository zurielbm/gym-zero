import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

// One generic replicated-row table. The client owns the shape of `doc`
// (it mirrors the Dexie tables); the server only does last-write-wins.
export default defineSchema({
  records: defineTable({
    profileKey: v.string(),
    table: v.string(),
    id: v.string(),
    doc: v.optional(v.any()),
    deleted: v.boolean(),
    /** client wall-clock of the write; used for LWW conflict resolution */
    updatedAt: v.number(),
    /** server wall-clock of the accepted write; used as the pull cursor */
    syncedAt: v.number(),
  })
    .index('by_key', ['profileKey', 'table', 'id'])
    .index('by_synced', ['profileKey', 'syncedAt']),
})
