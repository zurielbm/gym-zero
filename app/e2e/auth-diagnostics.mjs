import assert from 'node:assert/strict'
import { build } from 'esbuild'

const bundle = await build({ entryPoints: ['src/lib/auth-diagnostics.ts'], bundle: true, write: false, platform: 'node', format: 'esm' })
const { observeAuthRequest } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
const original = { warn: console.warn, info: console.info, debug: console.debug }
const logs = []
for (const level of Object.keys(original)) console[level] = (...args) => logs.push({ level, args })

try {
  const privateData = 'SECRET-MUST-NEVER-BE-LOGGED'
  const response = { data: { token: privateData, user: { email: privateData, name: privateData } }, error: null }
  assert.equal(await observeAuthRequest('sign-in', async () => response), response)
  assert.equal(logs.at(-1).args[1].outcome, 'success')

  let attempts = 0
  const failure = { data: null, error: { status: 401, message: privateData, body: { password: privateData } } }
  assert.equal(await observeAuthRequest('sign-in', async () => { attempts++; return failure }), failure)
  assert.equal(attempts, 1, 'diagnostics must not retry authentication')
  assert.equal(logs.at(-1).args[1].status, 401)

  const thrown = new TypeError(privateData)
  await assert.rejects(observeAuthRequest('session-token', async () => { throw thrown }), (e) => e === thrown)
  assert.equal(logs.at(-1).args[1].outcome, 'failure')
  await observeAuthRequest('session-token', async () => ({ data: {}, error: null }))
  assert.equal(logs.at(-1).args[1].reason, 'missing-data')
  await observeAuthRequest('session-token', async () => response)
  assert.equal(logs.at(-1).level, 'debug', 'routine renewal should not produce warnings')
  await observeAuthRequest('sign-out', async () => ({ data: null, error: null }))
  assert.equal(logs.at(-1).args[1].outcome, 'success')
  assert.equal(JSON.stringify(logs).includes(privateData), false, 'private data and raw errors must never be logged')

  // A broken console must neither fail successful login nor replace its error.
  for (const level of Object.keys(original)) console[level] = () => { throw new Error('console failed') }
  assert.equal(await observeAuthRequest('sign-in', async () => response), response)
  await assert.rejects(observeAuthRequest('sign-in', async () => { throw thrown }), (e) => e === thrown)
} finally {
  Object.assign(console, original)
}
console.log('Auth diagnostics passed: results/errors preserved, no retries, sensitive fields excluded, console failures isolated.')
