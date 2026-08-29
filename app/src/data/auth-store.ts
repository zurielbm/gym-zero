/**
 * The signed-in account, cached in localStorage so the app can boot offline
 * and the local database can be named synchronously at module load. Written
 * only on sign-in/sign-up and cleared on sign-out — both reload the page, so
 * everything downstream (Dexie instance, sync loop) reads it once at startup.
 *
 * No imports here: db.ts and sync.ts both depend on this module.
 */

const AUTH_USER_LS = 'gym.auth.user'

export interface AuthUser {
  id: string
  name: string
  email: string
}

export function currentUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(AUTH_USER_LS)
    return raw ? (JSON.parse(raw) as AuthUser) : null
  } catch {
    return null
  }
}

export function setCurrentUser(user: AuthUser) {
  localStorage.setItem(AUTH_USER_LS, JSON.stringify(user))
}

export function clearCurrentUser() {
  localStorage.removeItem(AUTH_USER_LS)
}
