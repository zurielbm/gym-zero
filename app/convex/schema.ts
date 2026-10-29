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
  // Household AI metering. One row per call; amounts are micro-dollars.
  aiUsage: defineTable({
    userId: v.string(),
    feature: v.string(),
    model: v.string(),
    status: v.union(v.literal('pending'), v.literal('ok'), v.literal('error'), v.literal('refused')),
    photo: v.boolean(),
    reservedMicros: v.number(),
    costMicros: v.number(),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    cacheReadTokens: v.optional(v.number()),
    cacheWriteTokens: v.optional(v.number()),
    at: v.number(),
    month: v.string(),
  })
    .index('by_user_at', ['userId', 'at']),
  /** Running per-person totals so a limit check is one lookup. */
  aiMonthly: defineTable({
    userId: v.string(),
    month: v.string(),
    costMicros: v.number(),
    requests: v.number(),
    photos: v.number(),
  })
    .index('by_user_month', ['userId', 'month'])
    .index('by_month', ['month']),
  /** Only people whose limit differs from the default, or who are blocked. */
  aiLimits: defineTable({
    userId: v.string(),
    monthlyMicros: v.optional(v.number()),
    blocked: v.optional(v.boolean()),
  })
    .index('by_user', ['userId']),
  /** Singleton (key "global"); fields override the env-var defaults. */
  aiSettings: defineTable({
    key: v.literal('global'),
    paused: v.optional(v.boolean()),
    monthlyMicros: v.optional(v.number()),
    defaultUserMicros: v.optional(v.number()),
  })
    .index('by_key', ['key']),
  invitations: defineTable({
    creatorId: v.string(),
    tokenHash: v.string(),
    createdAt: v.number(),
    expiresAt: v.number(),
    revokedAt: v.optional(v.number()),
  })
    .index('by_token', ['tokenHash'])
    .index('by_creator_created', ['creatorId', 'createdAt'])
    .index('by_creator_expiry', ['creatorId', 'expiresAt']),
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
