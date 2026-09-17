// Contract checks for untrusted vision responses; no live AI credentials needed.
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const bundle = await build({ entryPoints: ['src/lib/ai.ts'], bundle: true, write: false, platform: 'node', format: 'esm' })
const { identifyExercisePhoto } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
const catalog = [{ id: 'press', name: 'Chest press', muscleGroups: ['chest'], equipment: 'machine' }]
const photo = 'data:image/jpeg;base64,YQ=='
const config = { endpoint: 'https://ai.example', model: 'vision-model', apiKey: 'test-key' }
let payload
let response
let status = 200
let calls = 0
globalThis.fetch = async (url, options) => {
  calls++
  assert.equal(url, `${config.endpoint}/v1/chat/completions`)
  assert.equal(options.headers.Authorization, 'Bearer test-key')
  payload = JSON.parse(options.body)
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(response) } }] }), { status })
}

response = { identified: true, name: ' Chest press ', confidence: 'high', exerciseIds: ['press', 'invented', 'press', null], muscleGroups: ['chest', 'invalid', 'chest'], howTo: [null, 'Adjust seat'], explanation: 'Visible press handles.' }
const match = await identifyExercisePhoto(config, photo, catalog, 'Machine near the door')
assert.deepEqual(match.exerciseIds, ['press'])
assert.deepEqual(match.muscleGroups, ['chest'])
assert.deepEqual(match.howTo, ['Adjust seat'])
assert.equal(match.name, 'Chest press')
assert.equal(payload.model, 'vision-model')
assert.equal(payload.messages[1].content[0].image_url.url, photo)
assert.ok(payload.messages[1].content[1].text.includes('Machine near the door'))

response = { identified: false, name: 'Random object', confidence: 'high', exerciseIds: ['press'], howTo: ['Guess'] }
const unknown = await identifyExercisePhoto(config, photo, catalog)
assert.equal(unknown.confidence, 'low')
assert.deepEqual(unknown.exerciseIds, [])
assert.deepEqual(unknown.howTo, [])
assert.ok(unknown.explanation)

for (response of [null, [], 'bad', {}, { identified: 'true' }]) {
  await assert.rejects(identifyExercisePhoto(config, photo, catalog), /unreadable result/)
}
const before = calls
await assert.rejects(identifyExercisePhoto(config, 'https://example.com/photo.jpg', catalog), /readable photo/)
assert.equal(calls, before)
status = 401
await assert.rejects(identifyExercisePhoto(config, photo, catalog), /API key/)
assert.equal(calls, before + 1, 'auth failures must not retry')
console.log('Exercise photo AI contract checks passed.')
