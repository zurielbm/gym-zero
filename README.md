# Gym Zero

Local-first gym workout + food tracker built for LA Fitness training: routine-based
set logging with previous weights pre-filled, machine QR scanning that resolves to
the equipment's official instruction video (e.g. Life Fitness YouTube), and simple
calories/protein food tracking. Everything persists in IndexedDB — no account, no
server, works offline.

## Docs

- `gym_tracker_app_plan_qr_updated.html` — full app plan (architecture, data model, roadmap)
- `gym_app_mock_ui.html` — interactive mock UI the app was built from
  (published: https://pages.subir.dev/67af9fe3-f4d8-4e61-b4dc-53a9194549e5/)
- `app/BACKEND_SPEC.md` — spec the data layer was implemented against

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

Status vs the roadmap: Phase 1 (local workout engine: routines, set logger with
prev-performance, QR scan → machine mapping → instruction video, favorites, history)
and Phase 2 (local food engine: calories/protein, saved meals, quick add) are done.
Phase 3 (P2P sync), Phase 4 (Convex community layer), and Phase 5 (identity/polish)
are not started.

Camera QR scanning uses BarcodeDetector with a jsQR fallback and needs HTTPS or
localhost; there's always a manual "paste the QR link" fallback on the scan screen.

## Sync (self-hosted Convex)

Optional: a self-hosted Convex backend keeps the durable copy of personal data
and syncs it across devices (Dexie stays the offline store the UI reads; a
replication layer in `app/src/data/sync.ts` pushes/pulls with last-write-wins).
Build the app with `VITE_CONVEX_URL` set to enable it; without it the app is
identical to the local-only build. Server functions live in `app/convex/`.
Production runs from the single `docker-compose.yml` at the repo root (app +
Convex backend + dashboard + function deploy job) — see `DEPLOY.md`.
