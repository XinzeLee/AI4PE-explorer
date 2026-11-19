import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import {
  DEFAULT_INPUTS, POWER_LEVELS, VOLTAGE_LEVELS, MODULATION_LEVELS,
  createControlNNBundle, loadControlNN, predictControlNN, findReference, makeLandscape,
} from '../src/controlNN.js'

const asset = filename => new URL(`../public/models/control-nn/${filename}`, import.meta.url)
const readJson = async filename => JSON.parse(await readFile(asset(filename), 'utf8'))
const model = await readJson('model.json')
const samples = await readJson('samples.json')
const bundle = createControlNNBundle(model, samples)
const near = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`)

test('source hashes pin the actual notebook, dataset and attribution used for reproduction', async () => {
  assert.equal(model.metadata.source.commit, '1732da388f18b80e3fb6ad2ed0480c53f42c9250')
  for (const [filename, expected] of Object.entries(model.metadata.source.sha256)) {
    const actual = createHash('sha256').update(await readFile(asset(`source/${filename}`))).digest('hex')
    assert.equal(actual, expected, filename)
  }
})

test('source cleaning preserves the notebook order, inclusive sample-std filter and all 4633 retained records', async () => {
  const [header, ...lines] = (await readFile(asset('source/DAB_TPS.csv'), 'utf8')).trim().split(/\r?\n/)
  const columns = header.split(',')
  const raw = lines.map(line => Object.fromEntries(line.split(',').map((value, index) => [columns[index], Number(value)])))
  const valid = raw.filter(row => row.Validity !== 0)
  const even = valid.map(row => ({ ...row, zvs: ['vp_t1', 'vp_t2', 'vp_t3', 'vp_t4', 'vs_t1', 'vs_t2', 'vs_t3', 'vs_t4'].reduce((sum, key) => sum + row[key], 0) })).filter(row => row.zvs % 2 === 0)
  const mean = even.reduce((sum, row) => sum + row.ipk2pk, 0) / even.length
  const std = Math.sqrt(even.reduce((sum, row) => sum + (row.ipk2pk - mean) ** 2, 0) / (even.length - 1))
  const cleaned = even.filter(row => row.ipk2pk >= mean - 3 * std && row.ipk2pk <= mean + 3 * std)
  assert.deepEqual([raw.length, valid.length, even.length, cleaned.length], [5291, 5291, 4633, 4633])
  near(mean, model.metadata.preprocessing.currentStressMean)
  near(std, model.metadata.preprocessing.currentStressStd)
  assert.deepEqual(samples, cleaned.map(({ P, Vref, D1, D2, ipk2pk, zvs }) => ({ P, Vref, D1, D2, stress: ipk2pk, zvs })))
  assert.deepEqual(Object.fromEntries([4, 6, 8].map(zvs => [zvs, samples.filter(row => row.zvs === zvs).length])), { 4: 867, 6: 3094, 8: 672 })
})

test('training inputs alone determine standardization and the seeded split has no overlap', async () => {
  const split = await readJson('split-indices.json')
  assert.deepEqual(Object.fromEntries(Object.entries(split).map(([key, value]) => [key, value.length])), { train: 2779, validation: 927, test: 927 })
  assert.equal(new Set(Object.values(split).flat()).size, samples.length)
  for (const indices of Object.values(split)) assert.ok(indices.every(index => index >= 0 && index < samples.length))
  for (const [column, key] of model.inputOrder.entries()) {
    const mean = split.train.reduce((sum, index) => sum + samples[index][key], 0) / split.train.length
    const scale = Math.sqrt(split.train.reduce((sum, index) => sum + (samples[index][key] - mean) ** 2, 0) / split.train.length)
    for (const network of [model.regression, model.classification]) {
      near(network.scaler.mean[column], mean)
      near(network.scaler.scale[column], scale)
    }
  }
  assert.equal(model.metadata.training.seed, 42)
  assert.equal(model.metadata.training.regression.epochs, 200)
  assert.equal(model.metadata.training.classification.epochs, 300)
})

test('browser predictions match Python for every cleaned sample and held-out metrics match exported results', async () => {
  const parity = await readJson('parity.json')
  const split = await readJson('split-indices.json')
  assert.equal(parity.length, 4633)
  let maxError = 0
  for (const row of parity) {
    const actual = predictControlNN(bundle, row.inputs)
    const error = Math.abs(actual.stress - row.stress)
    maxError = Math.max(maxError, error)
    assert.ok(error <= 1e-4 + 1e-5 * Math.abs(row.stress), JSON.stringify({ ...row.inputs, actual: actual.stress, expected: row.stress }))
    assert.equal(actual.zvs, row.zvs, JSON.stringify(row.inputs))
    for (let i = 0; i < 3; i++) near(actual.logits[i], row.logits[i], 1e-4 + 1e-5 * Math.abs(row.logits[i]))
  }
  const mse = split.test.reduce((sum, i) => sum + (parity[i].stress - samples[i].stress) ** 2, 0) / split.test.length
  const mean = split.test.reduce((sum, i) => sum + samples[i].stress, 0) / split.test.length
  const variance = split.test.reduce((sum, i) => sum + (samples[i].stress - mean) ** 2, 0) / split.test.length
  near(Math.sqrt(mse), model.metadata.metrics.regression.rmse)
  near(1 - mse / variance, model.metadata.metrics.regression.r2)
  near(split.test.filter(i => parity[i].zvs === samples[i].zvs).length / split.test.length, model.metadata.metrics.classification.accuracy)
  assert.ok(maxError < 1e-4)
})

test('reference lookup distinguishes sampled data from filtered and missing input combinations', () => {
  assert.deepEqual(DEFAULT_INPUTS, { P: 100, Vref: 160, D1: 0.6, D2: 0.6 })
  const reference = findReference(bundle, DEFAULT_INPUTS)
  assert.equal(reference.stress, 6.808840989)
  assert.equal(reference.zvs, 4)
  assert.equal(findReference(bundle, { P: 100, Vref: 200, D1: 0.6, D2: 1 }), null)
  const filtered = { P: 100, Vref: 160, D1: 0.6, D2: 0.66 }
  assert.equal(findReference(bundle, filtered), null)
  assert.ok(Number.isFinite(predictControlNN(bundle, filtered).stress))
  assert.equal(findReference(bundle, { ...DEFAULT_INPUTS, D1: 0.61 }), null)
})

test('every landscape keeps the selected operating point, reference and prediction synchronized', () => {
  assert.equal(MODULATION_LEVELS.length, 21)
  for (const P of POWER_LEVELS) for (const Vref of VOLTAGE_LEVELS) {
    const points = makeLandscape(bundle, P, Vref)
    assert.equal(points.length, 441)
    assert.equal(new Set(points.map(row => `${row.D1}:${row.D2}`)).size, 441)
    for (const row of points) {
      assert.equal(row.stress, predictControlNN(bundle, { P, Vref, D1: row.D1, D2: row.D2 }).stress)
      assert.equal(row.reference, findReference(bundle, { P, Vref, D1: row.D1, D2: row.D2 }))
    }
  }
})

test('invalid or out-of-domain inputs and corrupted assets fail explicitly', () => {
  for (const inputs of [{ ...DEFAULT_INPUTS, P: 300 }, { ...DEFAULT_INPUTS, Vref: 180 }, { ...DEFAULT_INPUTS, D1: 0.59 }, { ...DEFAULT_INPUTS, D2: 1.01 }, { ...DEFAULT_INPUTS, D1: NaN }]) {
    assert.throws(() => predictControlNN(bundle, inputs))
  }
  assert.throws(() => createControlNNBundle({ ...model, classMapping: [4, 5, 8] }, samples), /format/)
  assert.throws(() => createControlNNBundle(model, samples.slice(1)), /incomplete/)
  assert.throws(() => createControlNNBundle({ ...model, regression: { ...model.regression, scaler: { mean: [0, 0, 0, 0], scale: [0, 1, 1, 1] } } }, samples), /scaling/)
})

test('asset loading supports cancellation, reports failures and permits a fresh retry', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  const controller = new AbortController()
  try {
    globalThis.fetch = async (url, options) => {
      requests.push({ url, signal: options.signal })
      return { ok: false, status: 503 }
    }
    await assert.rejects(loadControlNN({ signal: controller.signal }), /Could not load/)
    assert.ok(requests.every(request => request.signal === controller.signal))
    globalThis.fetch = async url => ({ ok: true, json: async () => url.endsWith('/model.json') ? model : samples })
    const loaded = await loadControlNN()
    assert.deepEqual(predictControlNN(loaded, DEFAULT_INPUTS), predictControlNN(bundle, DEFAULT_INPUTS))
    globalThis.fetch = async () => { throw new DOMException('Aborted', 'AbortError') }
    await assert.rejects(loadControlNN({ signal: controller.signal }), { name: 'AbortError' })
  } finally {
    globalThis.fetch = originalFetch
  }
})
