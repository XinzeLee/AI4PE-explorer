import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import test from 'node:test'
import {
  createRULNNBundle, loadRULNN, predictRUL, sampleRULCases, normalQuantile,
  RUL_FEATURES, RUL_WINDOW_SIZE, RUL_DEFAULT_CONFIDENCE, rulPercent,
} from '../src/rulNN.js'

const directory = new URL('../public/models/rul-nn/', import.meta.url)
const readJSON = async name => JSON.parse(await readFile(new URL(name, directory), 'utf8'))
const [model, cases, provenance] = await Promise.all(['model.json', 'cases.json', 'provenance.json'].map(readJSON))
const bundle = createRULNNBundle(model, cases, provenance)

test('RUL percentage uses the fixed recording reference without clipping', () => {
  assert.equal(rulPercent(1169, 1169), 100)
  assert.equal(rulPercent(0, 1169), 0)
  assert.equal(rulPercent(-116.9, 1169), -10)
  assert.equal(rulPercent(2338, 1169), 200)
})

test('RUL assets retain pinned source, all held-out windows, and audited disjoint index splits', async () => {
  assert.equal(model.source.commit, '0587acf5854b0127f696c13e0367663d24f6ae73')
  assert.deepEqual(model.inputOrder, RUL_FEATURES)
  assert.equal(RUL_WINDOW_SIZE, 200)
  assert.equal(RUL_DEFAULT_CONFIDENCE, 0.9)
  assert.equal(provenance.preprocessing.rawSampleCount, 41752)
  assert.equal(provenance.preprocessing.minimaCount, 1175)
  assert.equal(provenance.preprocessing.windowCount, 1170)
  assert.equal(model.normalizationCycles, 1169)
  assert.deepEqual(Object.values(provenance.split.indices).map(indices => indices.length), [818, 176, 176])
  const allIndices = Object.values(provenance.split.indices).flat()
  assert.equal(new Set(allIndices).size, 1170)
  assert.deepEqual([...allIndices].sort((a, b) => a - b), Array.from({ length: 1170 }, (_, i) => i))
  assert.deepEqual(cases.map(entry => entry.windowIndex), provenance.split.indices.test)
  for (const entry of cases) {
    assert.equal(entry.window.length, 200)
    assert.equal(entry.endSample - entry.startSample, 199)
    assert.equal(entry.split, 'test')
    assert.equal(entry.target, 1175 - entry.cycleIndex - 1)
    assert.equal(entry.targetPercent, entry.target / 1169 * 100)
  }
  for (const [filename, artifact] of Object.entries(provenance.artifacts)) {
    const bytes = await readFile(new URL(filename, directory))
    assert.equal(bytes.length, artifact.bytes)
    assert.equal(createHash('sha256').update(bytes).digest('hex'), artifact.sha256)
  }
  for (const source of provenance.sources.filter(source => !source.filename.endsWith('.mat'))) {
    const bytes = await readFile(new URL(`source/${source.filename}`, directory))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256)
  }
})

test('native BiLSTM reproduces PyTorch means and learned uncertainty for every real held-out input', () => {
  let absoluteError = 0
  let squaredError = 0
  let covered = 0
  let intervalWidth = 0
  for (const entry of cases) {
    const prediction = predictRUL(bundle, entry)
    // Float32 PyTorch GEMM and JS double accumulation can differ slightly through recurrent states.
    for (const key of ['mean', 'std', 'lower', 'upper']) {
      assert.ok(Math.abs(prediction[key] - entry.referencePrediction[key]) < 0.005,
        `${entry.id} ${key}: ${prediction[key]} vs ${entry.referencePrediction[key]}`)
    }
    assert.equal(prediction.intervalType, 'prediction')
    assert.equal(prediction.unit, 'cycles')
    assert.equal(prediction.confidence, 0.9)
    assert.ok(prediction.std > 0)
    assert.ok(prediction.lower < prediction.mean && prediction.mean < prediction.upper)
    assert.ok(Math.abs(prediction.upper - prediction.mean - 1.6448536269514722 * prediction.std) < 0.00001)
    assert.equal(prediction.meanPercent, prediction.mean * (100 / 1169))
    absoluteError += Math.abs(prediction.mean - entry.target)
    squaredError += (prediction.mean - entry.target) ** 2
    covered += entry.target >= prediction.lower && entry.target <= prediction.upper ? 1 : 0
    intervalWidth += prediction.upper - prediction.lower
  }
  assert.ok(Math.abs(absoluteError / cases.length - model.metrics.testMaeCycles) < 0.005)
  assert.ok(Math.abs(Math.sqrt(squaredError / cases.length) - model.metrics.testRmseCycles) < 0.005)
  assert.equal(covered / cases.length, model.metrics.testCoverage90)
  assert.ok(Math.abs(intervalWidth / cases.length - model.metrics.testMeanIntervalWidth90) < 0.005)
})

test('raw extraction fixture verifies every shipped waveform and reconstructs scalers from train-only sufficient statistics', async () => {
  const audit = await readJSON('extraction-audit.json')
  assert.equal(audit.sourceMatSha256, provenance.sources.find(source => source.filename.endsWith('.mat')).sha256)
  assert.deepEqual(audit.inputOrder, RUL_FEATURES)
  assert.equal(audit.windows.length, 1170)
  assert.match(audit.encoding, /float64 little-endian/)
  for (const entry of cases) {
    const fixture = audit.windows[entry.windowIndex]
    for (const key of ['windowIndex', 'startSample', 'endSample', 'cycleIndex', 'target']) assert.equal(entry[key], fixture[key])
    const bytes = Buffer.alloc(200 * 4 * 8)
    entry.window.flat().forEach((value, index) => bytes.writeDoubleLE(value, index * 8))
    assert.equal(createHash('sha256').update(bytes).digest('hex'), fixture.rawSha256, entry.id)
  }
  const training = provenance.split.indices.train.map(index => audit.windows[index])
  const mean = Array.from({ length: 4 }, (_, feature) => training.reduce((sum, window) => sum + window.mean[feature], 0) / training.length)
  const scale = mean.map((value, feature) => Math.sqrt(training.reduce((sum, window) =>
    sum + window.centeredSumSquares[feature] + 200 * (window.mean[feature] - value) ** 2, 0) / (training.length * 200)))
  for (let feature = 0; feature < 4; feature++) {
    assert.ok(Math.abs(mean[feature] - model.scaler.mean[feature]) < 1e-9)
    assert.ok(Math.abs(scale[feature] - model.scaler.scale[feature]) < 1e-9)
  }
  const targetMean = training.reduce((sum, window) => sum + window.target, 0) / training.length
  const targetScale = Math.sqrt(training.reduce((sum, window) => sum + (window.target - targetMean) ** 2, 0) / training.length)
  assert.ok(Math.abs(targetMean - model.targetScaler.mean) < 1e-10)
  assert.ok(Math.abs(targetScale - model.targetScaler.scale) < 1e-10)
})

test('NN inference reads supplied waveforms, without using held-out targets or cached reference predictions', () => {
  const original = cases[0]
  const baseline = predictRUL(bundle, original)
  const relabeled = { ...original, target: -999, referencePrediction: { mean: 1e20, std: 1e20 } }
  assert.deepEqual(predictRUL(bundle, relabeled), baseline)
  assert.deepEqual(predictRUL(bundle, original.window), baseline)
  const alternate = predictRUL(bundle, cases[cases.length - 1].window)
  assert.ok(Math.abs(alternate.mean - baseline.mean) > 1)
})

test('Gaussian interval probability changes only width and preserves raw negative bounds', () => {
  assert.ok(Math.abs(normalQuantile(0.95) - 1.6448536269514722) < 2e-9)
  assert.ok(Math.abs(normalQuantile(0.975) - 1.959963984540054) < 2e-9)
  assert.equal(normalQuantile(0.5), 0)
  assert.ok(Math.abs(normalQuantile(0.005) + normalQuantile(0.995)) < 1e-12)
  const p90 = predictRUL(bundle, cases[0], 0.9)
  const p95 = predictRUL(bundle, cases[0], 0.95)
  assert.equal(p90.mean, p95.mean)
  assert.equal(p90.std, p95.std)
  assert.ok(p95.lower < p90.lower && p95.upper > p90.upper)
  const negative = cases.map(entry => predictRUL(bundle, entry)).find(prediction => prediction.lower < 0)
  assert.ok(negative, 'Gaussian tails are retained rather than clipped at zero.')
})

test('case sampler draws distinct real test windows reproducibly without mutating bundle order', () => {
  const order = cases.map(entry => entry.id)
  const sampled = sampleRULCases(bundle, 3, () => 0)
  assert.deepEqual(sampled.map(entry => entry.id), order.slice(0, 3))
  assert.equal(new Set(sampleRULCases(bundle, cases.length, () => 0.5).map(entry => entry.id)).size, 176)
  assert.deepEqual(cases.map(entry => entry.id), order)
  assert.ok(sampled.every(entry => cases.includes(entry)))
  assert.deepEqual(sampleRULCases(bundle, 0), [])
  assert.throws(() => sampleRULCases(bundle, 177), /valid number/)
  assert.throws(() => sampleRULCases(bundle, 1, () => 1), /random values/)
})

test('RUL inference rejects malformed inputs and invalid network artifacts', () => {
  assert.throws(() => predictRUL({}, cases[0]), /Load the RUL/)
  assert.throws(() => predictRUL(bundle, []), /200 samples/)
  assert.throws(() => predictRUL(bundle, cases[0], 1), /strictly between/)
  const invalidWindow = structuredClone(cases[0].window)
  invalidWindow[100][2] = NaN
  assert.throws(() => predictRUL(bundle, invalidWindow), /finite source/)
  const invalidModel = structuredClone(model)
  invalidModel.network.bilstm2.forward.weight_hh[0].pop()
  assert.throws(() => createRULNNBundle(invalidModel, cases), /recurrent weights/)
  const invalidScaler = structuredClone(model)
  invalidScaler.scaler.scale[0] = 0
  assert.throws(() => createRULNNBundle(invalidScaler, cases), /normalization/)
  const duplicated = [...cases]
  duplicated[1] = duplicated[0]
  assert.throws(() => createRULNNBundle(model, duplicated), /duplicated/)
})

test('asset loading supports abort signals and recovery after a failed request', async context => {
  const assets = { 'model.json': model, 'cases.json': cases, 'provenance.json': provenance }
  let failed = true
  const requestedSignals = []
  context.mock.method(globalThis, 'fetch', async (url, options) => {
    requestedSignals.push(options.signal)
    if (options.signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError')
    return { ok: !failed, status: failed ? 503 : 200, json: async () => assets[url.split('/').at(-1)] }
  })
  const controller = new AbortController()
  await assert.rejects(loadRULNN({ signal: controller.signal }), /503/)
  failed = false
  const recovered = await loadRULNN({ signal: controller.signal })
  assert.equal(recovered.cases.length, 176)
  assert.ok(requestedSignals.every(signal => signal === controller.signal))
  controller.abort()
  await assert.rejects(loadRULNN({ signal: controller.signal }), error => error.name === 'AbortError')
})
