/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Self-hosted Convex deployment URL (e.g. https://convex.example.com). Unset = local-only mode. */
  readonly VITE_CONVEX_URL?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
