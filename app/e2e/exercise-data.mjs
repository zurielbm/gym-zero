// Real IndexedDB upgrade and API integration; no live account or AI requests.
import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { homedir } from 'node:os'
import { readdirSync } from 'node:fs'
const cache = `${homedir()}/Library/Caches/ms-playwright`
const shell = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop()
const browser = await chromium.launch({ executablePath: `${cache}/${shell}/chrome-headless-shell-mac-arm64/chrome-headless-shell` })
try {
  const page = await browser.newPage()
  await page.route('**/data-check', (route) => route.fulfill({ contentType: 'text/html', body: '<html><body>Data integration checks</body></html>' }))
  await page.goto(`${process.env.BASE_URL ?? 'http://127.0.0.1:5199'}/data-check`)
  const results = await page.evaluate(async () => {
    const { default: Dexie } = await import('/node_modules/dexie/dist/dexie.mjs')
    const legacy = new Dexie('gym-tracker')
    // Recreate the previous schema before importing the new app database.
    legacy.version(8).stores({ exercises: 'id', equipmentModels: 'id,*qrKeys', machines: 'id,qrKey,exerciseId', routines: 'id', workouts: 'id,date,startedAt,finishedAt', sets: 'id,workoutId,exerciseId,loggedAt', food: 'id,date', savedMeals: 'id', settings: 'id', outbox: 'key', bodyStats: 'id,date,at', tape: 'id,date,at', machineAi: 'id', aiPrograms: 'id', baselines: 'id', products: 'barcode', drinks: 'id,date', containers: 'id' })
    const leg = { id: 'legacy-leg', name: 'Leg Press', muscleGroups: ['quads', 'glutes'], equipment: 'machine' }
    const oldWorkout = { id: 'old-workout', date: '2026-09-01', startedAt: 100, finishedAt: 200 }
    const oldSet = { id: 'old-set', workoutId: oldWorkout.id, exerciseId: leg.id, weightLb: 100, reps: 10, setNumber: 1, loggedAt: 150 }
    await legacy.table('exercises').put(leg)
    await legacy.table('workouts').put(oldWorkout)
    await legacy.table('sets').put(oldSet)
    await legacy.table('settings').put({ id: 'settings' })
    legacy.close()
    const { api } = await import('/src/data/index.ts')
    const { db } = await import('/src/data/db.ts')
    let checks = 0
    const check = (condition, message) => { if (!condition) throw new Error(message); checks++ }
    const list = await api.listExercises()
    check(list.some((e) => e.id === 'ex-elliptical'), 'cardio catalog seeded for existing user')
    check(JSON.stringify(await api.getExercise(leg.id)) === JSON.stringify(leg), 'legacy exercise preserved exactly')
    check(JSON.stringify((await api.listSets(oldWorkout.id))[0]) === JSON.stringify(oldSet), 'history preserved exactly')
    const summary = await api.getWorkoutSummary(oldWorkout.id)
    check(summary.totalVolumeLb === 1000 && summary.setCount === 1, 'legacy summary')
    const updatedLeg = await api.saveExercise({ ...leg, categories: ['strength'], primaryCategory: 'strength', primaryMuscles: ['quads', 'glutes'], supportingMuscles: ['calves'], recordingFormat: 'weight-reps' })
    check(updatedLeg.id === leg.id && updatedLeg.primaryMuscles.length === 2 && !updatedLeg.custom, 'multiple primary muscles and built-in identity')
    const duplicate = await api.saveExercise({ name: ' ELLIPTICAL ', muscleGroups: [], equipment: 'machine', categories: ['cardio'], recordingFormat: 'duration' })
    check(duplicate.id === 'ex-elliptical', 'duplicate alias reused')
    const input = { name: 'Custom air bike', muscleGroups: [], equipment: 'machine', categories: ['cardio', 'strength'], primaryCategory: 'cardio', recordingFormat: 'duration-distance' }
    const [custom, same] = await Promise.all([api.saveExercise(input), api.saveExercise({ ...input, name: ' custom AIR bike ' })])
    check(custom.id === same.id, 'concurrent duplicate creation converges')
    const renamed = await api.saveExercise({ ...custom, name: 'Renamed air bike' })
    const recreated = await api.saveExercise(input)
    check(renamed.id === custom.id && recreated.id !== custom.id, 'reusing a former name cannot overwrite renamed history')
    check((await api.getExercise(custom.id)).name === 'Renamed air bike', 'renamed record stays intact')
    await api.deleteExercise(recreated.id)
    const workout = await api.startWorkout()
    const a = await api.logActivity({ workoutId: workout.id, exerciseId: custom.id, recordingFormat: 'duration-distance', durationSec: 1200, distanceMiles: 3.2, resistance: 8, entryNumber: 1 })
    check(a.schemaVersion === 1 && a.categories.includes('cardio'), 'activity snapshot')
    const reject = async (action) => { try { await action() } catch { return true } return false }
    check(await reject(() => api.logActivity({ ...a, durationSec: -1 })), 'reject negative time')
    check(await reject(() => api.logActivity({ ...a, durationSec: Number.NaN })), 'reject invalid time')
    check(await reject(() => api.logSet({ workoutId: workout.id, exerciseId: custom.id, weightLb: 1, reps: 1, setNumber: 1 })), 'timed exercise cannot masquerade as lifting')
    await api.saveExercise({ ...custom, categories: ['mobility'], primaryCategory: 'mobility' })
    check((await api.listActivities(workout.id))[0].categories.includes('cardio'), 'later edit does not rewrite cardio history')
    const strength = await api.logSet({ workoutId: workout.id, exerciseId: leg.id, weightLb: 120, reps: 10, setNumber: 1 })
    const bodyweight = await api.saveExercise({ name: 'Bodyweight test', muscleGroups: ['core'], equipment: 'bodyweight', categories: ['strength'], recordingFormat: 'reps' })
    await api.logSet({ workoutId: workout.id, exerciseId: bodyweight.id, weightLb: 999, reps: 15, setNumber: 1 })
    // Future records are retained but safely excluded by version-aware readers.
    await db.activities.put({ ...a, id: 'future-log', schemaVersion: 2, durationSec: 99999 })
    check((await api.listActivities(workout.id)).length === 1, 'unknown version filtered')
    const plank = await api.saveExercise({ name: 'Timed plank', muscleGroups: ['core'], equipment: 'bodyweight', categories: ['strength'], recordingFormat: 'timed-sets' })
    const plankEntry = await api.logActivity({ workoutId: workout.id, exerciseId: plank.id, recordingFormat: 'timed-sets', durationSec: 45, entryNumber: 1 })
    check((await api.getWorkoutSummary(workout.id)).cardioDurationSec === 1200, 'timed strength does not increase cardio minutes')
    check((await api.getWorkoutSummary(workout.id)).timedDurationSec === 1245, 'timed sets counted in all timed activity')
    await api.deleteActivity(plankEntry.id)
    const finished = await api.finishWorkout(workout.id)
    check(finished.activityCount === 1 && finished.timedDurationSec === 1200 && finished.cardioDurationSec === 1200, 'timed summary')
    check(finished.distanceMiles === 3.2 && finished.totalVolumeLb === 1200 && finished.setCount === 2, 'cardio and bodyweight excluded from tonnage')
    check(finished.prs.length === 1 && finished.prs[0].exerciseId === leg.id, 'only lifting creates strength PRs')
    check((await api.getWeekActivity()).weeklyCardioMinutes.at(-1) === 20, 'weekly cardio separately counted')
    check((await api.getPrevActivities(custom.id)).length === 1, 'timed previous performance')
    const notes = await api.finishWorkout(workout.id, 'Updated note')
    check(notes.workout.finishedAt === finished.workout.finishedAt, 'editing notes preserves finish timestamp')
    check(await reject(() => api.deleteExercise(custom.id)), 'used custom exercise cannot delete history')
    const unused = await api.saveExercise({ ...input, name: 'Unused exercise' })
    await api.deleteExercise(unused.id)
    check(!await api.getExercise(unused.id), 'unused custom deletion')
    await api.deleteSet(strength.id)
    check((await api.getWorkoutSummary(workout.id)).totalVolumeLb === 0, 'delete strength set updates volume')
    await api.deleteActivity(a.id)
    check((await api.getWorkoutSummary(workout.id)).activityCount === 0, 'delete timed entry updates summary')
    const empty = await api.startWorkout()
    await api.logActivity({ workoutId: empty.id, exerciseId: custom.id, recordingFormat: 'duration-distance', durationSec: 30, entryNumber: 1 })
    await api.cancelWorkout(empty.id)
    check(!(await api.listActivities(empty.id)).length, 'discard removes activity records')
    return { checks, version: db.verno }
  })
  assert.equal(results.version, 9)
  console.log(`Passed ${results.checks} data checks, including v8 → v9 migration.`)
} finally { await browser.close() }
