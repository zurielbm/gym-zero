import { getAuthConfigProvider } from '@convex-dev/better-auth/auth-config'
import type { AuthConfig } from 'convex/server'

// JWTs are issued and verified by this deployment itself (the Better Auth
// component serves the JWKS on the site origin), so no external service exists.
export default {
  providers: [getAuthConfigProvider()],
} satisfies AuthConfig
