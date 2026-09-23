import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { homedir } from 'node:os'
import { existsSync, readdirSync } from 'node:fs'
const cache = `${homedir()}/Library/Caches/ms-playwright`
const shell = existsSync(cache) ? readdirSync(cache).filter(name => name.startsWith('chromium_headless_shell-')).sort().pop() : undefined
const executablePath = shell ? `${cache}/${shell}/chrome-headless-shell-mac-arm64/chrome-headless-shell` : undefined
const browser = await chromium.launch(executablePath ? { executablePath } : {})
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  await page.goto(process.env.BASE_URL ?? 'http://127.0.0.1:5199')
  const result = await page.evaluate(async () => {
    const { buildWorkoutOverview } = await import('/src/lib/workout-overview.ts')
    const { api } = await import('/src/data/index.ts')
    const catalog = new Map((await api.listExercises()).map(ex => [ex.id, ex]))
    catalog.set('custom', { id: 'custom', name: 'Custom core', equipment: 'bodyweight', muscleGroups: ['core'], primaryMuscles: ['core'], supportingMuscles: ['shoulders'] })
    const base = { workoutId: 'test', setNumber: 1, loggedAt: 1, reps: 10, weightLb: 50 }
    const sets = [
      { ...base, id: 'a', exerciseId: 'ex-chest-press' },
      { ...base, id: 'b', exerciseId: 'ex-chest-press', setNumber: 2 },
      { ...base, id: 'c', exerciseId: 'ex-triceps-press-machine' },
      { ...base, id: 'd', exerciseId: 'custom', recordingFormat: 'reps', weightLb: 999 },
      { ...base, id: 'e', exerciseId: 'missing-exercise', weightLb: 0 },
    ]
    const activities = [{ id: 't', workoutId: 'test', exerciseId: 'ex-stationary-bike', schemaVersion: 1, recordingFormat: 'duration-distance', categories: ['cardio'], durationSec: 600, distanceMiles: 2, entryNumber: 1, loggedAt: 2 }]
    const overview = buildWorkoutOverview(sets, activities, catalog)
    const changed = buildWorkoutOverview(sets.map(s => s.id === 'a' ? { ...s, weightLb: 60, reps: 12 } : s), activities, catalog)
    return { overview, changed, empty: buildWorkoutOverview([], [], catalog) }
  })
  const { overview: o, changed, empty } = result
  assert.equal(o.exercises.length, 5, 'unique logged exercises only')
  assert.equal(o.liftingSets, 5)
  assert.equal(o.reps, 50)
  assert.equal(o.exercises.reduce((sum, ex) => sum + ex.volumeLb, 0), 1500, 'bodyweight and timed excluded from volume')
  assert.equal(o.levels.triceps, 'primary', 'main beats assisting across exercises')
  assert(!o.assisting.some(hit => hit.region === 'triceps'))
  assert.equal(o.main.filter(hit => hit.region === 'chest').length, 1, 'regions deduplicated')
  assert(!o.exercises.some(ex => ex.exerciseId === 'ex-leg-curl'), 'unlogged catalog/routine exercise excluded')
  assert.equal(o.exercises.find(ex => ex.exerciseId === 'custom').source, 'saved-roles')
  assert.deepEqual(o.unmapped.map(ex => ex.exerciseId), ['missing-exercise'])
  assert.equal(o.exercises.find(ex => ex.exerciseId === 'ex-stationary-bike').durationSec, 600)
  assert.equal(changed.reps, 52)
  assert.equal(changed.exercises.reduce((sum, ex) => sum + ex.volumeLb, 0), 1720)
  assert.equal(empty.exercises.length, 0)
  assert.deepEqual(empty.levels, {})
  console.log('PASS overview aggregation: logged-only muscles, main/assisting precedence, custom/missing data, mixed activities, edit refresh, empty session.')
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.evaluate(async () => {
    const { api } = await import('/src/data/index.ts')
    const workout = await api.startWorkout('rt-push')
    await api.logSet({ workoutId: workout.id, exerciseId: 'ex-chest-press', weightLb: 50, reps: 10, setNumber: 1 })
    await api.logActivity({ workoutId: workout.id, exerciseId: 'ex-stationary-bike', recordingFormat: 'duration-distance', durationSec: 600, distanceMiles: 2, entryNumber: 1 })
  })
  await page.reload()
  await page.locator('.tabbar').getByRole('button', { name: 'Train', exact: true }).click()
  await page.getByRole('button', { name: 'Finish workout →', exact: true }).click()
  const totals = page.getByRole('region', { name: 'Session totals' })
  await totals.waitFor()
  assert.equal(await page.locator('[data-overview-exercise]').count(), 2)
  assert.equal(await page.locator('[data-overview-exercise="ex-shoulder-press"]').count(), 0)
  assert.equal(await page.locator('.wo-muscles [data-region="chest"][data-level="primary"]').count(), 1)
  assert.equal(await page.locator('.wo-muscles [data-region="frontDelts"][data-level="secondary"]').count(), 1)
  assert.match(await totals.innerText(), /500/)
  await page.getByRole('button', { name: 'Edit Chest Press set 1', exact: true }).click()
  await page.getByLabel('Weight (lb)', { exact: true }).fill('60')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.getByText('Edited', { exact: true }).waitFor()
  assert.match(await totals.innerText(), /600/)
  await page.getByLabel('Workout notes').fill('Overview check')
  await page.getByRole('button', { name: 'Save note', exact: true }).click()
  await page.getByRole('button', { name: 'Saved ✓', exact: true }).waitFor()
  await page.getByRole('button', { name: 'Back to Stats →', exact: true }).click()
  await page.getByRole('button', { name: /^Review workout from/ }).first().click()
  await totals.waitFor()
  assert.equal(await page.getByLabel('Workout notes').inputValue(), 'Overview check')
  assert.equal(await page.locator('[data-overview-exercise]').count(), 2)
  assert.deepEqual(errors, [])
  console.log('PASS finish → overview, main/assisting map, skipped exercises excluded, corrected totals, notes and historical review.')
} finally { await browser.close() }
