import { useState } from 'react'
import { signIn, signUp } from '../lib/auth-client'
import { clearInvitationFromUrl, invitationFromUrl } from '../lib/invitation-link'

/**
 * Login gate shown instead of the app when a sync server is configured and
 * nobody is signed in. Success reloads the page with the account remembered
 * (see lib/auth-client.ts), so the whole app boots under that account's
 * local database.
 *
 * An invite link (#invite=… in the URL) opens straight into signup and hides
 * the family code; the server checks the token only when the account is created.
 */
export function AuthScreen() {
  // null = no invite link. An empty or malformed token still counts as a link,
  // so we never silently fall back to the family code.
  const [inviteToken, setInviteToken] = useState<string | null>(() => invitationFromUrl(window.location.href))
  const [mode, setMode] = useState<'signin' | 'signup'>(() => (inviteToken !== null ? 'signup' : 'signin'))
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [invite, setInvite] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const invited = mode === 'signup' && inviteToken !== null

  const canSubmit = email.trim() && password &&
    (mode === 'signin' || (name.trim() && (invited || invite.trim())))

  const submit = async () => {
    if (!canSubmit || busy) return
    setBusy(true)
    setErr(null)
    try {
      if (mode === 'signin') await signIn(email.trim(), password)
      else if (inviteToken !== null) await signUp(name.trim(), email.trim(), password, '', inviteToken)
      else await signUp(name.trim(), email.trim(), password, invite.trim())
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  const discardInvite = () => {
    clearInvitationFromUrl()
    setInviteToken(null)
    setErr(null)
  }

  const field = (id: string, label: string, input: React.ReactNode, hint?: string) => (
    <div style={{ marginTop: 14 }}>
      <label className="lab" htmlFor={id} style={{ display: 'block', marginBottom: 5 }}>{label}</label>
      {input}
      {hint && <span className="small" id={`${id}-hint`} style={{ display: 'block', marginTop: 5 }}>{hint}</span>}
    </div>
  )

  return (
    <div className="shell" style={{ alignItems: 'center', justifyContent: 'center', overflowY: 'auto' }}>
      <form
        style={{ width: 'min(360px, 92vw)', padding: '32px 0' }}
        aria-busy={busy}
        onSubmit={(e) => { e.preventDefault(); void submit() }}
      >
        {mode === 'signin' ? (
          <>
            <h1 className="p-h1">Gym Zero<span className="dot">.</span></h1>
            <span className="small" style={{ display: 'block', margin: '6px 0 10px' }}>
              Sign in to sync your training.
            </span>
          </>
        ) : invited ? (
          <>
            <h1 className="p-h1">You’re invited<span className="dot">.</span></h1>
            <span className="small" style={{ display: 'block', margin: '6px 0 10px', lineHeight: 1.45 }}>
              Create your own private Gym Zero account. Your workouts, food and progress are yours alone. The person who invited you can’t see them.
            </span>
          </>
        ) : (
          <>
            <h1 className="p-h1">Join the family<span className="dot">.</span></h1>
            <span className="small" style={{ display: 'block', margin: '6px 0 10px' }}>
              You need the family invite code.
            </span>
          </>
        )}

        {mode === 'signup' && field('auth-name', 'Name', (
          <input id="auth-name" className="text-in" autoComplete="name" required
            placeholder={invited ? 'Your name' : 'Mom'} value={name}
            onChange={(e) => setName(e.target.value)} />
        ))}
        {field('auth-email', 'Email', (
          <input id="auth-email" className="text-in" type="email" autoComplete="email" required
            autoCapitalize="off" autoCorrect="off" spellCheck={false}
            placeholder={invited ? 'you@example.com' : 'you@family.com'} value={email}
            onChange={(e) => setEmail(e.target.value)} />
        ))}
        {field('auth-password', 'Password', (
          <input id="auth-password" className="text-in" type="password" required
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            minLength={mode === 'signup' ? 8 : undefined}
            aria-describedby={mode === 'signup' ? 'auth-password-hint' : undefined}
            placeholder="••••••••" value={password}
            onChange={(e) => setPassword(e.target.value)} />
        ), mode === 'signup' ? 'At least 8 characters.' : undefined)}
        {mode === 'signup' && !invited && field('auth-invite', 'Invite code', (
          <input id="auth-invite" className="text-in" required autoCapitalize="off" autoCorrect="off"
            placeholder="From Zuriel" value={invite}
            onChange={(e) => setInvite(e.target.value)} />
        ))}

        {err && <span className="small" role="alert" style={{ color: 'var(--danger)', display: 'block', marginTop: 10 }}>{err}</span>}

        <button type="submit" className="big-btn" style={{ width: '100%', marginTop: 22 }} disabled={!canSubmit || busy}>
          {busy ? '…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
        {invited && (
          <button type="button" className="ghost-btn" style={{ width: '100%', marginTop: 10 }} disabled={busy} onClick={discardInvite}>
            Use an invite code instead
          </button>
        )}
        <button
          type="button" className="ghost-btn" style={{ width: '100%', marginTop: 10 }} disabled={busy}
          onClick={() => { setErr(null); setMode(mode === 'signin' ? 'signup' : 'signin') }}
        >
          {mode === 'signin' ? 'New here? Create account' : 'Have an account? Sign in'}
        </button>
      </form>
    </div>
  )
}
