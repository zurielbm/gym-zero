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

## AI assist (CLIProxyAPI)

Optional: describe food in plain words to log calories/macros, and identify
unknown machine QR codes (model, muscle groups, setup + form cues), powered by
a self-hosted [CLIProxyAPI](https://github.com/router-for-me/CLIProxyAPI)
(OpenAI-compatible) endpoint. The phone calls the proxy **directly**, so AI
works only while the device can reach it (e.g. on the Tailscale tailnet). Each AI
screen shows whether the connection is ready, checking, or unavailable. You can
retry the connection or try a request directly; manual entry stays available.
Machine identifications are cached per QR code in the `machineAi` table (synced
like everything else), and can be revised using the guide’s correction field.

Setup:

1. The app is served over HTTPS, so the proxy must be too or the browser blocks
   the calls as mixed content. On the proxy host:
   `tailscale serve --bg --https=443 localhost:8317`
2. In the app: **Stats tab → AI assist card** → enter the `https://….ts.net`
   endpoint, API key, and model id → **Test & save**. The proxy's CORS config
   must allow the app's origin.

### Starter programs

Saving a new machine also generates a beginner **starter program** for it
(sets × reps, a guess-labeled starting weight with a plain-words effort check,
rest time, and a progression rule), cached in the synced `aiPrograms` table.
The set logger pre-fills empty rows from the program until real history exists —
after that, previous performance always wins. Programs are sized by the
**training profile** (Stats tab: experience, goal, days/week, session length,
optional age/sex, limitations); with no profile, the machine screen shows a
one-time two-question quick setup with a skip option.

## Sync (self-hosted Convex)

Optional: a self-hosted Convex backend keeps the durable copy of personal data
and syncs it across devices (Dexie stays the offline store the UI reads; a
replication layer in `app/src/data/sync.ts` pushes/pulls with last-write-wins).
Build the app with `VITE_CONVEX_URL` set to enable it; without it the app is
identical to the local-only build. Server functions live in `app/convex/`.
Production runs from the single `docker-compose.yml` at the repo root (app +
Convex backend + dashboard + function deploy job) — see `DEPLOY.md`.

### Production environment setup

There are two separate sets of variables:

1. **Dokploy/Compose variables** configure and connect the containers.
2. **Convex deployment variables** are stored in Convex and are read by the
   functions in `app/convex/`. Adding them only to Dokploy is not sufficient.

For the current production domains, set these in Dokploy's **Environment** tab:

```bash
VITE_CONVEX_URL=https://convex.domain.com
VITE_CONVEX_SITE_URL=https://convex-site.domain.com
CONVEX_CLOUD_ORIGIN=https://convex.domain.com
CONVEX_SITE_ORIGIN=https://convex-site.domain.com
NEXT_PUBLIC_DEPLOYMENT_URL=https://convex.domain.com

INSTANCE_NAME=gym-tracker
INSTANCE_SECRET=PASTE_A_VALUE_FROM_OPENSSL_RAND_HEX_32
CONVEX_SELF_HOSTED_ADMIN_KEY=
```

Generate `INSTANCE_SECRET` locally with `openssl rand -hex 32`. Deploy once with
`CONVEX_SELF_HOSTED_ADMIN_KEY` empty. The `convex-deploy` container will exit
after reporting that it skipped the function deploy; this is expected.

#### 1. Generate the Convex admin key

In Dokploy, open a terminal for the running **`backend`** container (not the
exited `convex-deploy` container), then run:

```bash
cd /convex
./generate_admin_key.sh
```

Copy the complete result into Dokploy as `CONVEX_SELF_HOSTED_ADMIN_KEY`, save,
and redeploy the Compose application. The one-shot `convex-deploy` service now
uploads `app/convex/` and exits again. An exited `convex-deploy` container is
normal; check its logs to distinguish a successful exit from an error.

The same admin key unlocks `https://dashboard.domain.com`. If prompted, use:

```text
Deployment URL: https://convex.domain.com
Admin key: the complete key generated above
```

Never commit the admin key or put it in a `VITE_*`/`NEXT_PUBLIC_*` variable.

#### 2. Configure Better Auth inside Convex

In the Convex dashboard, open **Deployment Settings → Environment Variables**
and add these three variables:

| Name | Where the value comes from |
|---|---|
| `SITE_URL` | The public app origin: `https://fin.domain.com` (no trailing slash) |
| `BETTER_AUTH_SECRET` | Generate once with `openssl rand -base64 32` |
| `INVITE_CODE` | Choose a private code that family members enter when signing up |

Do not rotate `BETTER_AUTH_SECRET` casually; existing encrypted auth state and
sessions depend on it. If `INVITE_CODE` is absent, new account registration is
intentionally disabled.

Alternatively, set the same values with the Convex CLI from a local checkout:

```bash
cd app

export CONVEX_SELF_HOSTED_URL=https://convex.domain.com
export CONVEX_SELF_HOSTED_ADMIN_KEY='PASTE_THE_COMPLETE_ADMIN_KEY'

npx convex env set SITE_URL https://fin.domain.com
npx convex env set BETTER_AUTH_SECRET "$(openssl rand -base64 32)"
npx convex env set INVITE_CODE 'CHOOSE_A_PRIVATE_INVITE_CODE'
npx convex env list
```

These are Convex deployment variables. They should not be added to the normal
Dokploy container environment instead of setting them through the dashboard or
CLI.

#### 3. JWKS and JWT keys

This project uses `@convex-dev/better-auth`, not `@convex-dev/auth`. It does
**not** require manually generated `JWT_PRIVATE_KEY` or `JWKS` environment
variables. Better Auth creates and stores its signing key in its Convex
component tables, keeps the private key server-side, and publishes the public
JWKS automatically at:

```text
https://convex-site.domain.com/api/auth/convex/jwks
```

A successful response looks like `{"keys":[...]}`. `FIN_API_ALLOWED_ORIGINS`
is also not used by this repository; `SITE_URL` supplies the trusted frontend
origin. The code deliberately uses dynamic JWKS in
`app/convex/auth.config.ts`, so do not copy instructions for static JWKS from a
different Convex Auth setup.

#### 4. Dokploy domain routing

Dokploy's domain form needs the container's internal port, not the published
host port:

| Host | Service | Container port |
|---|---|---:|
| `fin.domain.com` | `app` | 80 |
| `convex.domain.com` | `backend` | 3210 |
| `convex-site.domain.com` | `backend` | 3211 |
| `dashboard.domain.com` | `dashboard` | 6791 |

Use `/` as the internal path. Do not assign a domain to `convex-deploy`.
Redeploy the Compose application after changing a Dokploy domain. See
`DEPLOY.md` for the rest of the deployment flow.

## Mobile quality-of-life checks

AI requests show elapsed time, automatic retry status, cancellation, and recoverable errors.
Food review always includes a correction box; text and photo corrections include manual edits.
Machine guides and starter programs accept feedback, and programs stay separate by machine and exercise.
Food and workout drafts survive tab navigation in the current app session (not a reload).
Food/drink additions and deletions offer undo; linked nutrition/hydration updates commit together.
Rest timers continue across tabs, support adding 30 seconds, and announce completion.

From `app/`, with the dev server running:

```bash
npx playwright-core install chromium
BASE_URL=http://localhost:5173 npm run e2e:qol
BASE_URL=http://localhost:5173 npm run e2e:machine-ai
BASE_URL=http://localhost:5173 npm run e2e
```

The AI checks use deterministic proxy responses, including failed, delayed, and malformed
responses. They do not validate a live proxy, model quality, or real-device camera permissions.
The QoL suite saves screenshots under `app/e2e/qol-audit/` and checks 320, 375, 390, 430,
and 1280px layouts. Existing walkthrough scripts now exit unsuccessfully when a step fails.


## Multi-use machines and muscle maps

Save one physical station with every supported exercise, then choose a movement on its
page. Choices show the movement, target muscles, and progress in the active routine.
An explicit exercise opened from the workout is preserved; otherwise the next unfinished
routine movement on that station is selected, then the last used movement, then the default.
Previewing does not write sets or change the remembered choice. Opening an exercise for
logging saves `lastExerciseId`; each logged set retains its exercise and machine ids.
AI programs remain keyed by machine + exercise. Multi-use stations do not automatically
generate a program for the first exercise when first saved.

Front/back SVG muscle maps run offline for all 24 built-in exercises, including Hip
Adductor for dual inner/outer-thigh stations. Lime marks main groups, blue marks assisting
groups, and text labels provide the same information. Maps are schematic general guidance,
not effort percentages or personalized advice. Unknown/custom exercises fall back to their
saved muscle groups without inventing a main/assisting ranking. Previews are available on
machine setup/editing, saved machines, routine editing, and the workout screen.

Machine-wide seat/notes remain shared. History and strength baselines are grouped by
exercise across stations. Removing a supported exercise preserves past sets and AI programs.
Partial machine writes merge within a local transaction to preserve unrelated changes.

With the dev server running, from `app/`:

```bash
BASE_URL=http://localhost:5173 npm run e2e:machine-muscles
```

This suite checks routine choice, map regions, remembering versus previewing, linked set
identity, partial writes, preserved history, catalog coverage, and 320–1280px layouts.


## Rest chime and saved-set corrections

Rest completion plays one short, low-level two-note sine chime (523/659Hz with a soft
attack and fade). Settings → Rest timer sound includes a persistent on/off switch and
a preview. Existing settings default to sound on. A user tap/key press primes Web Audio
before asynchronous saves; unavailable audio never blocks workout logging. Skip is silent,
and the current sound preference is read when rest completes. Device media volume applies;
a locked phone or suspended/background browser may prevent timely playback.

Use Edit set beneath a logged set, or Stats → Review / edit sets for a finished workout.
Reps and weight can be corrected without adding a set or restarting rest. Changed sets
retain an Edited label, the latest correction time, and the original weight/reps (visible
in the editor). This is an original/latest record, not a full revision history. No-op
saves do not mark a set edited. Original IDs, exercise/machine links, set number, logging
time, and workout finish time are preserved. Summary totals/highlights are recalculated;
a baseline derived from a corrected set is recalculated to avoid stale strength targets.
Atomic validation rejects invalid or stale edits. Optional fields are included in existing
backups and sync records; older sets work without migration.

From `app/`, with the dev server running:

```bash
BASE_URL=http://localhost:5173 npm run e2e:rest-edits
```

The suite checks real browser audio scheduling, skip/mute behavior, edits during/after
workouts, validation, duplicate taps, preserved identity/duration, baseline corrections,
backups, and mobile layouts. It renders the same audio graph into a WAV for preview and
checks its peak amplitude and silent tail. Hardware speaker loudness and locked-phone
playback still depend on the device/browser.
