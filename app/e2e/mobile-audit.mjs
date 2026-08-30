// Mobile responsiveness audit at iPhone 12 Pro size. Read-only; prints a report.
// Exits 1 on regressions: horizontal overflow or inputs under 16px (sticky iOS zoom).
// Sub-40px touch targets are reported as warnings.
import { chromium } from 'playwright-core'
import { homedir } from 'os'
import { readdirSync, mkdirSync } from 'fs'

const cache = `${homedir()}/Library/Caches/ms-playwright`
const shellDir = readdirSync(cache).filter((d) => d.startsWith('chromium_headless_shell-')).sort().pop()
if (!shellDir) throw new Error('no chromium headless shell in playwright cache')
const exe = `${cache}/${shellDir}/chrome-headless-shell-mac-arm64/chrome-headless-shell`
const browser = await chromium.launch({ executablePath: exe, args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'] })
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  hasTouch: true,
  isMobile: true,
  deviceScaleFactor: 3,
  permissions: ['camera'],
  userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
})
const page = await context.newPage()
page.on('dialog', (d) => d.accept())
mkdirSync('e2e/audit', { recursive: true })

const BASE = process.env.BASE_URL ?? 'http://localhost:5173/'
const failures = []

const auditPage = async (label) => {
  await page.waitForTimeout(700)
  const report = await page.evaluate(() => {
    const vw = window.innerWidth
    const out = { overflowPx: document.documentElement.scrollWidth - vw, wideElems: [], smallTargets: [], zoomInputs: [] }
    const visible = (el) => { const s = getComputedStyle(el); return s.display !== 'none' && s.visibility !== 'hidden' }
    const sig = (el) => {
      const id = el.id ? `#${el.id}` : ''
      const cls = typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''
      const txt = (el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 40)
      return `${el.tagName.toLowerCase()}${id}${cls}${txt ? ` "${txt}"` : ''}`
    }
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el)) continue
      const r = el.getBoundingClientRect()
      if (r.width === 0 && r.height === 0) continue
      if (r.right > vw + 1 || r.left < -1) {
        const cs = getComputedStyle(el)
        out.wideElems.push({ el: sig(el), left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width), pos: cs.position })
      }
      const interactive = el.matches('button, a, input, select, [role=button], [onclick]')
      if (interactive && r.width > 0 && r.height > 0 && (r.width < 40 || r.height < 40)) {
        out.smallTargets.push({ el: sig(el), w: Math.round(r.width), h: Math.round(r.height) })
      }
      if (el.matches('input, select, textarea')) {
        const fs = parseFloat(getComputedStyle(el).fontSize)
        if (fs < 16) out.zoomInputs.push({ el: sig(el), fontSize: fs })
      }
    }
    out.wideElems = out.wideElems.slice(0, 15)
    out.smallTargets = out.smallTargets.slice(0, 25)
    out.zoomInputs = out.zoomInputs.slice(0, 15)
    return out
  })
  console.log(`\n===== ${label} =====`)
  console.log(`horizontal overflow: ${report.overflowPx}px`)
  if (report.overflowPx > 0) failures.push(`${label}: ${report.overflowPx}px horizontal overflow`)
  if (report.wideElems.length) { console.log('elements past viewport edge:'); for (const e of report.wideElems) console.log(`  [${e.pos}] left=${e.left} right=${e.right} w=${e.w}  ${e.el}`) }
  if (report.smallTargets.length) { console.log('WARN touch targets < 40px:'); for (const e of report.smallTargets) console.log(`  ${e.w}x${e.h}  ${e.el}`) }
  if (report.zoomInputs.length) {
    console.log('inputs with font-size < 16px (iOS zoom):')
    for (const e of report.zoomInputs) console.log(`  ${e.fontSize}px  ${e.el}`)
    failures.push(`${label}: ${report.zoomInputs.length} input(s) under 16px`)
  }
  await page.screenshot({ path: `e2e/audit/${label.replace(/\W+/g, '-')}.png`, fullPage: false })
}

const clickTab = async (name) => {
  const tab = page.locator('button.tab', { hasText: name }).locator('visible=true')
  try { await tab.first().click({ timeout: 4000 }); return true }
  catch (e) { console.log(`(could not tap tab ${name}: ${String(e).split('\n')[0]})`); return false }
}

await page.goto(BASE)
await page.waitForTimeout(1500)
await auditPage('home')

if (await clickTab('Train')) await auditPage('tab-train')
if (await clickTab('Fuel')) await auditPage('tab-fuel')
if (await clickTab('Stats')) await auditPage('tab-stats')

// center scan button in the tab bar (no text label)
const scanBtn = page.locator('.tabbar button:not(.tab), nav button:not(.tab), button.scan, button.tab-scan, [class*=scan]').locator('visible=true')
console.log(`\nscan-button candidates: ${await scanBtn.count()}`)
if (await scanBtn.count() > 0) {
  const info = await scanBtn.first().evaluate((el) => ({ cls: el.className, html: el.outerHTML.slice(0, 200) }))
  console.log(`tapping: ${JSON.stringify(info)}`)
  try { await scanBtn.first().click({ timeout: 4000 }); await auditPage('scanner') } catch (e) { console.log(`(scan tap failed: ${String(e).split('\n')[0]})`) }
}

// food logging via Fuel tab
await clickTab('Fuel')
await page.waitForTimeout(500)
for (const t of ['Log food', 'Add food', '+']) {
  const loc = page.getByText(t, { exact: t === '+' }).locator('visible=true')
  if (await loc.count() > 0) { try { await loc.first().click({ timeout: 3000 }); console.log(`\ntapped "${t}"`); break } catch {} }
}
await auditPage('fuel-log-food')

// look for photo/AI logging affordances
for (const w of ['Photo', 'photo', 'Camera', 'AI']) {
  const loc = page.getByText(w).locator('visible=true')
  if (await loc.count() > 0) {
    console.log(`found "${w}" (${await loc.count()})`)
    try { await loc.first().click({ timeout: 3000 }); await auditPage(`food-${w.toLowerCase()}`); break } catch {}
  }
}

console.log('\nDone. Screenshots in e2e/audit/')
await browser.close()
if (failures.length) {
  console.log('\nFAIL:')
  for (const f of failures) console.log(`  ${f}`)
  process.exit(1)
}
console.log('PASS: no overflow, no sub-16px inputs')
