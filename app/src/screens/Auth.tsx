import { useState } from 'react'
import { signIn, signUp } from '../lib/auth-client'

/**
 * Login gate shown instead of the app when a sync server is configured and
 * nobody is signed in. Success reloads the page with the account remembered
 * (see lib/auth-client.ts), so the whole app boots under that account's
 * local database.
 */
export function AuthScreen() {
  const [mode, setMode] = useState<'signin' | 'signup'>('signin')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [invite, setInvite] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const canSubmit = email.trim() && password &&
    (mode === 'signin' || (name.trim() && invite.trim()))

  const submit = async () => {
    if (!canSubmit || busy) return
    setBusy(true)
    setErr(null)
    try {
      if (mode === 'signin') await signIn(email.trim(), password)
      else await signUp(name.trim(), email.trim(), password, invite.trim())
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setBusy(false)
    }
  }

  const field = (label: string, input: React.ReactNode) => (
    <div style={{ marginTop: 14 }}>
      <span className="lab" style={{ display: 'block', marginBottom: 5 }}>{label}</span>
      {input}
    </div>
  )
  const onEnter = (e: React.KeyboardEvent) => { if (e.key === 'Enter') void submit() }

  return (
    <div className="shell" style={{ alignItems: 'center', justifyContent: 'center', overflowY: 'auto' }}>
      <div style={{ width: 'min(360px, 92vw)', padding: '32px 0' }}>
        {mode === 'signin' ? (
          <>
            <h1 className="p-h1">Gym Zero<span className="dot">.</span></h1>
            <span className="small" style={{ display: 'block', margin: '6px 0 10px' }}>
              Sign in to sync your training.
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

        {mode === 'signup' && field('Name', (
          <input className="text-in" autoComplete="name" placeholder="Mom" value={name}
            onChange={(e) => setName(e.target.value)} onKeyDown={onEnter} />
        ))}
        {field('Email', (
          <input className="text-in" type="email" autoComplete="email" placeholder="you@family.com" value={email}
            onChange={(e) => setEmail(e.target.value)} onKeyDown={onEnter} />
        ))}
        {field('Password', (
          <input className="text-in" type="password"
            autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
            placeholder="••••••••" value={password}
            onChange={(e) => setPassword(e.target.value)} onKeyDown={onEnter} />
        ))}
        {mode === 'signup' && field('Invite code', (
          <input className="text-in" placeholder="From Zuriel" value={invite}
            onChange={(e) => setInvite(e.target.value)} onKeyDown={onEnter} />
        ))}

        {err && <span className="small" style={{ color: 'var(--danger)', display: 'block', marginTop: 10 }}>{err}</span>}

        <button className="big-btn" style={{ width: '100%', marginTop: 22 }} disabled={!canSubmit || busy} onClick={() => void submit()}>
          {busy ? '…' : mode === 'signin' ? 'Sign in' : 'Create account'}
        </button>
        <button
          className="ghost-btn" style={{ width: '100%', marginTop: 10 }}
          onClick={() => { setErr(null); setMode(mode === 'signin' ? 'signup' : 'signin') }}
        >
          {mode === 'signin' ? 'New here? Create account' : 'Have an account? Sign in'}
        </button>
      </div>
    </div>
  )
}
