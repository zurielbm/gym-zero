// Camera barcode scan against a dev server (default localhost:5199).
// Feeds chromium a fake camera playing e2e/.fixtures/ean13.y4m (EAN-13
// 4006381333931) and expects the scan screen to decode it via the zxing-wasm
// BarcodeDetector and show the (mocked) Open Food Facts product card.
//
// The PNG fixture is committed; the y4m is rebuilt from it on demand (ffmpeg).
// Regenerate the PNG itself with:
//   node --input-type=module -e "import {writeBarcode} from 'zxing-wasm/full'; const r = await writeBarcode('4006381333931', {format:'EAN13', scale:4}); (await import('fs')).writeFileSync('e2e/.fixtures/ean13.png', Buffer.from(await r.image.arrayBuffer()))"
import { chromium } from 'playwright-core'
import { homedir } from 'os'
import { readdirSync, existsSync } from 'fs'
import { resolve } from 'path'
import { execFileSync } from 'child_process'

const png = resolve('e2e/.fixtures/ean13.png')
const y4m = resolve('e2e/.fixtures/ean13.y4m')
if (!existsSync(y4m)) {
  if (!existsSync(png)) throw new Error(`missing fixture ${png} — see regen instructions at the top of this file`)
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-loop', '1', '-i', png,
    '-vf', 'scale=560:-1:flags=neighbor,pad=640:480:(ow-iw)/2:(oh-ih)/2:white',
    '-pix_fmt', 'yuv420p', '-t', '1', '-r', '5', y4m])
}

const cache = `${homedir()}/Library/Caches/ms-playwright`
const shellDir = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop()
if (!shellDir) throw new Error('no chromium headless shell in playwright cache')
const exe = `${cache}/${shellDir}/chrome-headless-shell-mac-arm64/chrome-headless-shell`

const browser = await chromium.launch({
  executablePath: exe,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${y4m}`,
  ],
})
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
const errors = []
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`) })

// the zxing wasm must come from our own bundle, never a CDN
const cdnRequests = []
page.on('request', (r) => { if (/jsdelivr|unpkg|cdnjs/.test(r.url())) cdnRequests.push(r.url()) })

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

const step = async (name, fn) => {
  try { await fn(); console.log(`PASS ${name}`) }
  catch (e) {
    console.log(`FAIL ${name}: ${String(e).split('\n')[0]}`)
    await page.screenshot({ path: `e2e/fail-${name.replace(/\W+/g, '-')}.png` })
    process.exitCode = 1
  }
}

await page.goto(process.env.BASE_URL ?? 'http://localhost:5199/')

await step('camera EAN-13 -> wasm decode -> product card', async () => {
  await page.locator('.tabbar .scan-key').click()
  await page.getByText('Point at a machine QR or a food barcode').waitFor({ timeout: 8000 })
  await page.getByText('Protein Bar — Barbebest').waitFor({ timeout: 15000 })
  await page.getByText('400 kcal per 100 g').waitFor()
})

await step('wasm served from our bundle, not a CDN', async () => {
  if (cdnRequests.length) throw new Error(`CDN hit: ${cdnRequests.join(', ')}`)
})

await step('no page errors', async () => {
  if (errors.length) throw new Error(errors.join(' | '))
})

await browser.close()
