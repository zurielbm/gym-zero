import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
import { homedir } from 'node:os'
import { existsSync, readdirSync } from 'node:fs'
const cache = `${homedir()}/Library/Caches/ms-playwright`
const shell = existsSync(cache) ? readdirSync(cache).filter(name => name.startsWith('chromium_headless_shell-')).sort().pop() : undefined
const browser = await chromium.launch(shell ? { executablePath: `${cache}/${shell}/chrome-headless-shell-mac-arm64/chrome-headless-shell` } : {})
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
  page.setDefaultTimeout(10000)
  const requests = [], errors = []
  let mode = 'ok'
  page.on('pageerror', error => errors.push(error.message))
  const answer = { assessment: 'One logged chest exercise.', progress: 'One earlier session gives limited evidence.', strengths: ['Consistent logging.'], improvements: ['Track effort next time.'], routine: { recommendation: 'Keep the current routine for now.', reason: 'More consistent logs are needed.', days: [{ name: 'Optional next session', exercises: ['Chest Press: repeat the planned sets.'] }] }, limitations: ['Effort and technique are not recorded.'] }
  await page.route('https://workout-review.test/**', async route => {
    const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }
    if (route.request().method() === 'OPTIONS') return route.fulfill({ headers, status: 204 })
    if (route.request().method() === 'GET') return route.fulfill({ headers, json: { data: [] } })
    requests.push(route.request().postDataJSON())
    const responseMode = mode
    if (responseMode === 'slow') await new Promise(resolve => setTimeout(resolve, 1000))
    await route.fulfill({ headers, json: { choices: [{ message: { content: JSON.stringify(responseMode === 'bad' ? { assessment: 'incomplete' } : answer) } }] } }).catch(() => {})
  })
  await page.goto(process.env.BASE_URL ?? 'http://127.0.0.1:5199')
  await page.evaluate(async () => {
    const { api } = await import('/src/data/index.ts')
    const { db } = await import('/src/data/db.ts')
    const now = Date.now(), day = 86400000
    await api.patchSettings({ aiEndpoint: 'https://workout-review.test', aiApiKey: 'secret-review-key', foodDbEndpoint: 'private-food-host', birthYear: 1990, bodyWeightLb: 177, goal: 'muscle', experience: 'new', daysPerWeek: 3, limitations: 'Avoid painful movements' })
    const current = await api.startWorkout('rt-push')
    await db.workouts.update(current.id, { startedAt: now - day })
    await api.logSet({ workoutId: current.id, exerciseId: 'ex-chest-press', machineId: 'station-a', weightLb: 50, reps: 10, setNumber: 1 })
    for (const [id, age, finished] of [['previous', 3, true], ['too-old', 65, true], ['future', -1, true], ['unfinished', 4, false]]) {
      await db.workouts.put({ id, date: new Date(now-age*day).toISOString().slice(0,10), startedAt: now-age*day, ...(finished ? { finishedAt: now-age*day+1000 } : {}) })
      await db.sets.put({ id: `set-${id}`, workoutId: id, exerciseId: 'ex-chest-press', machineId: 'station-a', weightLb: 40, reps: 10, setNumber: 1, loggedAt: now-age*day+500 })
    }
  })
  await page.reload()
  await page.locator('.tabbar').getByRole('button', { name: 'Train', exact: true }).click()
  await page.getByRole('button', { name: 'Finish workout →', exact: true }).click()
  const ask = page.getByRole('button', { name: 'Ask AI about this workout', exact: true })
  await ask.waitFor()
  assert.equal(requests.length, 0, 'review never runs automatically')
  await page.getByLabel('Ask about your workout', { exact: true }).fill('Would another routine be better?')
  await ask.click()
  await page.getByRole('heading', { name: 'How it went', exact: true }).waitFor()
  const payload = JSON.parse(requests[0].messages[1].content)
  assert.equal(payload.earlierWorkouts.length, 1, 'future, unfinished and >8-week sessions excluded')
  assert.equal(payload.earlierWorkouts[0].sets[0].weightLb, 40)
  assert.equal(payload.session.sets[0].machineId, 'station-a')
  assert.equal(payload.profile.goal, 'muscle')
  assert.equal(payload.question, 'Would another routine be better?')
  assert(payload.currentSavedRoutine.items.length > 0)
  for (const secret of ['secret-review-key', 'private-food-host', 'birthYear', 'bodyWeightLb', 'aiApiKey']) assert(!requests[0].messages[1].content.includes(secret), `${secret} excluded from prompt`)
  assert.match(await page.locator('.wo-ai-meta').innerText(), /1 earlier workout/)
  await page.getByRole('button', { name: 'Edit Chest Press set 1', exact: true }).click()
  assert.equal(await ask.isDisabled(), true)
  await page.getByLabel('Weight (lb)', { exact: true }).fill('55')
  await page.getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.getByText('Edited', { exact: true }).waitFor()
  assert.equal(await page.getByRole('heading', { name: 'How it went', exact: true }).count(), 0, 'edit invalidates prior answer')
  mode = 'bad'
  await ask.click()
  await page.getByRole('alert').filter({ hasText: 'incomplete workout review' }).waitFor()
  mode = 'ok'
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await page.getByRole('heading', { name: 'How it went', exact: true }).waitFor()
  assert.equal(JSON.parse(requests.at(-1).messages[1].content).session.sets[0].weightLb, 55)
  await page.getByLabel('Ask about your workout', { exact: true }).fill('A new question')
  mode = 'slow'
  await ask.click()
  await page.getByRole('button', { name: 'Stop request', exact: true }).click()
  await page.waitForTimeout(1100)
  assert.match(await page.locator('.wo-ai-meta').innerText(), /Previous answer/)
  assert.equal(await ask.isEnabled(), true)
  const checks = await page.evaluate(async () => {
    const { parseWorkoutReview, evaluateWorkout } = await import('/src/lib/workout-review.ts')
    const { api } = await import('/src/data/index.ts')
    const { db } = await import('/src/data/db.ts')
    const recent = await api.listRecentWorkouts(1, Date.now() - 86400000)
    let rejected = false
    try { parseWorkoutReview(null, 0) } catch { rejected = true }
    const all = await db.workouts.toArray()
    const summary = await api.getWorkoutSummary(all.find(w => w.routineId === 'rt-push').id)
    const settings = await api.getSettings()
    const sets = await api.listSets(summary.workout.id)
    const catalog = new Map((await api.listExercises()).map(ex => [ex.id, ex]))
    // No-history path uses the same response parser and reports count from actual context, not model output.
    const noHistoryApi = Object.create(api)
    noHistoryApi.listRecentWorkouts = async () => []
    const result = await evaluateWorkout({ endpoint: 'https://workout-review.test' }, { api: noHistoryApi, summary, sets, activities: [], exercises: catalog, settings })
    return { rejected, first: recent[0].workout.id, noHistoryCount: result.historyCount }
  })
  assert(checks.rejected)
  assert.equal(checks.first, 'previous', 'historical cutoff applied before limit')
  assert.equal(checks.noHistoryCount, 0)
  assert.deepEqual(errors, [])
  console.log('PASS click-only review; historical window, station data and profile allowlist; set-edit invalidation; malformed-response retry; cancellation; no-history review.')
} finally { await browser.close() }
