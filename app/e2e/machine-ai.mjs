import assert from 'node:assert/strict'
import { chromium } from 'playwright-core'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 375, height: 812 } })
page.setDefaultTimeout(6000)
let mode = 'normal'
const requests = []
await page.route('https://machine.ux.test/**', async (route) => {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }
  if (route.request().method() === 'OPTIONS') return route.fulfill({ headers, status: 204 })
  if (route.request().method() === 'GET') return route.fulfill({ headers, json: { data: [] } })
  const data = route.request().postDataJSON()
  requests.push(data)
  if (mode === 'slow') await new Promise((resolve) => setTimeout(resolve, 1200))
  const program = data.messages[0].content.includes('starter program')
  const result = program ? { sets: 3, reps: 12, startWeightLb: data.messages[1].content.includes('too heavy') ? 30 : 50, restSeconds: 75, effortCheck: 'Use a comfortable weight.', progression: 'Add weight gradually.' }
    : { identified: mode !== 'unknown', manufacturer: 'Life Fitness', modelName: 'Dual Fly', confidence: 'medium', exerciseIds: ['ex-pec-fly', 'ex-rear-delt-fly'], muscleGroups: ['chest', 'back'], howTo: ['Move slowly.'] }
  await route.fulfill({ headers, json: { choices: [{ message: { content: JSON.stringify(result) } }] } }).catch(() => {})
})
const programs = () => page.evaluate(async () => { const {db} = await import('/src/data/db.ts'); return db.aiPrograms.toArray() })
try {
  await page.goto(process.env.BASE_URL ?? 'http://localhost:5173/')
  await page.getByText('Start Workout', { exact: false }).waitFor()
  await page.evaluate(async () => {
    const {default: api} = await import('/src/data/index.ts')
    await api.patchSettings({ aiEndpoint: 'https://machine.ux.test', experience: 'new', goal: 'general' })
    await api.saveMachine({ id: 'dual-ux', nickname: 'Dual machine', qrUrl: 'https://example.test/dual', exerciseId: 'ex-pec-fly', exerciseIds: ['ex-pec-fly', 'ex-rear-delt-fly'], favorite: true })
  })
  await page.reload()
  await page.locator('.tabbar .scan-key').click()
  await page.getByLabel('Or enter a QR link / barcode digits').fill('https://example.test/dual')
  await page.getByRole('button', { name: 'Go', exact: true }).click()
  await page.getByRole('button', { name: '✦ Get my starter program', exact: true }).click()
  await page.getByText('✦ Your starter program', { exact: true }).waitFor()
  await page.locator('.machine-movement', { hasText: 'Rear Delt Fly' }).click()
  await page.getByRole('button', { name: '✦ Get my starter program', exact: true }).click()
  await page.getByText('✦ Your starter program', { exact: true }).waitFor()
  let rows = await programs()
  assert.deepEqual(rows.map((p) => p.exerciseId).sort(), ['ex-pec-fly', 'ex-rear-delt-fly'])
  const original = rows.find((p) => p.exerciseId === 'ex-pec-fly')
  await page.getByLabel('Adjust your program').fill('The weight is too heavy')
  await page.getByRole('button', { name: 'Update program', exact: true }).click()
  await page.getByText('~30', { exact: true }).waitFor()
  rows = await programs()
  assert.deepEqual(rows.find((p) => p.exerciseId === 'ex-pec-fly'), original)
  mode = 'slow'
  await page.getByRole('button', { name: 'Recalculate', exact: false }).click()
  await page.getByRole('button', { name: 'Stop request' }).click()
  await page.waitForTimeout(1300)
  assert.equal((await programs()).find((p) => p.exerciseId === 'ex-rear-delt-fly').startWeightLb, 30)
  mode = 'unknown'
  await page.getByRole('button', { name: '✦ Ask AI what this is', exact: true }).click()
  await page.getByText('AI could not identify this machine yet.', { exact: false }).waitFor()
  await page.getByLabel('Correct or clarify the guide').fill('Life Fitness dual fly station')
  mode = 'normal'
  await page.getByRole('button', { name: 'Update AI guide', exact: true }).click()
  await page.getByText('AI guide', { exact: false }).first().waitFor()
  assert(requests.some((r) => r.messages[1].content.includes('Life Fitness dual fly station')))
  console.log('PASS separate machine programs; feedback; cancellation; failed identification recovery')
} catch(error) { console.log('requests', requests.map(r=>r.messages[1].content)); console.log('programs', await programs()); throw error }
finally { await browser.close() }
