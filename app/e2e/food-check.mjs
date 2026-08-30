// Food quick-grab + AI review walkthrough against a dev server (default localhost:5199):
// grab-again rail, tap-to-edit with portion scaling, AI clarifying question,
// merge-into-one, and caloric drink containers writing both ledgers.
import { chromium } from 'playwright-core'
import { homedir } from 'os'
import { readdirSync } from 'fs'

const cache = `${homedir()}/Library/Caches/ms-playwright`
const shellDir = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop()
const exe = `${cache}/${shellDir}/chrome-headless-shell-mac-arm64/chrome-headless-shell`
const browser = await chromium.launch({ executablePath: exe })
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
page.on('dialog', (d) => d.accept())

const step = async (name, fn) => {
  try { await fn(); console.log(`PASS ${name}`) }
  catch (e) { console.log(`FAIL ${name}: ${String(e).split('\n')[0]}`); await page.screenshot({ path: `e2e/fail-food-${name.replace(/\W+/g, '-')}.png` }) }
}
const tab = (name) => page.locator('.tab', { hasText: name })

// ---- AI proxy mock: first call returns ingredients + a clarifying question,
// the follow-up (carries "Answer to your question") returns one sandwich ----
await page.route('https://ai.e2e/**', async (route) => {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  }
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors })
  if (route.request().url().includes('/v1/models')) {
    return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ data: [] }) })
  }
  const post = route.request().postData() ?? ''
  const content = post.includes('Answer to your question')
    ? JSON.stringify({ items: [{ name: 'Ham sandwich', calories: 430, protein: 25, carbs: 30, fat: 22 }] })
    : JSON.stringify({
        items: [
          { name: 'Bread (2 slices)', calories: 120, protein: 4 },
          { name: 'Ham', calories: 150, protein: 18 },
          { name: 'Lettuce & mayo', calories: 60, protein: 3 },
        ],
        question: { text: 'Is this one sandwich or separate items?', options: ['One sandwich', 'Separate items'] },
      })
  return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content } }] }) })
})

await page.goto('http://localhost:5199/')
await page.getByText('Start Workout').waitFor({ timeout: 8000 })

await step('quick add a custom entry', async () => {
  await tab('Fuel').click()
  await page.getByText('＋ Quick add').click()
  await page.locator('input[placeholder="Chicken bowl"]').fill('Chicken bowl')
  await page.locator('input[placeholder="650"]').fill('650')
  await page.locator('input[placeholder="40"]').fill('40')
  await page.locator('.big-btn', { hasText: 'Add →' }).click()
  await page.getByText('650 kcal · 40P').waitFor()
})

await step('grab-again rail offers it after remount, one tap re-logs', async () => {
  await tab('Home').click()
  await page.getByText('Start Workout').waitFor()
  await tab('Fuel').click()
  await page.getByText('Grab again — recent, same portion').waitFor()
  await page.getByRole('button', { name: 'Chicken bowl · 650 kcal' }).click()
  await page.getByText('1,300', { exact: false }).first().waitFor() // day total doubled
})

await step('tap-to-edit: portion ×1.5 rescales the entry', async () => {
  await page.locator('span[title="Tap to edit"]', { hasText: 'Chicken bowl' }).first().click()
  await page.getByText('Portion × (1.5 = half again)').waitFor()
  const scale = page.locator('.field', { hasText: 'Portion ×' }).locator('input')
  await scale.fill('1.5')
  await page.getByText('×1.5 → 975 kcal · 60g protein').waitFor()
  await page.getByRole('button', { name: 'Save', exact: true }).click()
  await page.getByText('975 kcal · 60P').waitFor()
})

await step('configure AI proxy (mocked)', async () => {
  await tab('Home').click()
  await page.locator('.icon-btn[title="Settings"]:visible').click()
  await page.locator('input[placeholder="https://optiplex.tailnet.ts.net"]').fill('https://ai.e2e')
  await page.getByText('Test & save').click()
  await page.getByText('Connected ✓').waitFor()
})

await step('ai: question shows with best-guess items', async () => {
  await tab('Fuel').click()
  await page.getByText('＋ Quick add').click()
  await page.locator('textarea.text-in').fill('ham sandwich')
  await page.getByText('Analyze with AI').click()
  await page.getByText('AI estimate — review').waitFor()
  await page.getByText('Is this one sandwich or separate items?').waitFor()
  await page.getByText('330 kcal').waitFor() // ingredient best-guess still shown
  await page.getByText('Answering sharpens the numbers below — or just add them as-is.').waitFor()
})

await step('ai: merge button collapses ingredients without a round-trip', async () => {
  await page.getByText('One dish? Merge into a single item').click()
  await page.locator('.big-btn', { hasText: 'Add 1 item' }).waitFor()
  await page.getByText('330 kcal').waitFor() // summed, not re-estimated
  await page.getByRole('button', { name: 'Back' }).click()
})

await step('ai: answering the question revises the items', async () => {
  if (await page.getByText('＋ Quick add').count()) await page.getByText('＋ Quick add').click()
  await page.locator('textarea.text-in').fill('ham sandwich')
  await page.getByText('Analyze with AI').click()
  await page.getByText('Is this one sandwich or separate items?').waitFor()
  await page.getByRole('button', { name: 'One sandwich', exact: true }).click()
  await page.getByText('430 kcal').waitFor()
  await page.locator('.big-btn', { hasText: 'Add 1 item' }).click()
  await page.getByText('430 kcal · 25P').first().waitFor()
})

await step('shake container: one tap writes fluid + calories', async () => {
  await page.getByRole('button', { name: '✎ Edit', exact: true }).click()
  await page.getByPlaceholder('Big bottle').fill('Post-shake')
  await page.getByPlaceholder('24').fill('20')
  await page.getByRole('button', { name: 'Shake', exact: true }).click()
  await page.locator('.field', { hasText: 'Calories when full' }).locator('input').fill('120')
  await page.locator('.field', { hasText: 'Protein (g) — optional' }).locator('input').fill('24')
  await page.getByText('one tap, both counted', { exact: false }).waitFor()
  await page.getByRole('button', { name: 'Add container' }).click()
  await page.getByText('20 oz · shake · 120 kcal').waitFor()
  await page.getByRole('button', { name: 'Done' }).click()
  await page.getByRole('button', { name: '🥤 Post-shake · 20 oz' }).click()
  await page.getByText('from drink log · 20 oz').waitFor() // food entry appeared
  await page.getByText('120 kcal · 24P').waitFor()
})

await step('deleting the drink removes its food entry too', async () => {
  await page.locator('.meal-row', { hasText: 'Post-shake · 20 oz' }).locator('.del').click()
  await page.getByText('from drink log · 20 oz').waitFor({ state: 'detached' })
})

await step('drink-logged food never appears in grab-again', async () => {
  await tab('Home').click()
  await page.getByText('Start Workout').waitFor()
  await tab('Fuel').click()
  await page.getByText('Grab again — recent, same portion').waitFor()
  if (await page.getByRole('button', { name: /Post-shake · 120 kcal/ }).count() > 0) {
    throw new Error('drink-log entry leaked into the grab-again rail')
  }
})

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'NO PAGE ERRORS')
await browser.close()
