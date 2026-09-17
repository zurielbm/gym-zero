// Contract checks for untrusted vision responses; no live AI credentials needed.
import assert from 'node:assert/strict'
import { build } from 'esbuild'

const bundle = await build({ entryPoints: ['src/lib/ai.ts'], bundle: true, write: false, platform: 'node', format: 'esm' })
const { identifyExercisePhoto, identifyExerciseDescription } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
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
status = 200
response = { identified: true, name: 'Seated press', confidence: 'medium', exerciseIds: ['press', 'incline', 'invented'], explanation: 'The direction of the handles distinguishes these options.' }
const options = await identifyExerciseDescription(config, ' I sit and push handles away from my chest. ', [
  ...catalog, { id: 'incline', name: 'Incline press', muscleGroups: ['chest'], equipment: 'machine' },
])
assert.deepEqual(options.exerciseIds, ['press', 'incline'])
assert.equal(options.confidence, 'medium')
assert.equal(typeof payload.messages[1].content, 'string', 'description requests must not require image support')
assert.equal(JSON.parse(payload.messages[1].content).description, 'I sit and push handles away from my chest.')
assert.ok(!JSON.stringify(payload).includes('image_url'))
const textCalls = calls
await assert.rejects(identifyExerciseDescription(config, '  ', catalog), /Describe the movement/)
assert.equal(calls, textCalls)
response = { identified: false, explanation: 'Are you pushing or pulling?', exerciseIds: ['press'] }
const unclear = await identifyExerciseDescription(config, 'A machine at the gym', catalog)
assert.deepEqual(unclear.exerciseIds, [])
assert.equal(unclear.explanation, 'Are you pushing or pulling?')
console.log('Exercise photo AI contract checks passed.')
