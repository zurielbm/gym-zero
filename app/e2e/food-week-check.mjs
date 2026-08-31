// Weekly food stats walkthrough against a dev server (default localhost:5199):
// empty state, seeded week with a gap day, averages over logged days only,
// consistency strip, week-over-week chip, and the 4-week calorie trend card.
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
  catch (e) { console.log(`FAIL ${name}: ${String(e).split('\n')[0]}`); await page.screenshot({ path: `e2e/fail-food-week-${name.replace(/\W+/g, '-')}.png` }) }
}
const tab = (name) => page.locator('.tab', { hasText: name })

const dayKeyAgo = (offset) => {
  const d = new Date()
  d.setDate(d.getDate() - offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

// This week: 6 logged days, offset 2 deliberately empty (the gap day).
// avg 2,000 kcal / 167 g protein; protein target (180) hit on 3 days.
const food = [
  { offset: 0, calories: 1800, protein: 150 },
  { offset: 1, calories: 2200, protein: 180, carbs: 200, fat: 80 },
  { offset: 3, calories: 2400, protein: 190 },
  { offset: 4, calories: 2000, protein: 170, carbs: 180, fat: 60 },
  { offset: 5, calories: 1600, protein: 120 },
  { offset: 6, calories: 2000, protein: 190 },
  // previous week, avg 2,400 kcal → chip ▼ 17%, and a second bar for the trend card
  { offset: 8, calories: 2500, protein: 160 },
  { offset: 10, calories: 2300, protein: 150 },
].map((r, i) => ({ id: `wk-food-${i}`, date: dayKeyAgo(r.offset), meal: 'lunch', name: `Seed meal ${i}`, calories: r.calories, protein: r.protein, ...(r.carbs ? { carbs: r.carbs, fat: r.fat } : {}) }))

// Drinks on 3 days: avg 58 oz on drink days; default target 64 oz hit twice.
const drinks = [
  { offset: 0, volumeOz: 40 },
  { offset: 1, volumeOz: 64 },
  { offset: 3, volumeOz: 70 },
].map((r, i) => ({ id: `wk-drink-${i}`, date: dayKeyAgo(r.offset), at: Date.now() - r.offset * 86400_000, kind: 'water', volumeOz: r.volumeOz }))

await page.goto('http://localhost:5199/')
await page.getByText('Start Workout').waitFor({ timeout: 8000 })

await step('empty state points to the Fuel tab', async () => {
  await tab('Stats').click()
  await page.getByText('Fuel · last 7 days').waitFor()
  await page.getByText('No food logged yet').waitFor()
  await page.getByRole('button', { name: 'Log food ›' }).waitFor()
})

await step('seed a week of entries straight into IndexedDB', async () => {
  await page.evaluate(async (rows) => {
    const dbs = await indexedDB.databases()
    const name = dbs.map((d) => d.name).filter((n) => n && n.startsWith('gym-tracker')).sort((a, b) => b.length - a.length)[0]
    if (!name) throw new Error('gym-tracker database not found')
    const open = indexedDB.open(name)
    const db = await new Promise((res, rej) => { open.onsuccess = () => res(open.result); open.onerror = () => rej(open.error) })
    await new Promise((res, rej) => {
      const tx = db.transaction(['food', 'drinks'], 'readwrite')
      for (const r of rows.food) tx.objectStore('food').put(r)
      for (const r of rows.drinks) tx.objectStore('drinks').put(r)
      tx.oncomplete = res
      tx.onerror = () => rej(tx.error)
    })
    db.close()
  }, { food, drinks })
})

await step('calories card: avg over logged days, plain-words summary', async () => {
  await tab('Home').click()
  await page.getByText('Start Workout').waitFor()
  await tab('Stats').click()
  await page.getByText('Calories · avg on logged days').waitFor()
  await page.getByText('2,000', { exact: false }).first().waitFor()
  await page.getByText('/ 2,200 kcal').waitFor()
  await page.getByText('You averaged 2,000 kcal on the 6 days you logged — a little under your 2,200 target.', { exact: false }).waitFor()
})

await step('week-over-week chip: lower and closer to target', async () => {
  await page.getByText('▼ 17% vs prior wk').waitFor()
  const chip = page.locator('.chip', { hasText: 'vs prior wk' })
  if (!(await chip.getAttribute('class')).includes('green')) throw new Error('closer-to-target week should be a green chip')
})

await step('the unlogged day renders as a gap in both food charts', async () => {
  const gaps = await page.locator('.spark i.gap').count()
  if (gaps !== 2) throw new Error(`expected 2 gap bars (calories + protein), got ${gaps}`)
})

await step('protein card: avg, target line, carbs/fat context', async () => {
  await page.getByText('Protein · avg on logged days').waitFor()
  await page.getByText('/ 180 g').waitFor()
  await page.getByText('Also averaged 63 g carbs · 23 g fat', { exact: false }).waitFor()
})

await step('water card + consistency strip', async () => {
  await page.getByText('/ about 64 oz avg').waitFor()
  await page.getByText('Days logged').waitFor()
  const strip = page.locator('.stat-strip', { hasText: 'Days logged' })
  for (const expected of ['6/7', '3/7', '2/7']) {
    if (!(await strip.textContent()).includes(expected)) throw new Error(`stat strip missing ${expected}`)
  }
})

await step('4-week calorie trend card appears with two weeks of data', async () => {
  await page.getByText('Calorie trend · 4 wk').waitFor()
  await page.getByText('Avg kcal on logged days, per week').waitFor()
})

console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'NO PAGE ERRORS')
await browser.close()
