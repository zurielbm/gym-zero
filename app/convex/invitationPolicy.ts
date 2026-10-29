export const INVITATION_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000

export function isInvitationActive(invite: { expiresAt: number; revokedAt?: number } | null, now: number): boolean {
  return !!invite && invite.revokedAt === undefined && invite.expiresAt > now
}

export async function hashInvitationToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

export function validInvitationToken(token: string): boolean {
  return /^[a-f0-9]{64}$/.test(token)
}
