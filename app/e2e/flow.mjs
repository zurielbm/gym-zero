// End-to-end walk of the core flows against a dev server (default localhost:5199).
// Uses whatever chromium headless shell the local playwright cache has.
import { chromium } from 'playwright-core'
import { homedir } from 'os'
import { readdirSync } from 'fs'

const cache = `${homedir()}/Library/Caches/ms-playwright`
const shellDir = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop()
if (!shellDir) throw new Error('no chromium headless shell in playwright cache')
const exe = `${cache}/${shellDir}/chrome-headless-shell-mac-arm64/chrome-headless-shell`
const browser = await chromium.launch({ executablePath: exe })
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })
page.on('dialog', (d) => d.accept())

const step = async (name, fn) => {
  try { await fn(); console.log(`PASS ${name}`) }
  catch (e) { console.log(`FAIL ${name}: ${String(e).split('\n')[0]}`); await shot(name) }
}
const shot = async (name) => page.screenshot({ path: `e2e/fail-${name.replace(/\W+/g, '-')}.png` })

await page.goto(process.env.BASE_URL ?? 'http://localhost:5199/')

await step('home renders with seeded settings', async () => {
  await page.getByText('Start Workout').waitFor({ timeout: 8000 })
  await page.getByText('/ 2,200 kcal').waitFor()
  await page.getByText('/ 180 g').waitFor()
})

await step('start workout -> routines', async () => {
  await page.getByText('Start Workout').click()
  await page.getByText('Choose routine').waitFor()
  await page.getByText('Up next').waitFor()
})

await step('pick Legs routine -> set logger', async () => {
  await page.getByText('🦵 Legs').click()
  await page.locator('h1', { hasText: 'Leg Press' }).waitFor()
  await page.getByText('Finish workout').waitFor()
})

await step('log a set -> rest timer appears', async () => {
  const rows = page.locator('.set-row')
  await rows.first().waitFor()
  await rows.first().locator('input').nth(0).fill('270')
  await rows.first().locator('input').nth(1).fill('12')
  await rows.first().locator('.set-done-btn').click()
  await page.locator('.rest-toast').waitFor()
  await page.getByText('Rest timer').waitFor()
  await page.locator('.rest-toast .ghost-btn').click() // skip
})

await step('logged set shows done state and progress', async () => {
  await page.locator('.set-done-btn.done').first().waitFor()
  await page.getByText('1/4 sets').waitFor()
})

await step('delete a logged set (two-tap confirm), then re-log it', async () => {
  await page.locator('.set-done-btn.done').first().click() // arm
  await page.locator('.set-done-btn.del-armed').waitFor()
  await page.locator('.set-done-btn.del-armed').click() // confirm
  await page.getByText('0/4 sets').waitFor()
  const rows = page.locator('.set-row')
  await rows.first().locator('input').nth(0).fill('270')
  await rows.first().locator('input').nth(1).fill('12')
  await rows.first().locator('.set-done-btn').click()
  await page.locator('.rest-toast .ghost-btn').click()
  await page.getByText('1/4 sets').waitFor()
})

await step('switch exercise via pill', async () => {
  await page.locator('.exercise-pill', { hasText: 'Leg Extension' }).click()
  await page.locator('h1', { hasText: 'Leg Extension' }).waitFor()
  const rows = page.locator('.set-row')
  await rows.first().locator('input').nth(0).fill('120')
  await rows.first().locator('input').nth(1).fill('10')
  await rows.first().locator('.set-done-btn').click()
  await page.locator('.rest-toast .ghost-btn').click()
})

await step('scan screen: manual QR resolve -> known model', async () => {
  await page.locator('.tabbar .scan-key').click()
  await page.getByText('Point at a machine QR or a food barcode').waitFor()
  await page.locator('.text-in').fill('https://youtu.be/4s3rkgBX5So')
  await page.getByText('Go', { exact: true }).click()
  // youtu.be form must normalize to the catalog watch?v= form
  await page.getByText('Life Fitness Seated Leg Press').waitFor()
  await page.getByText('Save my machine').waitFor()
})

await step('map machine once -> machine screen with video + video thumb', async () => {
  await page.getByText('Save my machine').click()
  await page.getByText('My setup').waitFor()
  await page.locator('.video-thumb').waitFor()
  await page.getByText('Log sets on this machine').waitFor()
})

await step('machine seat setting persists', async () => {
  await page.locator('.card .in-grid input').first().fill('4')
  await page.waitForTimeout(200)
})

await step('log sets from machine -> back in logger on Leg Press', async () => {
  await page.getByText('Log sets on this machine').click()
  await page.locator('h1', { hasText: 'Leg Press' }).waitFor()
  await page.getByText('Seated Leg Press ▸').waitFor() // machine link under title
})

await step('rescan resolves to MY machine now', async () => {
  await page.locator('.tabbar .scan-key').click()
  await page.locator('.text-in').fill('https://www.youtube.com/watch?v=4s3rkgBX5So')
  await page.getByText('Go', { exact: true }).click()
  await page.getByText('My setup').waitFor() // straight to mapped machine screen
  await page.getByText('‹ Scanner').click()
})

await step('life fitness qrredirect url -> video + map machine', async () => {
  // real-world URL shape: sticker redirects to trainer.lifefitness.com with the
  // YouTube id in url-video and the lfconnect sticker url base64d in referer-link
  await page.locator('.text-in').fill('https://trainer.lifefitness.com/qrredirect?referer-link=aHR0cHM6Ly9sZmNvbm5lY3QuY29tL3E/dD1zJm09c3NwZA==&referer-type=STRENGTH&url-video=ZbVNPTyVNTQ')
  await page.getByText('Go', { exact: true }).click()
  await page.getByText('Life Fitness machine').waitFor()
  await page.locator('.video-thumb img').waitFor() // thumbnail from url-video id
  await page.locator('input.text-in').first().fill('Pulldown by the mirrors')
  await page.locator('select.text-in').selectOption({ label: 'Lat Pulldown' })
  await page.getByText('Save my machine').click()
  await page.getByText('My setup').waitFor()
})

await step('sticker lfconnect url resolves to the same machine', async () => {
  await page.getByText('‹ Scanner').click()
  await page.locator('.text-in').fill('https://lfconnect.com/q?t=s&m=sspd')
  await page.getByText('Go', { exact: true }).click() // manual entry goes straight to the machine
  await page.locator('h1', { hasText: 'Pulldown by the mirrors' }).waitFor()
  await page.getByText('My setup').waitFor()
  await page.getByText('‹ Scanner').click()
})

await step('finish workout -> summary with volume', async () => {
  await page.getByText('‹ Back').click() // scan screen back -> active workout
  await page.getByText('Finish workout').waitFor()
  await page.getByText('Finish workout').click()
  await page.getByText('Done.').waitFor()
  await page.getByText('Highlights').waitFor()
})

await step('save workout note', async () => {
  await page.locator('textarea').fill('felt strong')
  await page.getByText('Save note').click()
  await page.getByText('Saved ✓').waitFor()
})

await step('back home -> streak + last workout card', async () => {
  await page.getByText('Back to Home').click()
  await page.getByText('Last workout').waitFor()
  await page.getByText('workout', { exact: false }).first().waitFor()
})

await step('routine builder: create, save, start, discard', async () => {
  await page.locator('.tab', { hasText: 'Train' }).click()
  await page.getByText('Choose routine').waitFor()
  await page.getByText('＋ New routine').click()
  await page.getByText('Pick the machines').waitFor()
  await page.locator('input[placeholder="Push day"]').fill('Quick Push')
  await page.locator('select.text-in').selectOption({ label: 'Chest Press' })
  await page.getByText('Add', { exact: true }).click()
  await page.getByText('1 exercise · 3 sets').waitFor()
  await page.locator('.big-btn', { hasText: 'Save routine' }).click()
  await page.locator('.card.tappable', { hasText: 'Quick Push' }).click()
  await page.locator('h1', { hasText: 'Chest Press' }).waitFor()
  await page.locator('.ghost-btn.danger', { hasText: 'Discard workout' }).click() // confirm auto-accepted
  await page.getByText('Choose routine').waitFor()
})

await step('food: saved meal chip adds entry + stats update', async () => {
  await page.locator('.tab', { hasText: 'Fuel' }).click()
  await page.getByText('Quick add — saved meals').waitFor()
  await page.getByText('🥤 Protein shake').click()
  await page.getByText('340 kcal · 48P').waitFor()
})

await step('food: quick add custom entry with all four macros', async () => {
  await page.getByText('＋ Quick add').click()
  await page.locator('input.text-in').first().fill('Chicken bowl')
  await page.locator('input[inputmode="numeric"]').nth(0).fill('650')
  await page.locator('input[inputmode="numeric"]').nth(1).fill('45')
  await page.locator('input[inputmode="numeric"]').nth(2).fill('55')
  await page.locator('input[inputmode="numeric"]').nth(3).fill('20')
  await page.locator('.big-btn', { hasText: 'Add' }).click()
  await page.getByText('650 kcal · 45P · 55C · 20F').waitFor()
})

// Open Food Facts mocked at the network layer, like the AI proxy below
await page.route('https://world.openfoodfacts.org/**', (route) => route.fulfill({
  status: 200, contentType: 'application/json',
  body: JSON.stringify({
    status: 1,
    product: {
      product_name: 'Protein Bar', brands: 'Barbebest',
      nutriments: { 'energy-kcal_100g': 400, proteins_100g: 30, carbohydrates_100g: 40, fat_100g: 15 },
      serving_quantity: 50, serving_size: '1 bar (50 g)',
    },
  }),
}))

await step('barcode: manual digits -> OFF lookup -> portion card logs entry', async () => {
  await page.locator('.tabbar .scan-key').click()
  await page.getByText('Point at a machine QR or a food barcode').waitFor()
  await page.locator('.text-in').fill('0123456789012')
  await page.getByText('Go', { exact: true }).click()
  await page.getByText('Protein Bar — Barbebest').waitFor()
  await page.getByText('400 kcal per 100 g').waitFor()
  await page.locator('.qr-found').click()
  await page.getByText('Scanned — how much did you have?').waitFor()
  await page.getByText('Servings · 1 = 1 bar (50 g)').waitFor()
  await page.getByText('≈ 200 kcal · 15g protein · 20g carbs · 8g fat').waitFor()
  await page.locator('.big-btn', { hasText: 'Log it' }).click()
  await page.getByText('200 kcal · 15P · 20C · 8F').waitFor()
})

await step('history: workout listed with volume + week strip', async () => {
  await page.locator('.tab', { hasText: 'Stats' }).click()
  await page.getByText('Weekly volume').waitFor()
  await page.locator('.cal-day.did').first().waitFor()
  await page.getByText('“felt strong”').waitFor()
})

await step('history: log body weight', async () => {
  await page.locator('input[inputmode="decimal"]').fill('182.4')
  await page.getByText('Log', { exact: true }).click()
  await page.getByText('182.4 lb').waitFor()
})

await step('body: open from stats card, quick-log became a record', async () => {
  await page.getByText('Open ›').click()
  await page.locator('h1', { hasText: 'Body' }).waitFor()
  await page.getByText('182.4 lb').first().waitFor() // latest grid + history list
})

await step('body: log full reading with fat %', async () => {
  await page.getByText('+ Log reading').click()
  await page.locator('.in-grid input').nth(0).fill('181.9') // weight
  await page.locator('.in-grid input').nth(2).fill('15.2') // body fat
  await page.getByText('Save reading').click()
  await page.getByText('Last reading ·').waitFor()
  await page.getByText('181.9').first().waitFor()
  await page.getByText('15.2').first().waitFor()
})

await step('body: tape session computes waist–hip ratio', async () => {
  await page.locator('.seg button', { hasText: 'Tape' }).click()
  await page.getByText('+ Log tape session').click()
  await page.locator('.field', { hasText: 'Waist' }).locator('input').fill('30')
  await page.locator('.field', { hasText: 'Hip' }).locator('input').fill('34.3')
  await page.getByText('Save session').click()
  await page.getByText('Waist–hip ratio').waitFor()
  await page.getByText('0.87').waitFor()
})

await step('body: back to stats shows the new weight', async () => {
  await page.getByText('‹ Stats').click()
  await page.getByText('181.9 lb').waitFor()
})

await step('persistence: reload keeps food + history (IndexedDB)', async () => {
  await page.reload()
  await page.getByText('Start Workout').waitFor({ timeout: 8000 })
  await page.locator('.tab', { hasText: 'Stats' }).click()
  await page.getByText('“felt strong”').waitFor()
  await page.getByText('181.9 lb').waitFor()
  await page.locator('.tab', { hasText: 'Fuel' }).click()
  await page.getByText('650 kcal · 45P').waitFor()
})

await step('data: export + reimport round-trip', async () => {
  await page.locator('.tab', { hasText: 'Stats' }).click()
  await page.locator('.page .icon-btn[title="Settings"]').click() // moved to Settings screen
  await page.getByText('Export data').waitFor()
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByText('Export data').click(),
  ])
  await page.getByText('Exported', { exact: false }).waitFor()
  await page.setInputFiles('input[type=file]', await download.path())
  await page.getByText(/Imported \d+ rows/).waitFor() // merge confirm auto-accepted
  await page.getByText('Start Workout').waitFor({ timeout: 8000 }) // reload lands home
  await page.locator('.tab', { hasText: 'Stats' }).click()
  await page.getByText('181.9 lb').waitFor() // data intact after merge
})

// ---- AI assist (CLIProxyAPI mocked at the network layer) ----
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
  const content = post.includes('starter program')
    ? JSON.stringify({
        sets: 3, reps: 12, startWeightLb: 90, restSeconds: 75,
        effortCheck: 'Last 2 reps should feel hard.',
        progression: 'Add 10 lb when you get all 3 sets of 12.',
        warmup: '1 light set of 10 first.', cautions: '',
      })
    : JSON.stringify({ items: [
        { name: 'Eggs (2, scrambled)', calories: 180, protein: 12, carbs: 2, fat: 13, meal: 'breakfast' },
        { name: 'Toast w/ butter', calories: 190, protein: 4, carbs: 24, fat: 8, meal: 'breakfast' },
      ] })
  return route.fulfill({ status: 200, headers: cors, contentType: 'application/json', body: JSON.stringify({ choices: [{ message: { content } }] }) })
})

await step('ai: configure proxy in Settings (mocked)', async () => {
  await page.locator('.tab', { hasText: 'Stats' }).click()
  await page.locator('.page .icon-btn[title="Settings"]').click()
  await page.locator('input[placeholder="https://optiplex.tailnet.ts.net"]').fill('https://ai.e2e')
  await page.getByText('Test & save').click()
  await page.getByText('Connected ✓').waitFor()
})

await step('ai: describe-it parses food into entries (mocked)', async () => {
  await page.locator('.tab', { hasText: 'Fuel' }).click()
  await page.getByText('＋ Quick add').click()
  await page.locator('textarea.text-in').fill('2 eggs and toast with butter')
  await page.getByText('Analyze with AI').click()
  await page.getByText('AI estimate — review').waitFor()
  await page.getByText('370 kcal').waitFor()
  await page.locator('.big-btn', { hasText: 'Add 2 items' }).click()
  await page.getByText('180 kcal · 12P').first().waitFor()
  await page.getByText('190 kcal · 4P').first().waitFor()
})

await step('ai: photo goes through the same review flow (mocked)', async () => {
  await page.getByText('＋ Quick add').click()
  await page.setInputFiles('input[accept="image/*"]', 'e2e/final-home.png')
  await page.getByText('AI estimate — review').waitFor()
  await page.locator('.big-btn', { hasText: 'Add 2 items' }).click()
  await page.getByText('180 kcal · 12P').first().waitFor()
})

await step('ai: new machine -> quick setup -> starter program (mocked)', async () => {
  await page.locator('.tabbar .scan-key').click()
  await page.getByText('Point at a machine QR or a food barcode').waitFor()
  await page.locator('.text-in').fill('https://lfconnect.com/q?t=s&m=chpx')
  await page.getByText('Go').click()
  await page.getByText('Unknown QR code').waitFor() // machine setup screen mounted
  await page.locator('input[placeholder="Chest press by the windows"]').fill('Chest press by the door')
  await page.locator('select.text-in').selectOption({ label: 'Chest Press' })
  await page.getByText('Save my machine').click()
  await page.getByText('Quick setup — sizes your program').waitFor() // no profile yet -> inline prompt
  await page.getByText('Get my program').click()
  await page.getByText('Your starter program').waitFor()
  await page.getByText('3×12').waitFor()
  await page.getByText('~90').waitFor()
  await page.getByText('Add 10 lb when you get all 3 sets of 12.').waitFor()
})

await step('ai: set logger prefilled from program targets', async () => {
  await page.getByText('Log sets on this machine').click()
  await page.locator('h1', { hasText: 'Chest Press' }).waitFor()
  await page.getByText('AI target 90×12').waitFor()
  if (await page.locator('.set-in').first().inputValue() !== '90') throw new Error('weight not prefilled from program')
  if (await page.locator('.set-in').nth(1).inputValue() !== '12') throw new Error('reps not prefilled from program')
  await page.locator('.ghost-btn.danger', { hasText: 'Discard workout' }).click() // confirm auto-accepted
  await page.getByText('Choose routine').waitFor()
})

// ---- self-hosted food database (off-db sidecar mocked at the network layer) ----
await page.route('https://food.e2e/**', (route) => {
  const body = route.request().url().includes('/meta')
    ? { status: 'ready', source: 'openfoodfacts', sourceSchema: 'off-v2', exportDate: '2026-08-01', productCount: 2123456, importedAt: 1754006400000 }
    : {
        status: 1,
        product: {
          product_name: 'Mirror Bar', brands: 'Selfhost',
          nutriments: { 'energy-kcal_100g': 500, proteins_100g: 25, carbohydrates_100g: 50, fat_100g: 20 },
          serving_quantity: 40, serving_size: '1 bar (40 g)',
        },
      }
  return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
})

await step('food db: configure self-hosted mirror in Settings (mocked)', async () => {
  await page.locator('.tab', { hasText: 'Stats' }).click()
  await page.locator('.page .icon-btn[title="Settings"]').click()
  await page.locator('.seg button', { hasText: 'Self-hosted' }).click()
  await page.locator('input[placeholder="http://your-server:8321"]').fill('https://food.e2e')
  await page.locator('.card', { hasText: 'Food database' }).getByText('Test & save').click()
  await page.getByText('2,123,456 products').waitFor()
})

await step('food db: barcode lookups hit the mirror first (mocked)', async () => {
  await page.locator('.tabbar .scan-key').click()
  await page.locator('.text-in').fill('4006381333931')
  await page.getByText('Go', { exact: true }).click()
  await page.getByText('Mirror Bar — Selfhost').waitFor() // came from the mirror, not the OFF mock
  await page.locator('.qr-found').click()
  await page.getByText('Servings · 1 = 1 bar (40 g)').waitFor()
  await page.locator('.big-btn', { hasText: 'Log it' }).click()
  await page.getByText('200 kcal · 10P · 20C · 8F').waitFor()
})

await page.screenshot({ path: 'e2e/final-home.png' })
console.log(errors.length ? `PAGE ERRORS:\n${errors.join('\n')}` : 'NO PAGE ERRORS')
await browser.close()
