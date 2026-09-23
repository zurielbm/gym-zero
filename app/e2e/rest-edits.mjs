import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright-core'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce', isMobile: true, hasTouch: true })
const out = process.env.AUDIT_DIR ?? 'e2e/qol-audit/rest-edits'
mkdirSync(out, { recursive: true })
page.setDefaultTimeout(7000)
const errors = []
page.on('pageerror', error => errors.push(error.message))
await page.addInitScript(() => {
  window.__chimeStarts = []
  const Native = window.AudioContext
  window.AudioContext = class extends Native {
    createOscillator() {
      const oscillator = super.createOscillator()
      const start = oscillator.start.bind(oscillator)
      oscillator.start = (...args) => { window.__chimeStarts.push({ frequency: oscillator.frequency.value, at: Date.now() }); return start(...args) }
      return oscillator
    }
  }
})
const api = (fn, ...args) => page.evaluate(async ({ fn, args }) => {
  const { default: api } = await import('/src/data/index.ts')
  return api[fn](...args)
}, { fn, args })
const audioCount = () => page.evaluate(() => window.__chimeStarts.length)
const tab = name => page.locator('.tabbar').getByRole('button', { name, exact: true }).click()
const dismiss = async () => { const b = page.getByRole('button', { name: 'Dismiss notification' }); if (await b.count()) await b.click() }
const focus = async locator => locator.evaluate(el => { const sc = document.querySelector('.screen'); sc.scrollTop += el.getBoundingClientRect().top - sc.getBoundingClientRect().top - 16 })
const editForm = () => page.locator('form.set-editor')
try {
  await page.goto(process.env.BASE_URL ?? 'http://localhost:5173/')
  await page.getByText('Start Workout', { exact: false }).waitFor()
  await api('patchSettings', { restSeconds: 6 })
  const workout = await api('startWorkout', 'rt-legs')
  await page.reload(); await tab('Train')
  await page.getByLabel('Set 1 weight in pounds').fill('90')
  await page.getByLabel('Set 1 reps', { exact: true }).fill('10')
  await page.getByRole('button', { name: 'Log set 1', exact: true }).click()
  await page.locator('.saved-set').waitFor()
  const first = (await api('listSets', workout.id))[0]
  await page.getByRole('button', { name: 'Edit set 1', exact: true }).click()
  assert(await editForm().getByRole('button', { name: 'Save changes' }).isDisabled())
  await editForm().getByLabel('Reps', { exact: true }).fill('12.5')
  assert(await editForm().getByRole('button', { name: 'Save changes' }).isDisabled())
  await editForm().getByLabel('Reps', { exact: true }).fill('14')
  await dismiss(); await focus(editForm()); await page.screenshot({ path: `${out}/edit-active.png` })
  await editForm().getByRole('button', { name: 'Save changes' }).evaluate(button => { button.click(); button.click() })
  await page.locator('.saved-set .edited-set-label').waitFor()
  let rows = await api('listSets', workout.id)
  assert.equal(rows.length, 1); assert.equal(rows[0].reps, 14)
  assert.equal(rows[0].id, first.id); assert.equal(rows[0].loggedAt, first.loggedAt)
  assert.deepEqual(rows[0].originalValues, { weightLb: 90, reps: 10 }); assert(rows[0].editedAt)
  // Rest should complete once within the original six-second window, despite the correction.
  await page.getByText('Rest complete — ready for your next set', { exact: true }).waitFor()
  assert.equal(await audioCount(), 2, 'one two-note chime')
  const sounds = await page.evaluate(() => window.__chimeStarts)
  assert(sounds[0].at - first.loggedAt < 7500, 'editing did not restart rest')
  await page.waitForTimeout(350); assert.equal(await audioCount(), 2)
  await dismiss(); await page.locator('.screen').evaluate(el => el.scrollTop = 0); await page.screenshot({ path: `${out}/edited-active.png` })
  console.log('PASS real AudioContext chime once at completion; no restart on edit; valid corrections, double-tap protection and original set identity')

  // Skip must stay silent; muting during an active timer must affect its eventual completion.
  await page.getByRole('button', { name: 'Log set 2', exact: true }).click()
  await page.locator('.rest-toast').getByRole('button', { name: 'Skip', exact: true }).click()
  const beforeSkip = await audioCount()
  await page.waitForTimeout(6200); assert.equal(await audioCount(), beforeSkip)
  await page.getByRole('button', { name: 'Log set 3', exact: true }).click()
  await tab('Home'); await page.getByRole('button', { name: 'Settings', exact: true }).locator('visible=true').click()
  await page.getByRole('switch', { name: 'Rest completion sound' }).click()
  await page.getByText('Rest sound off', { exact: true }).waitFor()
  await page.waitForTimeout(6200); assert.equal(await audioCount(), beforeSkip)
  assert.equal((await api('getSettings')).restSoundEnabled, false)
  await dismiss(); await focus(page.locator('.rest-sound-settings')); await page.screenshot({ path: `${out}/sound-settings.png` })
  await page.getByRole('button', { name: 'Preview chime', exact: true }).click()
  await page.waitForTimeout(150); assert.equal(await audioCount(), beforeSkip + 2, 'preview works even while timer sound is off')
  await page.reload(); await tab('Train')
  assert.equal((await api('getSettings')).restSoundEnabled, false)
  assert.equal(await page.locator('.edited-set-label').count(), 1)
  await page.getByRole('button', { name: 'Edit set 1', exact: true }).click()
  await editForm().getByLabel('Reps', { exact: true }).fill('99')
  await editForm().getByRole('button', { name: 'Cancel', exact: true }).click()
  assert.equal((await api('listSets', workout.id))[0].reps, 14)
  console.log('PASS skip silent; mute changes affect running timer and persist; preview; edited marker reloads; cancelling leaves numbers unchanged')

  await page.getByRole('button', { name: 'Finish workout', exact: false }).click()
  await page.getByText('Workout complete', { exact: true }).waitFor()
  const before = await api('getWorkoutSummary', workout.id)
  await page.getByRole('button', { name: 'Edit Leg Press set 1', exact: true }).click()
  await editForm().getByLabel('Reps', { exact: true }).fill('16')
  await editForm().getByRole('button', { name: 'Save changes', exact: true }).click()
  await page.getByText('Set 1 updated — workout totals refreshed', { exact: true }).waitFor()
  const after = await api('getWorkoutSummary', workout.id)
  assert.equal(after.workout.finishedAt, before.workout.finishedAt)
  assert.equal(after.durationSec, before.durationSec)
  assert.equal(after.totalVolumeLb, before.totalVolumeLb + 180)
  assert.equal(after.setCount, before.setCount)
  await dismiss(); await focus(page.locator('.summary-sets')); await page.screenshot({ path: `${out}/edited-history.png` })
  await page.getByRole('button', { name: 'Back to Stats', exact: false }).click()
  await page.getByRole('button', { name: `Review workout from ${workout.date}`, exact: true }).click()
  await page.getByText('90 lb × 16 reps', { exact: true }).waitFor()
  assert.equal(await page.locator('.edited-set-label').count(), 1)
  console.log('PASS finished-set editing updates totals without changing duration/count; Stats review path shows persistent edit')

  const integrity = await page.evaluate(async ({ first, workoutId }) => {
    const { default: api } = await import('/src/data/index.ts')
    const { exportBackup, importBackup } = await import('/src/data/backup.ts')
    const current = (await api.listSets(workoutId)).find(row => row.id === first.id)
    const noOp = await api.updateSet(current.id, { weightLb: current.weightLb, reps: current.reps })
    const result = { noOp: noOp.editedAt === current.editedAt, original: noOp.originalValues, invalid: false, conflict: false, rollback: false, preserved: false, backup: false }
    try { await api.updateSet(current.id, { weightLb: -1, reps: 16 }) } catch { result.invalid = true }
    try { await api.updateSet(current.id, { weightLb: 90, reps: 17 }, first) } catch { result.conflict = true }
    await api.saveBaseline({ id: current.exerciseId, weightLb: current.weightLb, reps: current.reps, at: current.loggedAt })
    // Put a baseline known to derive from the current set, matching production promotion metadata.
    const { db } = await import('/src/data/db.ts')
    await db.baselines.put({ id: current.exerciseId, weightLb: current.weightLb, reps: current.reps, at: current.loggedAt })
    await api.updateSet(current.id, { weightLb: 20, reps: 1 })
    const base = await api.getBaseline(current.exerciseId)
    result.rollback = base.weightLb === 90 && base.reps === 14
    const updated = (await api.listSets(workoutId)).find(row => row.id === current.id)
    result.preserved = updated.loggedAt === current.loggedAt && updated.machineId === current.machineId && updated.exerciseId === current.exerciseId && updated.setNumber === current.setNumber
    const backup = await exportBackup(); await importBackup(backup)
    result.backup = (await api.listSets(workoutId)).find(row => row.id === current.id).editedAt === updated.editedAt
    return result
  }, { first, workoutId: workout.id })
  assert.deepEqual(integrity, { noOp: true, original: { weightLb: 90, reps: 10 }, invalid: true, conflict: true, rollback: true, preserved: true, backup: true })
  for (const width of [320, 375, 390, 430, 1280]) {
    await page.setViewportSize({ width, height: 844 })
    await page.getByRole('button', { name: 'Edit Leg Press set 2', exact: true }).click()
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    assert(await editForm().evaluate(el => el.scrollWidth <= el.clientWidth + 1))
    const targets = await editForm().locator('button,input').evaluateAll(els => els.map(el => { const r = el.getBoundingClientRect(); return { height: r.height, font: parseFloat(getComputedStyle(el).fontSize), tag: el.tagName } }))
    assert(targets.every(target => target.height >= 44 && (target.tag !== 'INPUT' || target.font >= 16)))
    await editForm().getByRole('button', { name: 'Cancel', exact: true }).click()
  }
  console.log('PASS no-op/invalid/conflicting edits; baseline correction; identity and backup preservation; five widths and touch/input sizes')

  const rendered = await page.evaluate(async () => {
    const { renderRestChime } = await import('/src/lib/rest-chime.ts')
    const rate = 44100
    const context = new OfflineAudioContext(1, rate * 1.8, rate)
    renderRestChime(context, 0)
    const buffer = await context.startRendering()
    const samples = buffer.getChannelData(0)
    let peak = 0, sum = 0, tail = 0
    const wav = new ArrayBuffer(44 + samples.length * 2), view = new DataView(wav)
    const str = (at, value) => [...value].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)))
    str(0, 'RIFF'); view.setUint32(4, 36 + samples.length * 2, true); str(8, 'WAVE'); str(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); str(36, 'data'); view.setUint32(40, samples.length * 2, true)
    samples.forEach((value, i) => { peak = Math.max(peak, Math.abs(value)); sum += value * value; if (i > rate * 1.65) tail = Math.max(tail, Math.abs(value)); view.setInt16(44 + i * 2, Math.round(Math.max(-1, Math.min(1, value)) * 32767), true) })
    let binary = ''; for (const byte of new Uint8Array(wav)) binary += String.fromCharCode(byte)
    return { peak, rms: Math.sqrt(sum / samples.length), tail, wav: btoa(binary) }
  })
  assert(rendered.peak < 0.2 && rendered.peak > 0.05); assert.equal(rendered.tail, 0)
  writeFileSync(`${out}/rest-chime.wav`, Buffer.from(rendered.wav, 'base64'))
  console.log(`PASS rendered audio: peak ${rendered.peak.toFixed(3)}, RMS ${rendered.rms.toFixed(3)}, silent tail; WAV preview exported`)
  assert.deepEqual(errors, [])
} finally { await browser.close() }
