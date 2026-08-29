import { defineSchema, defineTable } from 'convex/server'
import { v } from 'convex/values'

// One generic replicated-row table. The client owns the shape of `doc`
// (it mirrors the Dexie tables); the server only does last-write-wins.
//
// Rows are owned by a Better Auth user (`userId`). `profileKey` is the
// pre-auth owner (SHA-256 of a passphrase) kept only so existing rows can be
// claimed into an account via sync.claimLegacyProfile; once every profile is
// claimed, the field and its indexes can be dropped.
export default defineSchema({
  records: defineTable({
    userId: v.optional(v.string()),
    profileKey: v.optional(v.string()),
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
    .index('by_synced', ['profileKey', 'syncedAt'])
    .index('by_user_key', ['userId', 'table', 'id'])
    .index('by_user_synced', ['userId', 'syncedAt']),
})
