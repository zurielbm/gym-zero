import { createAuthClient } from 'better-auth/react'
import { convexClient, crossDomainClient } from '@convex-dev/better-auth/client/plugins'
import { clearCurrentUser, setCurrentUser } from '../data/auth-store'

/**
 * Better Auth client against the Convex site origin (where convex/http.ts
 * serves /api/auth/*). The crossDomain plugin keeps the session working even
 * though the app and the auth server live on different domains.
 */
export const authClient = createAuthClient({
  baseURL: import.meta.env.VITE_CONVEX_SITE_URL,
  plugins: [convexClient(), crossDomainClient()],
})

/** Sign in, remember the account for offline boots, and restart the app on it. */
export async function signIn(email: string, password: string): Promise<never> {
  const { data, error } = await authClient.signIn.email({ email, password })
  if (error || !data) throw new Error(error?.message ?? 'Sign-in failed.')
  setCurrentUser({ id: data.user.id, name: data.user.name, email: data.user.email })
  window.location.reload()
  return new Promise(() => {}) // reloading; never resolves
}

/** Create an account. The family invite code travels as a header the server hook checks. */
export async function signUp(name: string, email: string, password: string, inviteCode: string): Promise<never> {
  const { data, error } = await authClient.signUp.email({
    name, email, password,
    fetchOptions: { headers: { 'x-invite-code': inviteCode } },
  })
  if (error || !data) throw new Error(error?.message ?? 'Sign-up failed.')
  setCurrentUser({ id: data.user.id, name: data.user.name, email: data.user.email })
  window.location.reload()
  return new Promise(() => {})
}

/** End the session (best effort if offline) and return to the login screen. */
export async function signOut() {
  try {
    await authClient.signOut()
  } catch {
    // offline — the server session expires on its own; local state still clears
  }
  clearCurrentUser()
  window.location.reload()
}
