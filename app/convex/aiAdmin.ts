import { ConvexError, v } from 'convex/values'
import { mutation, query, type QueryCtx } from './_generated/server'
import { components } from './_generated/api'
import { authComponent } from './auth'
import { globalAiSettings, householdSpent } from './ai'
import { isAdminEmail, monthKey, monthResetsAt, usdToMicros } from './aiPolicy'

/** Admins are the emails in AI_ADMIN_EMAILS; checked on every call, never trusted from the client. */
async function requireAdmin(ctx: QueryCtx) {
  const user = await authComponent.getAuthUser(ctx)
  if (!isAdminEmail(user.email)) throw new ConvexError('Only an admin can manage household AI.')
  return user
}

export const amIAdmin = query({
  args: {},
  handler: async (ctx): Promise<boolean> => {
    const user = await authComponent.safeGetAuthUser(ctx)
    return !!user && isAdminEmail(user.email)
  },
})

export interface AiPerson {
  userId: string
  name: string
  email: string
  spentMicros: number
  requests: number
  photos: number
  /** null = no personal cap */
  capMicros: number | null
  customCap: boolean
  blocked: boolean
  ownKey: boolean
}

export interface AiOverview {
  configured: boolean
  month: string
  resetsAt: number
  paused: boolean
  householdSpentMicros: number
  householdCapMicros: number
  defaultUserMicros: number
  requests: number
  people: AiPerson[]
}

export const overview = query({
  args: {},
  handler: async (ctx): Promise<AiOverview> => {
    await requireAdmin(ctx)
    const now = Date.now()
    const month = monthKey(now)
    const global = await globalAiSettings(ctx)
    const users = await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'user', paginationOpts: { numItems: 200, cursor: null },
    })
    const people: AiPerson[] = []
    for (const user of users.page) {
      const userId = String(user._id)
      const [monthly, limits, settings] = await Promise.all([
        ctx.db.query('aiMonthly').withIndex('by_user_month', q => q.eq('userId', userId).eq('month', month)).unique(),
        ctx.db.query('aiLimits').withIndex('by_user', q => q.eq('userId', userId)).unique(),
        ctx.db.query('records').withIndex('by_user_key', q => q.eq('userId', userId).eq('table', 'settings').eq('id', 'settings')).unique(),
      ])
      const doc = (settings?.doc ?? {}) as { aiSource?: string; aiEndpoint?: string }
      const personal = limits?.monthlyMicros ?? global.defaultUserMicros
      people.push({
        userId,
        name: typeof user.name === 'string' && user.name.trim() ? user.name : String(user.email ?? 'Unknown'),
        email: String(user.email ?? ''),
        spentMicros: monthly?.costMicros ?? 0,
        requests: monthly?.requests ?? 0,
        photos: monthly?.photos ?? 0,
        capMicros: personal > 0 ? personal : null,
        customCap: limits?.monthlyMicros !== undefined,
        blocked: limits?.blocked ?? false,
        // matches aiConfig() on the device: an old endpoint with no choice yet means "own key"
        ownKey: doc.aiSource === 'own' || (doc.aiSource === undefined && !!doc.aiEndpoint),
      })
    }
    people.sort((a, b) => b.spentMicros - a.spentMicros || a.name.localeCompare(b.name))
    return {
      configured: !!process.env.ANTHROPIC_API_KEY,
      month,
      resetsAt: monthResetsAt(now),
      paused: global.paused,
      householdSpentMicros: await householdSpent(ctx, month),
      householdCapMicros: global.householdCapMicros,
      defaultUserMicros: global.defaultUserMicros,
      requests: people.reduce((sum, person) => sum + person.requests, 0),
      people,
    }
  },
})

const dollars = v.number()
const checkUsd = (value: number, max: number) => {
  if (!Number.isFinite(value) || value < 0 || value > max) throw new ConvexError(`Enter an amount between $0 and $${max}.`)
}

/** monthlyUsd: a number sets a personal cap (0 = no cap), null returns them to the default. */
export const setPerson = mutation({
  args: { userId: v.string(), monthlyUsd: v.optional(v.union(dollars, v.null())), blocked: v.optional(v.boolean()) },
  handler: async (ctx, { userId, monthlyUsd, blocked }) => {
    await requireAdmin(ctx)
    if (typeof monthlyUsd === 'number') checkUsd(monthlyUsd, 500)
    const row = await ctx.db.query('aiLimits').withIndex('by_user', q => q.eq('userId', userId)).unique()
    const next = {
      monthlyMicros: monthlyUsd === undefined ? row?.monthlyMicros : monthlyUsd === null ? undefined : usdToMicros(monthlyUsd),
      blocked: blocked === undefined ? row?.blocked : blocked || undefined,
    }
    if (row) {
      if (next.monthlyMicros === undefined && !next.blocked) await ctx.db.delete(row._id)
      else await ctx.db.replace(row._id, { userId, ...next })
    } else if (next.monthlyMicros !== undefined || next.blocked) {
      await ctx.db.insert('aiLimits', { userId, ...next })
    }
  },
})

export const setHousehold = mutation({
  args: { paused: v.optional(v.boolean()), monthlyUsd: v.optional(dollars), defaultUserUsd: v.optional(dollars) },
  handler: async (ctx, { paused, monthlyUsd, defaultUserUsd }) => {
    await requireAdmin(ctx)
    if (monthlyUsd !== undefined) { checkUsd(monthlyUsd, 5000); if (monthlyUsd === 0) throw new ConvexError('Use the switch to pause household AI instead of a $0 budget.') }
    if (defaultUserUsd !== undefined) checkUsd(defaultUserUsd, 500)
    const { row } = await globalAiSettings(ctx)
    const patch = {
      ...(paused !== undefined ? { paused } : {}),
      ...(monthlyUsd !== undefined ? { monthlyMicros: usdToMicros(monthlyUsd) } : {}),
      ...(defaultUserUsd !== undefined ? { defaultUserMicros: usdToMicros(defaultUserUsd) } : {}),
    }
    if (row) await ctx.db.patch(row._id, patch)
    else await ctx.db.insert('aiSettings', { key: 'global', ...patch })
  },
})
