import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  DEFAULT_DESIGN_INPUTS, DESIGN_INPUT_BOUNDS, DESIGN_INPUT_ORDER, normalizeDesignInputs,
  createDesignNNBundle, loadDesignNN, predictDesignNN, findDesignReference, makeDesignGeometry,
  makeDesignWirePoints, resolveDesignEndpoint, makeDesignLandscape,
} from '../src/designNN4D.js'
import { makeDesignGeometry as makeV1Geometry } from '../src/designNN.js'

const asset = filename => new URL(`../public/models/design-nn-4d/${filename}`, import.meta.url)
const json = async filename => JSON.parse(await readFile(asset(filename), 'utf8'))
const [model, samples, audit, parity, split, geometries, geometryParity] = await Promise.all(
  ['model.json', 'samples.json', 'audit.json', 'parity.json', 'split-indices.json', 'geometries.json', 'geometry-parity.json'].map(json))
const bundle = createDesignNNBundle(model, samples, audit)
const near = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`)

test('four physical inputs and the preassigned 160/48/48 split use training-only scaling', () => {
  assert.equal(model.schemaVersion, 2)
  assert.deepEqual(model.inputOrder, ['spineWidth', 'gap', 'barHeight', 'dieOffset'])
  assert.deepEqual(model.inputOrder, [...DESIGN_INPUT_ORDER])
  assert.deepEqual(model.inputSpec.map(({ key, minimum, maximum, step }) => ({ key, minimum, maximum, step })),
    DESIGN_INPUT_ORDER.map(key => ({ key, minimum: DESIGN_INPUT_BOUNDS[key][0], maximum: DESIGN_INPUT_BOUNDS[key][1], step: .001 })))
  assert.deepEqual(Object.fromEntries(Object.entries(split).map(([key, value]) => [key, value.length])), { train: 160, validation: 48, test: 48 })
  assert.equal(new Set(Object.values(split).flat()).size, 256)
  for (const [name, indices] of Object.entries(split)) assert.ok(indices.every(i => samples[i].split === name))
  for (const [column, key] of model.inputOrder.entries()) {
    const mean = split.train.reduce((sum, i) => sum + samples[i][key], 0) / 160
    const scale = Math.sqrt(split.train.reduce((sum, i) => sum + (samples[i][key] - mean) ** 2, 0) / 160)
    near(model.network.scaler.mean[column], mean)
    near(model.network.scaler.scale[column], scale)
  }
  const mean = split.train.reduce((sum, i) => sum + samples[i].inductanceNH, 0) / 160
  near(model.network.targetScaler.mean, mean)
  near(model.network.targetScaler.scale, Math.sqrt(split.train.reduce((sum, i) => sum + (samples[i].inductanceNH - mean) ** 2, 0) / 160))
  const winner = [...model.training.candidates].sort((a, b) => a.validationMSEScaled - b.validationMSEScaled || a.width - b.width || a.seed - b.seed)[0]
  assert.equal(winner.width, model.training.architecture[1]); assert.equal(winner.seed, model.training.selectedSeed)
  assert.deepEqual(model.training.architecture, [4, winner.width, winner.width, 1])
  assert.match(model.training.selection, /test excluded/i)
  assert.match(model.provenance.generation.testScope, /interior interpolation/i)
})

test('all 256 Python/JavaScript NN predictions and untouched test metrics agree', () => {
  assert.equal(parity.length, 256)
  for (const [i, row] of parity.entries()) {
    assert.deepEqual(row.inputs, Object.fromEntries(DESIGN_INPUT_ORDER.map(key => [key, samples[i][key]])))
    near(predictDesignNN(bundle, row.inputs).inductanceNH, row.inductanceNH)
  }
  for (const [name, indices] of Object.entries(split)) {
    const errors = indices.map(i => predictDesignNN(bundle, samples[i]).inductanceNH - samples[i].inductanceNH)
    near(model.metrics[name].maeNH, errors.reduce((sum, value) => sum + Math.abs(value), 0) / indices.length)
    near(model.metrics[name].rmseNH, Math.sqrt(errors.reduce((sum, value) => sum + value ** 2, 0) / indices.length))
    near(model.metrics[name].maxErrorNH, Math.max(...errors.map(Math.abs)))
    near(model.metrics[name].mapePercent, indices.reduce((sum, i, j) => sum + Math.abs(errors[j] / samples[i].inductanceNH), 0) / indices.length * 100)
  }
})

test('the validation-selected polynomial comparator is independently reproducible', () => {
  const baseline = model.training.baseline
  assert.equal([...baseline.candidates].sort((a, b) => a.validationMSE - b.validationMSE || a.degree - b.degree)[0].degree, baseline.degree)
  const prediction = sample => {
    const x = DESIGN_INPUT_ORDER.map((key, i) => (sample[key] - model.network.scaler.mean[i]) / model.network.scaler.scale[i])
    return baseline.powers.reduce((sum, powers, i) => sum + baseline.coefficients[i] * powers.reduce((value, power, j) => value * x[j] ** power, 1), baseline.intercept)
  }
  for (const [i, sample] of samples.entries()) near(prediction(sample), parity[i].baselineInductanceNH)
  const errors = split.test.map(i => prediction(samples[i]) - samples[i].inductanceNH)
  near(baseline.testMAENH, errors.reduce((sum, value) => sum + Math.abs(value), 0) / 48)
  near(baseline.testRMSENH, Math.sqrt(errors.reduce((sum, value) => sum + value ** 2, 0) / 48))
  near(baseline.testMaxErrorNH, Math.max(...errors.map(Math.abs)))
})

test('all 256 preview geometries and physical wire profiles match the solver inputs', () => {
  assert.equal(geometries.length, 256)
  const source = structuredClone(model.baseDesign)
  for (const [i, row] of samples.entries()) {
    const design = makeDesignGeometry(bundle, row)
    assert.equal(geometries[i].id, row.id); assert.equal(geometries[i].designHash, row.designHash)
    assert.deepEqual(design, geometries[i].design)
    assert.deepEqual(design.layers, source.layers); assert.deepEqual(design.loop, source.loop)
    assert.deepEqual(design.components.filter(c => !['D1', 'D2'].includes(c.id)), source.components.filter(c => !['D1', 'D2'].includes(c.id)))
    for (const wire of design.bond_wires) {
      const points = makeDesignWirePoints(design, wire)
      assert.equal(points.length, 9); assert.ok(points.every(p => Math.abs(p[0] - points[0][0]) < 1e-12))
    }
    for (const port of ['L5.P', 'L1.P']) assert.deepEqual(resolveDesignEndpoint(design, port), resolveDesignEndpoint(source, port))
  }
  assert.deepEqual(bundle.baseDesign, source)
  assert.equal(geometryParity.length, 6)
  for (const row of geometryParity) {
    const design = makeDesignGeometry(bundle, row.inputs)
    for (const [ref, expected] of Object.entries(row.endpoints)) resolveDesignEndpoint(design, ref).forEach((value, i) => near(value, expected[i], 1e-12))
    for (const wire of design.bond_wires) makeDesignWirePoints(design, wire).forEach((point, i) => point.forEach((value, axis) => near(value, row.wires[wire.id][i][axis], 1e-12)))
  }
})

test('the original two-input physical slice is retained and references match all four coordinates', () => {
  for (const spineWidth of [7, 10, 13]) for (const gap of [.5, 2, 2.5]) {
    const old = makeV1Geometry({ baseDesign: model.baseDesign }, { spineWidth, gap })
    const current = makeDesignGeometry(bundle, { spineWidth, gap, barHeight: 6, dieOffset: 0 })
    old.regions.find(region => region.id === 'T1').fixed = false
    assert.deepEqual(current, old)
  }
  for (const row of samples) assert.equal(findDesignReference(bundle, row), row)
  const missing = { spineWidth: 9.123, gap: 1.234, barHeight: 5.432, dieOffset: .321 }
  assert.equal(findDesignReference(bundle, missing), null)
  assert.ok(Number.isFinite(predictDesignNN(bundle, missing).inductanceNH))
  assert.deepEqual(normalizeDesignInputs({ spineWidth: 9.1234, gap: 1.2344, barHeight: 5.4324, dieOffset: .3214 }), missing)
})

test('conditional NN surfaces preserve both fixed inputs for every choice of axes', () => {
  const inputs = { spineWidth: 9.123, gap: 1.234, barHeight: 5.432, dieOffset: .321 }
  for (let first = 0; first < 4; first++) for (let second = first + 1; second < 4; second++) {
    const axes = [DESIGN_INPUT_ORDER[first], DESIGN_INPUT_ORDER[second]]
    const rows = makeDesignLandscape(bundle, { inputs, axes, resolution: 9 })
    assert.equal(rows.length, 81)
    assert.equal(new Set(rows.map(row => axes.map(key => row[key]).join(':'))).size, 81)
    for (const row of rows) {
      for (const key of DESIGN_INPUT_ORDER.filter(key => !axes.includes(key))) assert.equal(row[key], inputs[key])
      near(row.inductanceNH, predictDesignNN(bundle, row).inductanceNH)
      assert.equal(row.reference, findDesignReference(bundle, row))
    }
  }
  const defaultGrid = makeDesignLandscape(bundle)
  assert.equal(defaultGrid.length, 1681)
  assert.ok(defaultGrid.every(row => row.barHeight === 6 && row.dieOffset === 0))
})

test('invalid four-input requests, old-format models, and corrupted assets fail clearly', () => {
  for (const key of DESIGN_INPUT_ORDER) {
    const [minimum, maximum] = DESIGN_INPUT_BOUNDS[key]
    for (const value of [minimum - .001, maximum + .001, NaN, true, String(minimum)]) {
      assert.throws(() => predictDesignNN(bundle, { ...DEFAULT_DESIGN_INPUTS, [key]: value }))
      assert.throws(() => makeDesignGeometry(bundle, { ...DEFAULT_DESIGN_INPUTS, [key]: value }))
    }
  }
  assert.throws(() => normalizeDesignInputs({ spineWidth: 10, gap: 2 }))
  assert.throws(() => createDesignNNBundle({ ...model, schemaVersion: 1 }, samples, audit), /format/)
  assert.throws(() => createDesignNNBundle(model, samples.slice(1), audit), /incomplete/)
  assert.throws(() => createDesignNNBundle(model, [samples[0], ...samples.slice(0, -1)], audit), /duplicate/)
  assert.throws(() => createDesignNNBundle(model, samples, {}), /audit/)
  const broken = structuredClone(model); broken.network.layers[0].weight[0] = [0, 0]
  assert.throws(() => createDesignNNBundle(broken, samples, audit), /weights/)
  assert.throws(() => makeDesignLandscape(bundle, { inputs: DEFAULT_DESIGN_INPUTS, axes: ['gap', 'gap'] }))
  assert.throws(() => makeDesignLandscape(bundle, { resolution: 102 }))
})

test('the 4D asset loader retains cancellation, error reporting, and fresh retry', async () => {
  const originalFetch = globalThis.fetch, requests = [], controller = new AbortController()
  try {
    globalThis.fetch = async (url, options) => { requests.push({ url, signal: options.signal }); return { ok: false, status: 503 } }
    await assert.rejects(loadDesignNN({ signal: controller.signal }), /Could not load/)
    assert.ok(requests.every(request => request.url.includes('/design-nn-4d/') && request.signal === controller.signal))
    globalThis.fetch = async url => ({ ok: true, json: async () => url.endsWith('/model.json') ? model : url.endsWith('/samples.json') ? samples : audit })
    const loaded = await loadDesignNN()
    assert.deepEqual(predictDesignNN(loaded, DEFAULT_DESIGN_INPUTS), predictDesignNN(bundle, DEFAULT_DESIGN_INPUTS))
    globalThis.fetch = async () => { throw new DOMException('Aborted', 'AbortError') }
    await assert.rejects(loadDesignNN({ signal: controller.signal }), { name: 'AbortError' })
  } finally { globalThis.fetch = originalFetch }
})
