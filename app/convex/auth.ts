import { createClient, type GenericCtx } from '@convex-dev/better-auth'
import { convex, crossDomain } from '@convex-dev/better-auth/plugins'
import { betterAuth } from 'better-auth/minimal'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { components, internal } from './_generated/api'
import type { DataModel } from './_generated/dataModel'
import { internalAction, query } from './_generated/server'
import authConfig from './auth.config'

// Public URL of the app itself (e.g. https://gym.example.com); set on the
// deployment with `npx convex env set SITE_URL …`. Auth flows fail closed
// without it, but plain function calls keep working.
const siteUrl = process.env.SITE_URL ?? ''

export const authComponent = createClient<DataModel>(components.betterAuth)

export const createAuth = (ctx: GenericCtx<DataModel>) =>
  betterAuth({
    baseURL: process.env.CONVEX_SITE_URL,
    trustedOrigins: [siteUrl],
    database: authComponent.adapter(ctx),
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
    },
    hooks: {
      // Existing family codes and revocable invitations both grant signup,
      // never access to the inviting account's personal records.
      before: createAuthMiddleware(async (request) => {
        if (request.path !== '/sign-up/email') return
        const token = request.headers?.get('x-invitation-token')
        if (token !== null && token !== undefined) {
          const valid = await ctx.runQuery(internal.invitations.validate, { token })
          if (!valid) throw new APIError('FORBIDDEN', { message: 'This invitation is invalid, expired, or revoked. Ask for a new link.' })
          return
        }
        const expected = process.env.INVITE_CODE
        if (!expected) {
          throw new APIError('FORBIDDEN', { message: 'An invitation link is required to create an account on this server.' })
        }
        if (request.headers?.get('x-invite-code') !== expected) {
          throw new APIError('FORBIDDEN', { message: 'Invalid invite code.' })
        }
      }),
    },
    plugins: [
      crossDomain({ siteUrl }),
      convex({
        authConfig,
        // Regenerate the JWT signing key if the stored one can't be used —
        // e.g. it was encrypted under a different BETTER_AUTH_SECRET (the key
        // is created on first sign-in, so setting/rotating the secret after
        // that would otherwise 500 every /convex/token call forever).
        jwksRotateOnTokenGenerationError: true,
      }),
    ],
  })

/** Session-validated caller, or throws. Every sync function goes through this. */
export async function requireUserId(ctx: GenericCtx<DataModel>): Promise<string> {
  const user = await authComponent.getAuthUser(ctx)
  return user._id
}

export const getCurrentUser = query({
  args: {},
  handler: async (ctx) => authComponent.safeGetAuthUser(ctx),
})

/**
 * Delete and regenerate the JWT signing keys. Run this once after changing
 * BETTER_AUTH_SECRET — the stored private key is encrypted with the secret,
 * so a new secret makes every /convex/token call 500 until the keys rotate:
 *
 *   npx convex run auth:rotateKeys
 *
 * Sessions survive; devices just mint fresh JWTs on their next sync.
 */
export const rotateKeys = internalAction({
  args: {},
  handler: async (ctx) => {
    await createAuth(ctx).api.rotateKeys()
    return 'rotated'
  },
})
