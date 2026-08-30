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

   `VITE_CONVEX_URL` / `CONVEX_CLOUD_ORIGIN` must both be the public
   `https://convex.…` URL, and `VITE_CONVEX_SITE_URL` / `CONVEX_SITE_ORIGIN`
   must both be the public `https://convex-site.…` URL (it serves the
   `/api/auth/*` login endpoints).
4. **First deploy** — comes up with no functions yet; the `convex-deploy`
   service logs that it skipped (no admin key).
5. **Mint the admin key** (terminal into the backend container):
   ```bash
   ./generate_admin_key.sh
   ```
6. Paste the key into `CONVEX_SELF_HOSTED_ADMIN_KEY` and **redeploy**.
   `convex-deploy` now pushes `app/convex/` automatically — and re-pushes on
   every future redeploy, so function changes ship with normal deploys.
7. **Auth env vars** (once, from any machine with the repo checked out —
   they live inside the Convex deployment, not in compose):
   ```bash
   cd app
   export CONVEX_SELF_HOSTED_URL=https://convex.example.com
   export CONVEX_SELF_HOSTED_ADMIN_KEY='<the admin key>'
   npx convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
   npx convex env set SITE_URL https://gym.example.com
   npx convex env set INVITE_CODE <something you text the family>
   ```
   Sign-ups are refused until `INVITE_CODE` is set, and refused with any code
   that doesn't match it. Rotate or unset it any time to close the door.

   ⚠️ Set `BETTER_AUTH_SECRET` **before the first sign-in**. The JWT signing
   key is created on first sign-in and encrypted with the secret — setting or
   changing the secret afterwards makes every token request fail with
   `Auth server error (500)` (log: "Failed to decrypt private key"). Recover
   with a one-time key rotation (sessions survive; devices mint fresh tokens
   on their next sync):
   ```bash
   npx convex run auth:rotateKeys
   ```

## Accounts

Everyone gets their own account: open the app → **Create account** → name,
email, password, and the family invite code. Each account's data is fully
separate (enforced server-side per authenticated user) and syncs automatically
across that person's devices — no passphrase step anymore.

- **Existing passphrase data** is adopted automatically: the first sign-in on
  a device that used passphrase sync claims that profile's server rows into
  the account. On a brand-new device, use **Stats → Account → Claim old data**
  and enter the old passphrase once.
- **Forgot password**: there's no email reset (nothing sends mail); reset the
  user via the Convex dashboard, or delete the user row and have them re-sign-up
  with the invite code (their data re-links by claiming — keep a backup first).

## Self-hosted food database (optional)

Barcode scans work out of the box against the free public Open Food Facts
API — nothing to configure. If you'd rather serve lookups from your own copy
of the database (no rate limits, no dependence on their servers), enable the
`off-db` sidecar:

1. **Enable the service** — it's behind a compose profile so normal deploys
   don't pull a ~1 GB download:
   ```bash
   docker compose --profile off-db up -d --build off-db
   ```
   In Dokploy, set `COMPOSE_PROFILES=off-db` in the environment instead and
   redeploy. Optional: `OFF_DB_PORT` (default 8321).
2. **Wait for the import** (first boot only). The container downloads the
   official Open Food Facts CSV export and imports it into SQLite in the
   `off-db-data` volume — typically 10–20 minutes. Watch it:
   ```bash
   docker compose logs -f off-db     # "... products imported" progress lines
   curl localhost:8321/meta          # {"status":"importing", ...} → {"status":"ready", ...}
   ```
   Already have the export downloaded? Mount it and point `OFF_CSV_FILE` at
   it to skip the download.
3. **Point the app at it**: Settings → **Food database** → *Self-hosted* →
   enter the server address → **Test & save**. It shows the export date and
   product count when connected. If the app is served over HTTPS the sidecar
   needs an https:// address too (mixed content) — give it a domain the same
   way as the other services.
4. **Refreshing**: OFF publishes new exports daily. Re-import any time with:
   ```bash
   FORCE_REIMPORT=1 docker compose --profile off-db up -d --force-recreate off-db
   ```
   (then recreate once more without the variable so a later restart doesn't
   re-import again). The app nudges you in Settings when the export is more
   than ~6 months old.

If the sidecar is down, still importing, or doesn't know a product, scans
silently fall back to the public API — it can only make things better, never
break scanning.

## Notes

- Durable state lives in the `convex-data` volume — back it up like a database.
- Rebuilding with a different `VITE_CONVEX_URL` is required if the backend
  domain ever changes (it's baked into the static bundle at build time).
- Local smoke test of this exact stack:
  `cp .env.example .env`, set `VITE_CONVEX_URL=http://127.0.0.1:3210`,
  `VITE_CONVEX_SITE_URL=http://127.0.0.1:3211`, matching `CONVEX_*_ORIGIN`
  values, and a random `INSTANCE_SECRET`, then `docker compose up -d --build`,
  mint the key, fill it in, `docker compose up -d convex-deploy`, set the auth
  env vars (step 7, with `SITE_URL=http://localhost:8080`), rebuild the app
  (`docker compose up -d --build app`), and open `http://localhost:8080`.
