# Gym Zero

Local-first gym workout + food tracker built for LA Fitness training: routine-based
set logging with previous weights pre-filled, machine QR scanning that resolves to
the equipment's official instruction video (e.g. Life Fitness YouTube), and simple
calories/protein food tracking. Everything persists in IndexedDB — no account, no
server, works offline.

## App (`app/`)

Vite + React + TypeScript. Data layer is Dexie (IndexedDB) behind the `DataAPI`
contract in `src/types.ts`; UI screens live in `src/screens/`.

```bash
cd app
npm install
npm run dev          # then open on your phone via the LAN url vite prints
npm run typecheck
npm run build
npm run dev -- --port 5199   # in one terminal…
npm run e2e                  # …e2e flow test in another (needs playwright chromium cache)
```

## Sync (self-hosted Convex)

Optional: a self-hosted Convex backend keeps the durable copy of personal data
and syncs it across devices (Dexie stays the offline store the UI reads; a
replication layer in `app/src/data/sync.ts` pushes/pulls with last-write-wins).
Build the app with `VITE_CONVEX_URL` set to enable it; without it the app is
identical to the local-only build. Server functions live in `app/convex/`.
Production runs from the single `docker-compose.yml` at the repo root (app +
Convex backend + dashboard + function deploy job) — see `DEPLOY.md`.

### Production environment setup

Set the production Convex environment variables from the repository root. Keep
the private key and JWKS values quoted so their complete multiline/JSON values
are passed unchanged:

```bash
pnpm prod:env set SITE_URL https://fin.baxcajay.cc
pnpm prod:env set -- JWT_PRIVATE_KEY "PASTE_THE_COMPLETE_PRIVATE_KEY"
pnpm prod:env set JWKS 'PASTE_THE_COMPLETE_JWKS_JSON'
pnpm prod:env set FIN_API_ALLOWED_ORIGINS https://fin.baxcajay.cc
```

For a self-hosted deployment, open a terminal in the Convex backend container
and generate its admin key:

```bash
cd /convex
./generate_admin_key.sh
```

Save the generated key as `CONVEX_SELF_HOSTED_ADMIN_KEY`, then redeploy so the
Convex functions are pushed. See `DEPLOY.md` for the complete deployment flow.
