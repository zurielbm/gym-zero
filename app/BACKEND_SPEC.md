# Backend / data-layer spec (src/data)

Goal: replace the placeholder in-memory implementation in `src/data/index.ts` with a
**persistent, local-first IndexedDB implementation using Dexie 4** (already in
package.json). The app is a gym workout + food tracker; everything is offline, no
server, no auth.

## Hard constraints

- **Only create/modify files under `app/src/data/`.** Do not touch `src/types.ts`,
  screens, components, styles, or configs. If the contract in `src/types.ts` needs a
  change, do NOT change it — list the proposed change in your final report instead.
- `src/data/index.ts` must keep exporting: `api` (a `DataAPI`), `normalizeQrUrl`,
  and `default api`. The UI imports exactly these.
- TypeScript strict mode must pass for everything under `src/data/`
  (`npx tsc --noEmit` from `app/`; ignore errors reported in files outside `src/data/`).
- Use `crypto.randomUUID()` for ids. No new dependencies.

## Reference semantics

The current placeholder `src/data/index.ts` is the reference implementation of the
`DataAPI` contract defined in `src/types.ts`. Keep its observable behavior
(including `normalizeQrUrl`'s YouTube canonicalization: youtu.be/ID,
watch?v=ID, /shorts|embed|v/ID all collapse to `yt:ID`), but make everything persist.

## Database

Dexie db name `gym-tracker`. Suggested tables (adjust indexes as you see fit):

- `exercises` (id) — seeded catalog
- `equipmentModels` (id, *qrKeys) — store precomputed normalized QR keys for lookup
- `machines` (id, qrKey, exerciseId)
- `routines` (id)
- `workouts` (id, date, startedAt, finishedAt)
- `sets` (id, workoutId, exerciseId, loggedAt)
- `food` (id, date)
- `savedMeals` (id)
- `settings` (singleton row)

Open/seed once, lazily, on first API call (top-level await is fine too). Seeding must
be idempotent: run only when the exercises table is empty.

## Seed data (first run)

Seed everything in the placeholder, EXPANDED as follows:

1. **Exercises** — keep the 15 in the placeholder and add: Hack Squat (quads/glutes,
   machine), Smith Machine Squat (quads/glutes, free), Biceps Curl Machine (biceps,
   machine), Triceps Press Machine (triceps, machine), Cable Lateral Raise
   (shoulders, cable), Seated Calf Raise (calves, machine), Back Extension
   (back/glutes, machine), Ab Crunch Machine (core, machine). Use the same
   `ex-kebab-name` id convention.
2. **Equipment models** — keep the Life Fitness Seated Leg Press
   (qr/video `https://www.youtube.com/watch?v=4s3rkgBX5So`). Add plausible Life
   Fitness models for Chest Press, Shoulder Press, Lat Pulldown, Seated Row, Leg
   Extension, Leg Curl, Pec Fly — each with `videoUrl` of the form
   `https://www.youtube.com/@LifeFitnessTraining` (channel link placeholder; we don't
   know the exact per-machine video ids yet) and an empty `qrUrls` array EXCEPT the
   leg press which keeps its real URL. Link each model to its exercise id.
3. **Routines** — Push, Pull, Legs exactly as the placeholder.
4. **Saved meals & settings** — as the placeholder (2200 kcal, 180 g protein, 90 s rest).

## Semantics to preserve (tests you must run mentally)

- `resolveQr(url)`: normalize, look up user machine by normalized key first, catalog
  model second; both may match; unknown → `{}`.
- `getPrevPerformance(exerciseId, beforeWorkoutId?)`: sets from the most recent
  FINISHED workout that contains that exercise (strictly earlier than
  `beforeWorkoutId`'s `startedAt` when given), ordered by `setNumber`.
- `finishWorkout` → summary with `durationSec`, `totalVolumeLb` (Σ weight×reps),
  `setCount`, and `prs`: an exercise PRs when a set's weight beats all pre-workout
  history, or ties the best weight with more reps. One PR entry per exercise.
- `cancelWorkout` deletes the workout AND its sets.
- `getWeekActivity`: last 7 local days oldest-first with finished workout + routine
  name, plus 6 rolling 7-day volume buckets ending today, oldest-first.
- `getDayFoodStats` sums calories/protein/carbs/fat for the local day key (carbs/fat treat missing as 0).
- `deleteSet` re-derives the strength baseline from remaining sets when the deleted set had been promoted to the baseline.
- Day keys are LOCAL dates via `toDayKey` from `src/types.ts`, never UTC.

## Structure suggestion (your call)

`src/data/db.ts` (Dexie schema), `src/data/seed.ts`, `src/data/qr.ts`
(normalizeQrUrl), `src/data/index.ts` (DataAPI implementation re-exporting
normalizeQrUrl). A `src/data/README.md` documenting the schema is welcome.

## Report back

Files created/changed, schema + indexes chosen, any contract changes you'd propose
for `src/types.ts`, and any semantics you found ambiguous.
