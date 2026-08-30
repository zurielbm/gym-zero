// Hydration card walkthrough against a dev server (default localhost:5199):
// container chips, fractions, deletes, auto/override targets, persistence.
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

const step = async (name, fn) => {
  try { await fn(); console.log(`PASS ${name}`) }
  catch (e) { console.log(`FAIL ${name}: ${String(e).split('\n')[0]}`); await page.screenshot({ path: `e2e/fail-${name.replace(/\W+/g, '-')}.png` }) }
}
const chip = (text) => page.getByRole('button', { name: text, exact: true })

await page.goto('http://localhost:5199/')
await page.getByText('Start Workout').waitFor({ timeout: 8000 })

await step('home shows water bar with auto 64 oz target', async () => {
  await page.getByText('Water', { exact: true }).locator('visible=true').waitFor()
  await page.getByText('0 / 64 oz').waitFor()
})

await step('fuel: hydration card renders with seeded containers', async () => {
  await page.getByRole('button', { name: 'Fuel' }).click()
  await page.getByText('Hydration').waitFor()
  await chip('🚰 Bottle · 24 oz').waitFor()
  await chip('🥛 Glass · 8 oz').waitFor()
  await chip('⚡ Electrolytes · 20 oz').waitFor()
  await page.getByText('Tap a container when you finish it').waitFor()
})

await step('tap bottle -> 24 oz logged, plain words update', async () => {
  await chip('🚰 Bottle · 24 oz').click()
  await page.getByText('24 / 64 oz').waitFor()
  await page.getByText(/About 1 bottle in/).waitFor()
})

await step('half fraction -> glass logs 4 oz', async () => {
  await page.getByRole('button', { name: '½', exact: true }).click()
  await page.getByText('Next tap logs half of that container.').waitFor()
  await chip('🥛 Glass · 4 oz').click()
  await page.locator('.meal-row', { hasText: 'Glass · 4 oz' }).waitFor()
  await page.getByText('28 / 64 oz').waitFor()
})

await step('fraction resets to full after logging', async () => {
  await chip('🚰 Bottle · 24 oz').waitFor()
})

await step('delete a drink -> total drops', async () => {
  await page.locator('.meal-row', { hasText: 'Glass · 4 oz' }).locator('.del').click()
  await page.getByText('24 / 64 oz').waitFor()
})

await step('edit containers: add a shaker', async () => {
  await chip('✎ Edit').click()
  await page.getByPlaceholder('Big bottle').fill('Shaker')
  await page.getByPlaceholder('24').fill('20')
  await page.getByRole('button', { name: 'Shake', exact: true }).click()
  await page.getByRole('button', { name: 'Add container' }).click()
  await page.getByText('20 oz · shake').waitFor()
  await page.getByRole('button', { name: 'Done' }).click()
  await chip('🥤 Shaker · 20 oz').waitFor()
})

await step('home water bar reflects logged oz', async () => {
  await page.getByRole('button', { name: 'Home' }).click()
  await page.getByText('24 / 64 oz').waitFor()
})

await step('settings: water override changes the target', async () => {
  await page.locator('.icon-btn[title="Settings"]:visible').click()
  await page.getByText('Daily targets').waitFor()
  const water = page.getByPlaceholder(/^auto ·/)
  await water.fill('100')
  await water.blur()
  await page.getByText('0 / 100 oz').waitFor({ state: 'attached', timeout: 3000 }).catch(() => {})
  await page.getByRole('button', { name: 'Home' }).click()
  await page.getByText('24 / 100 oz').waitFor()
})

await step('persistence: reload keeps drinks + containers', async () => {
  await page.reload()
  await page.getByText('24 / 100 oz').waitFor({ timeout: 8000 })
  await page.getByRole('button', { name: 'Fuel' }).click()
  await chip('🥤 Shaker · 20 oz').waitFor()
  await page.locator('.meal-row', { hasText: '🚰 Bottle · 24 oz' }).waitFor()
})

await page.screenshot({ path: 'e2e/hydration-fuel.png', fullPage: false })
console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'NO PAGE ERRORS')
await browser.close()
