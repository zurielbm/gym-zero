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
  await page.locator('.fab').click()
  await page.getByText('Scan machine').waitFor()
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
  await page.locator('.fab').click()
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
  await page.getByText('Workout done 🎉').waitFor()
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

await step('food: saved meal chip adds entry + stats update', async () => {
  await page.locator('.tab', { hasText: 'Food' }).click()
  await page.getByText('Quick add — saved meals').waitFor()
  await page.getByText('🥤 Protein shake').click()
  await page.getByText('340 kcal · 48P').waitFor()
})

await step('food: quick add custom entry', async () => {
  await page.getByText('＋ Quick add').click()
  await page.locator('input.text-in').first().fill('Chicken bowl')
  await page.locator('input[inputmode="numeric"]').nth(0).fill('650')
  await page.locator('input[inputmode="numeric"]').nth(1).fill('45')
  await page.locator('.big-btn', { hasText: 'Add' }).click()
  await page.getByText('650 kcal · 45P').waitFor()
})

await step('history: workout listed with volume + week strip', async () => {
  await page.locator('.tab', { hasText: 'History' }).click()
  await page.getByText('Weekly volume').waitFor()
  await page.locator('.cal-day.did').first().waitFor()
  await page.getByText('“felt strong”').waitFor()
})

await step('history: log body weight', async () => {
  await page.locator('input[inputmode="decimal"]').fill('182.4')
  await page.getByText('Log', { exact: true }).click()
  await page.getByText('182.4 lb').waitFor()
})

await step('persistence: reload keeps food + history (IndexedDB)', async () => {
  await page.reload()
  await page.getByText('Start Workout').waitFor({ timeout: 8000 })
  await page.locator('.tab', { hasText: 'History' }).click()
  await page.getByText('“felt strong”').waitFor()
  await page.getByText('182.4 lb').waitFor()
  await page.locator('.tab', { hasText: 'Food' }).click()
  await page.getByText('650 kcal · 45P').waitFor()
})

await page.screenshot({ path: 'e2e/final-home.png' })
console.log(errors.length ? `PAGE ERRORS:\n${errors.join('\n')}` : 'NO PAGE ERRORS')
await browser.close()
