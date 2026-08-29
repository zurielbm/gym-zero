import { createClient, type GenericCtx } from '@convex-dev/better-auth'
import { convex, crossDomain } from '@convex-dev/better-auth/plugins'
import { betterAuth } from 'better-auth/minimal'
import { APIError, createAuthMiddleware } from 'better-auth/api'
import { components } from './_generated/api'
import type { DataModel } from './_generated/dataModel'
import { query } from './_generated/server'
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
      // Family-only signups: the client sends the shared invite code in a
      // header (see enableSignUp in src/lib/auth-client.ts). No INVITE_CODE
      // env var means signups are closed entirely.
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path !== '/sign-up/email') return
        const expected = process.env.INVITE_CODE
        if (!expected) {
          throw new APIError('FORBIDDEN', { message: 'Sign-ups are disabled on this server.' })
        }
        if (ctx.headers?.get('x-invite-code') !== expected) {
          throw new APIError('FORBIDDEN', { message: 'Invalid invite code.' })
        }
      }),
    },
    plugins: [crossDomain({ siteUrl }), convex({ authConfig })],
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
