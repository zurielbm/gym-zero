# Deploying Gym Zero (single compose file)

Everything — the app, the self-hosted Convex backend that keeps the durable
copy of your data, the Convex dashboard, and a one-shot job that deploys the
Convex functions — runs from the one `docker-compose.yml` at the repo root.

The app stays offline-first: the browser's IndexedDB is what the UI reads, and
the sync layer replicates writes to/from the backend (see `app/src/data/sync.ts`).

## Dokploy setup

1. **Create a Compose application** pointing at this repo, compose path
   `docker-compose.yml`.
2. **Environment**: copy `.env.example` into Dokploy's env editor and fill it
   in. Generate `INSTANCE_SECRET` with `openssl rand -hex 32`. Leave
   `CONVEX_SELF_HOSTED_ADMIN_KEY` empty for now.
3. **Domains** (all with HTTPS — required for camera scanning, passphrase
   hashing, and the app↔backend connection):
   | domain | service : port |
   |---|---|
   | `gym.example.com` | app, `APP_PORT` (default 8080 → container 80) |
   | `convex.example.com` | backend, `CONVEX_PORT` (3210) |
   | `convex-site.example.com` | backend, `CONVEX_SITE_PROXY_PORT` (3211) |
   | dashboard (optional, keep private) | dashboard, `DASHBOARD_PORT` (6791) |

   `VITE_CONVEX_URL` and `CONVEX_CLOUD_ORIGIN` must both be the public
   `https://convex.…` URL.
4. **First deploy** — comes up with no functions yet; the `convex-deploy`
   service logs that it skipped (no admin key).
5. **Mint the admin key** (terminal into the backend container):
   ```bash
   ./generate_admin_key.sh
   ```
6. Paste the key into `CONVEX_SELF_HOSTED_ADMIN_KEY` and **redeploy**.
   `convex-deploy` now pushes `app/convex/` automatically — and re-pushes on
   every future redeploy, so function changes ship with normal deploys.

## Connect your devices

On each device: open the app → **Stats → Sync** → same passphrase everywhere →
Connect. The passphrase never leaves the device (only its SHA-256 hash does)
and is the sole credential for the profile — pick a strong one. Merge rule when
enabling: rows on both sides adopt the server version, local-only rows push up.

## Notes

- Durable state lives in the `convex-data` volume — back it up like a database.
- Rebuilding with a different `VITE_CONVEX_URL` is required if the backend
  domain ever changes (it's baked into the static bundle at build time).
- Local smoke test of this exact stack:
  `cp .env.example .env`, set `VITE_CONVEX_URL=http://127.0.0.1:3210` and a
  random `INSTANCE_SECRET`, then `docker compose up -d --build`, mint the key,
  fill it in, `docker compose up -d convex-deploy`, and open
  `http://localhost:8080`.
