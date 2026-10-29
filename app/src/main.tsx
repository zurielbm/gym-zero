import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { FeedbackProvider } from './components/Feedback'
import { AuthScreen } from './screens/Auth'
import { currentUser } from './data/auth-store'
import { initSync, syncConfigured } from './data/sync'
import { clearInvitationFromUrl, invitationFromUrl } from './lib/invitation-link'
import { signOut } from './lib/auth-client'
import './styles.css'

// With a sync server configured, the app is account-scoped: gate everything
// behind login so the local database opens under the right account (db.ts).
// Local-only builds (no server) skip auth entirely, as before.
const gated = syncConfigured && !currentUser()

if (!gated) initSync()

function Entry() {
  const [hasInvitation, setHasInvitation] = useState(() => invitationFromUrl(window.location.href) !== null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  if (gated) return <AuthScreen />
  if (syncConfigured && hasInvitation && currentUser()) return (
    <div className="shell" style={{ alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div className="card" style={{ maxWidth: 400 }}>
        <h1 className="p-h1">You’re signed in<span className="dot">.</span></h1>
        <p className="small">You’re using {currentUser()!.email}. This invitation is for creating a separate private account.</p>
        <button className="big-btn" disabled={busy} onClick={() => {
          clearInvitationFromUrl(); setHasInvitation(false)
        }}>Continue with my account</button>
        <button className="ghost-btn" style={{ marginTop: 10 }} disabled={busy} onClick={() => {
          setBusy(true)
          void signOut().catch(() => { setBusy(false); setError('Could not sign out. Please try again.') })
        }}>{busy ? 'Signing out…' : 'Sign out to create an account'}</button>
        {error && <p className="small" role="alert">{error}</p>}
      </div>
    </div>
  )
  return <App />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <FeedbackProvider><Entry /></FeedbackProvider>
  </StrictMode>,
)
