// Deterministic mobile UX regressions. AI responses are mocked; no live AI credentials required.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { chromium } from 'playwright-core'

const browser = await chromium.launch()
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' })
const page = await context.newPage()
page.setDefaultTimeout(6000)
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('dialog', (dialog) => dialog.accept())
const screenshots = process.env.AUDIT_DIR ?? 'e2e/qol-audit'
mkdirSync(screenshots, { recursive: true })
const tab = (name) => page.locator('.tabbar').getByRole('button', { name, exact: true })
const dismiss = async () => { const button = page.getByRole('button', { name: 'Dismiss notification' }); if (await button.count()) await button.click() }
const store = (name) => page.evaluate(async (table) => { const { db } = await import('/src/data/db.ts'); return db.table(table).toArray() }, name)
const waitFor = async (predicate, message) => {
  for (let i = 0; i < 60; i++) { if (await predicate()) return; await page.waitForTimeout(50) }
  throw new Error(message)
}
const shot = (name) => page.screenshot({ path: `${screenshots}/${name}.png` })
let probeOk = true
let mode = 'normal'
let requests = []
let serverAttempts = 0
await page.route('https://ai.ux.test/**', async (route) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS' }
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers })
  if (route.request().url().endsWith('/v1/models')) {
    await new Promise((resolve) => setTimeout(resolve, 350))
    return route.fulfill({ status: probeOk ? 200 : 503, headers, json: { data: [] } })
  }
  assert(route.request().url().endsWith('/v1/chat/completions'), 'endpoint /v1 is normalized exactly once')
  const body = route.request().postDataJSON()
  requests.push(body)
  if (mode === 'slow') await new Promise((resolve) => setTimeout(resolve, 1800))
  if (mode === 'auth-error') return route.fulfill({ status: 401, headers, body: '{}' })
  if (mode === 'retry' && serverAttempts++ === 0) return route.fulfill({ status: 503, headers, body: '{}' })
  const revised = body.messages.some((message) => message.content?.includes?.('User feedback / answer'))
  const content = mode === 'malformed' ? 'not valid JSON' : JSON.stringify({
    items: revised ? [{ name: 'Chicken bowl, half', calories: 320, protein: 25 }] : [{ name: 'Chicken bowl', calories: 640, protein: 50 }],
    ...(!revised ? { question: { text: 'How much did you eat?', options: ['All of it', 'Half'] } } : {}),
  })
  await route.fulfill({ headers, json: { choices: [{ message: { content } }] } }).catch(() => {})
})

try {
  await page.goto(process.env.BASE_URL ?? 'http://localhost:5173/')
  await tab('Fuel').click()
  assert((await page.getByRole('button', { name: '＋ Log food', exact: true }).boundingBox()).y < 700, 'log food is above the fold')
  await shot('fuel-390')
  await page.getByRole('button', { name: '＋ Log food', exact: true }).click()
  await page.getByLabel('Describe your food').fill('a chicken bowl')
  await tab('Home').click()
  await page.getByRole('button', { name: 'Settings', exact: true }).locator('visible=true').click()
  await page.getByLabel('AI endpoint', { exact: true }).fill('ai.ux.test/v1/')
  await page.getByRole('button', { name: 'Test & save', exact: true }).click()
  await page.getByText('Connected ✓', { exact: true }).waitFor()
  await dismiss()
  await tab('Fuel').click()
  assert.equal(await page.getByLabel('Describe your food').inputValue(), 'a chicken bowl', 'draft survives Settings navigation')
  await page.getByText('AI ready', { exact: true }).waitFor()

  mode = 'slow'
  await page.getByRole('button', { name: 'Analyze with AI', exact: true }).click()
  await page.getByText('Estimating your food…', { exact: true }).waitFor()
  await shot('ai-working-390')
  await page.getByRole('button', { name: 'Stop request' }).click()
  await page.getByText('Stopped. Your draft is still here.').waitFor()
  await page.waitForTimeout(1900)
  assert.equal(await page.getByLabel('Food 1 name').count(), 0, 'cancelled response cannot replace draft')
  assert.equal(await page.getByLabel('Describe your food').inputValue(), 'a chicken bowl')
  console.log('PASS draft survives navigation; cancellation ignores late AI responses')

  mode = 'retry'; serverAttempts = 0
  await page.getByRole('button', { name: 'Analyze with AI', exact: true }).click()
  await page.getByLabel('Food 1 name').waitFor()
  assert.equal(serverAttempts, 2)
  assert.equal((await store('food')).length, 0, 'AI never logs without approval')
  await page.getByLabel('Food 1 name').fill('Grilled chicken, no sauce')
  await page.getByLabel('Correct or clarify', { exact: true }).fill('I ate half')
  mode = 'auth-error'
  await page.getByRole('button', { name: 'Update estimate', exact: true }).click()
  await page.locator('.inline-error').getByText(/API key/).waitFor()
  assert.equal(await page.getByLabel('Correct or clarify', { exact: true }).inputValue(), 'I ate half', 'failed correction stays editable')
  assert.equal(await page.getByLabel('Food 1 name').inputValue(), 'Grilled chicken, no sauce')
  mode = 'normal'
  await page.getByRole('button', { name: 'Try again', exact: true }).click()
  await waitFor(async () => (await page.getByLabel('Food 1 name').inputValue()) === 'Chicken bowl, half', 'feedback response')
  const last = requests.at(-1)
  assert(last.messages.some((message) => message.role === 'assistant' && message.content.includes('Grilled chicken, no sauce')), 'manual edits travel with feedback')
  assert.equal(await page.getByLabel('Correct or clarify', { exact: true }).count(), 1, 'same correction control after question disappears')
  await dismiss()
  await shot('ai-review-390')
  await page.getByRole('button', { name: 'Add 1 item →', exact: true }).evaluate((button) => { button.click(); button.click() })
  await waitFor(async () => (await store('food')).length === 1, 'food saved once')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await waitFor(async () => (await store('food')).length === 0, 'undo AI food')
  console.log('PASS visible retry; correction error recovery; edited context; explicit review; duplicate-tap guard; undo')

  // An unreadable response is recoverable and never destroys the request.
  await page.getByRole('button', { name: '＋ Quick add', exact: false }).click()
  await page.getByLabel('Describe your food').fill('one apple')
  mode = 'malformed'
  await page.getByRole('button', { name: 'Analyze with AI', exact: true }).click()
  await page.getByText('AI sent an unreadable response.', { exact: false }).waitFor()
  assert.equal(await page.getByLabel('Describe your food').inputValue(), 'one apple')
  mode = 'normal'
  await page.getByRole('button', { name: 'Close — keep draft', exact: true }).click()

  // Linked food/drink changes must update both visible cards and undo atomically.
  await dismiss()
  await page.evaluate(async () => {
    const { default: api } = await import('/src/data/index.ts')
    await api.saveContainer({ name: 'Recovery shake', volumeOz: 20, kind: 'shake', calories: 120, protein: 24, sortOrder: 99 })
  })
  await page.getByRole('button', { name: /Recovery shake · 20 oz/ }).click()
  await waitFor(async () => (await store('food')).length === 1 && (await store('drinks')).length === 1, 'paired drink saved')
  await dismiss()
  await page.getByRole('button', { name: 'Delete Recovery shake', exact: true }).last().click()
  await waitFor(async () => (await store('food')).length === 0 && (await store('drinks')).length === 0, 'paired delete')
  await page.getByRole('button', { name: 'Undo', exact: true }).click()
  await waitFor(async () => (await store('food')).length === 1 && (await store('drinks')).length === 1, 'paired undo')
  console.log('PASS linked hydration and food deletion + undo')
  await dismiss()

  await tab('Train').click()
  await page.getByRole('button', { name: '＋ Start empty workout', exact: true }).click()
  await page.getByLabel('Add an exercise to workout').selectOption({ label: 'Chest Press' })
  const weight = page.getByLabel('Set 1 weight in pounds')
  const reps = page.getByLabel('Set 1 reps', { exact: true })
  assert(await page.getByRole('button', { name: 'Log set 1', exact: true }).isDisabled())
  await weight.fill('-5'); await reps.fill('10')
  assert(await page.getByRole('button', { name: 'Log set 1', exact: true }).isDisabled())
  await weight.fill('50')
  await page.getByRole('button', { name: 'Log set 1', exact: true }).evaluate((button) => { button.click(); button.click() })
  await waitFor(async () => (await store('sets')).length === 1, 'one set after duplicate taps')
  await page.getByLabel('Set 2 weight in pounds').fill('55')
  await page.getByLabel('Set 2 reps', { exact: true }).fill('11')
  await tab('Fuel').click()
  await page.locator('.rest-toast').waitFor()
  await page.getByRole('button', { name: 'Add 30 seconds of rest' }).click()
  await tab('Train').click()
  assert.equal(await page.getByLabel('Set 2 weight in pounds').inputValue(), '55')
  assert.equal(await page.getByLabel('Set 2 reps', { exact: true }).inputValue(), '11')
  await dismiss(); await shot('workout-390')
  await page.locator('.rest-toast').getByRole('button', { name: 'Skip', exact: true }).click()
  await page.getByRole('button', { name: 'Finish workout →', exact: true }).click()
  assert.equal((await store('workouts')).filter((workout) => !workout.finishedAt).length, 0)
  console.log('PASS empty workout picker; input validation; duplicate set protection; persistent drafts + rest timer')

  // Browser Back stays inside the app.
  await tab('Home').click(); await tab('Fuel').click(); await tab('Stats').click()
  await page.goBack()
  await page.locator('h1', { hasText: 'Fuel' }).waitFor()
  console.log('PASS native browser back navigation')
  await page.evaluate(async () => {
    const { default: api } = await import('/src/data/index.ts')
    const [a, b] = await Promise.all([api.startWorkout(), api.startWorkout()])
    if (a.id !== b.id) throw new Error('Concurrent starts created two workouts')
    const first = await api.finishWorkout(a.id, 'original')
    const second = await api.finishWorkout(a.id, '')
    if (first.workout.finishedAt !== second.workout.finishedAt || second.workout.notes !== undefined) throw new Error('Editing notes changed finish time or failed to clear the note')
    await Promise.all([api.patchSettings({ calorieTarget: 2300 }), api.patchSettings({ proteinTarget: 160 })])
    const settings = await api.getSettings()
    if (settings.calorieTarget !== 2300 || settings.proteinTarget !== 160) throw new Error('Concurrent settings edits lost a change')
  })
  console.log('PASS concurrent workout/settings writes; editing notes preserves duration and supports clearing')

  for (const width of [320, 375, 390, 430, 1280]) {
    await page.setViewportSize({ width, height: width >= 900 ? 900 : 844 })
    const nav = (name) => page.locator(width >= 900 ? '.topnav' : '.tabbar').getByRole('button', { name, exact: true })
    for (const name of ['Home', 'Train', 'Fuel', 'Stats']) {
      await nav(name).click()
      const problems = await page.evaluate(() => {
        const visible = (el) => el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden'
        return [...document.querySelectorAll('input:not([type="checkbox"]),textarea,select,button')].filter(visible).flatMap((el) => {
          const rect = el.getBoundingClientRect()
          const failures = []
          if (rect.right > innerWidth + 1 || rect.left < -1) failures.push(`overflow: ${el.outerHTML.slice(0, 100)}`)
          if (el.matches('input,textarea,select') && parseFloat(getComputedStyle(el).fontSize) < 16) failures.push('iOS input zoom')
          return failures
        })
      })
      assert.deepEqual(problems, [], `${name} at ${width}px`)
    }
    await shot(`stats-${width}`)
  }
  assert.deepEqual(errors, [], 'no unhandled page errors')
  console.log('PASS 320/375/390/430px mobile and 1280px desktop layouts; no page errors')
} catch (error) {
  await shot('failure')
  throw error
} finally { await browser.close() }
