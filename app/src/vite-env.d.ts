/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Self-hosted Convex deployment URL (e.g. https://convex.example.com). Unset = local-only mode. */
  readonly VITE_CONVEX_URL?: string
  /** Convex site origin serving /api/auth/* (e.g. https://convex-site.example.com). Required for sync. */
  readonly VITE_CONVEX_SITE_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
