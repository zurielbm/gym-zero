import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { AuthScreen } from './screens/Auth'
import { currentUser } from './data/auth-store'
import { initSync, syncConfigured } from './data/sync'
import './styles.css'

// With a sync server configured, the app is account-scoped: gate everything
// behind login so the local database opens under the right account (db.ts).
// Local-only builds (no server) skip auth entirely, as before.
const gated = syncConfigured && !currentUser()

if (!gated) initSync()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {gated ? <AuthScreen /> : <App />}
  </StrictMode>,
)
