import { httpRouter } from 'convex/server'
import { authComponent, createAuth } from './auth'

const http = httpRouter()

// Serves /api/auth/* (sign-in, sign-up, session, JWT + JWKS) on the site
// origin. CORS is required because the app is on a different domain; the
// invite-code header rides along with sign-up requests.
authComponent.registerRoutes(http, createAuth, {
  cors: { allowedHeaders: ['x-invite-code'] },
})

export default http
