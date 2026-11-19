import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import {
  DEFAULT_DESIGN_INPUTS, DESIGN_INPUT_BOUNDS, normalizeDesignInputs,
  createDesignNNBundle, loadDesignNN, predictDesignNN, findDesignReference,
  makeDesignGeometry, resolveDesignEndpoint, makeDesignWirePoints, makeDesignLandscape,
} from '../src/designNN.js'

const asset = name => new URL(`../public/models/design-nn/${name}`, import.meta.url)
const json = async name => JSON.parse(await readFile(asset(name), 'utf8'))
const [model, samples, audit, parity, split, geometries, geometryParity] = await Promise.all(
  ['model.json', 'samples.json', 'audit.json', 'parity.json', 'split-indices.json', 'geometries.json', 'geometry-parity.json'].map(json))
const bundle = createDesignNNBundle(model, samples, audit)
const near = (actual, expected, tolerance = 1e-10) => assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`)

test('training-only standardization and preassigned 80/24/24 splits match the exported samples', () => {
  assert.deepEqual(model.inputOrder, ['spineWidth', 'gap'])
  assert.deepEqual(model.inputSpec.map(({ key, minimum, maximum, step }) => ({ key, minimum, maximum, step })), [
    { key: 'spineWidth', minimum: 7, maximum: 13, step: .001 },
    { key: 'gap', minimum: .5, maximum: 2.5, step: .001 },
  ])
  assert.deepEqual(Object.fromEntries(Object.entries(split).map(([name, indices]) => [name, indices.length])), { train: 80, validation: 24, test: 24 })
  assert.equal(new Set(Object.values(split).flat()).size, 128)
  for (const [name, indices] of Object.entries(split)) assert.ok(indices.every(i => samples[i].split === name))
  for (const [column, key] of model.inputOrder.entries()) {
    const mean = split.train.reduce((sum, i) => sum + samples[i][key], 0) / 80
    const scale = Math.sqrt(split.train.reduce((sum, i) => sum + (samples[i][key] - mean) ** 2, 0) / 80)
    near(model.network.scaler.mean[column], mean)
    near(model.network.scaler.scale[column], scale)
  }
  const targetMean = split.train.reduce((sum, i) => sum + samples[i].inductanceNH, 0) / 80
  near(model.network.targetScaler.mean, targetMean)
  near(model.network.targetScaler.scale, Math.sqrt(split.train.reduce((sum, i) => sum + (samples[i].inductanceNH - targetMean) ** 2, 0) / 80))
  assert.match(model.training.selection, /test excluded/i)
  assert.deepEqual(model.training.architecture, [2, model.network.layers[0].bias.length, model.network.layers[2].bias.length, 1])
  const winner = [...model.training.candidates].sort((a, b) => a.validationMSEScaled - b.validationMSEScaled || a.width - b.width || a.seed - b.seed)[0]
  assert.equal(winner.width, model.training.architecture[1])
  assert.equal(winner.seed, model.training.selectedSeed)
})

test('JavaScript inference matches Python float64 for all 128 layouts and reproduces the untouched test metrics', () => {
  assert.equal(parity.length, 128)
  for (const [i, point] of parity.entries()) {
    assert.deepEqual(point.inputs, { spineWidth: samples[i].spineWidth, gap: samples[i].gap })
    near(predictDesignNN(bundle, point.inputs).inductanceNH, point.inductanceNH)
  }
  for (const [name, indices] of Object.entries(split)) {
    const errors = indices.map(i => predictDesignNN(bundle, samples[i]).inductanceNH - samples[i].inductanceNH)
    near(model.metrics[name].maeNH, errors.reduce((sum, value) => sum + Math.abs(value), 0) / indices.length)
    near(model.metrics[name].rmseNH, Math.sqrt(errors.reduce((sum, value) => sum + value ** 2, 0) / indices.length))
    near(model.metrics[name].maxErrorNH, Math.max(...errors.map(Math.abs)))
    near(model.metrics[name].mapePercent, indices.reduce((sum, i, j) => sum + Math.abs(errors[j] / samples[i].inductanceNH), 0) / indices.length * 100)
  }
})

test('the validation-selected simple Ridge comparator has independently reproducible held-out metrics', () => {
  const baseline = model.training.baseline
  assert.equal([...baseline.candidates].sort((a, b) => a.validationMSE - b.validationMSE || a.degree - b.degree)[0].degree, baseline.degree)
  const prediction = sample => {
    const x = model.inputOrder.map((key, i) => (sample[key] - model.network.scaler.mean[i]) / model.network.scaler.scale[i])
    return baseline.powers.reduce((sum, powers, i) => sum + baseline.coefficients[i] * powers.reduce((value, power, j) => value * x[j] ** power, 1), baseline.intercept)
  }
  for (const [i, sample] of samples.entries()) near(prediction(sample), parity[i].baselineInductanceNH)
  const errors = split.test.map(i => prediction(samples[i]) - samples[i].inductanceNH)
  near(baseline.testMAENH, errors.reduce((sum, value) => sum + Math.abs(value), 0) / 24)
  near(baseline.testRMSENH, Math.sqrt(errors.reduce((sum, value) => sum + value ** 2, 0) / 24))
  near(baseline.testMaxErrorNH, Math.max(...errors.map(Math.abs)))
  near(baseline.testMAPEPercent, split.test.reduce((sum, i, j) => sum + Math.abs(errors[j] / samples[i].inductanceNH), 0) / 24 * 100)
})

test('preview geometry equals every complete solver geometry and keeps source fixtures intact', () => {
  assert.equal(geometries.length, 128)
  const source = structuredClone(bundle.baseDesign)
  for (const [index, sample] of samples.entries()) {
    const design = makeDesignGeometry(bundle, sample)
    assert.equal(geometries[index].id, sample.id)
    assert.equal(geometries[index].designHash, sample.designHash)
    assert.deepEqual(design, geometries[index].design)
    assert.deepEqual(design.board_mm, [45, 50])
    assert.deepEqual(design.layers, source.layers)
    assert.deepEqual(design.loop, source.loop)
    assert.deepEqual(design.components.filter(c => c.kind === 'lead'), source.components.filter(c => c.kind === 'lead'))
    for (const wire of design.bond_wires) {
      const points = makeDesignWirePoints(design, wire)
      assert.equal(points.length, 9)
      assert.ok(points.every(p => Math.abs(p[0] - points[0][0]) < 1e-12))
    }
    assert.deepEqual(resolveDesignEndpoint(design, 'L5.P'), resolveDesignEndpoint(source, 'L5.P'))
    assert.deepEqual(resolveDesignEndpoint(design, 'L1.P'), resolveDesignEndpoint(source, 'L1.P'))
  }
  assert.deepEqual(bundle.baseDesign, source)
})

test('physical endpoints and three-dimensional wire profiles match the Python source kernel', () => {
  assert.equal(geometryParity.length, 6)
  for (const row of geometryParity) {
    const design = makeDesignGeometry(bundle, row.inputs)
    for (const [ref, expected] of Object.entries(row.endpoints)) resolveDesignEndpoint(design, ref).forEach((value, i) => near(value, expected[i], 1e-12))
    for (const wire of design.bond_wires) {
      makeDesignWirePoints(design, wire).forEach((point, i) => point.forEach((value, axis) => near(value, row.wires[wire.id][i][axis], 1e-12)))
    }
  }
  const design = makeDesignGeometry(bundle, DEFAULT_DESIGN_INPUTS)
  const explicitPath = { source: 'L5.P', target: 'L1.P', waypoints_mm: [[1, 2, 3], [4, 5, 6]] }
  assert.deepEqual(makeDesignWirePoints(design, explicitPath), [resolveDesignEndpoint(design, 'L5.P'), [1, 2, 3], [4, 5, 6], resolveDesignEndpoint(design, 'L1.P')])
})

test('solver references use exact realized inputs and landscapes remain synchronized with inference', () => {
  assert.deepEqual(DEFAULT_DESIGN_INPUTS, { spineWidth: 10, gap: 2 })
  assert.deepEqual(DESIGN_INPUT_BOUNDS, { spineWidth: [7, 13], gap: [.5, 2.5] })
  for (const sample of samples) assert.equal(findDesignReference(bundle, sample), sample)
  const missing = { spineWidth: 9.123, gap: 1.234 }
  assert.equal(findDesignReference(bundle, missing), null)
  assert.ok(Number.isFinite(predictDesignNN(bundle, missing).inductanceNH))
  assert.deepEqual(normalizeDesignInputs({ spineWidth: 9.1234, gap: 1.2344 }), missing)
  assert.deepEqual(makeDesignGeometry(bundle, { spineWidth: 9.1234, gap: 1.2344 }), makeDesignGeometry(bundle, missing))
  const landscape = makeDesignLandscape(bundle)
  assert.equal(landscape.length, 1681)
  assert.equal(new Set(landscape.map(p => `${p.spineWidth}:${p.gap}`)).size, 1681)
  for (const row of landscape) {
    near(row.inductanceNH, predictDesignNN(bundle, row).inductanceNH)
    assert.equal(row.reference, findDesignReference(bundle, row))
  }
})

test('invalid inputs, corrupt models, incomplete samples and missing audits fail explicitly', () => {
  for (const inputs of [null, { spineWidth: 6.999, gap: 2 }, { spineWidth: 13.001, gap: 2 }, { spineWidth: 10, gap: .499 }, { spineWidth: 10, gap: 2.501 }, { spineWidth: 10, gap: NaN }, { spineWidth: 10, gap: true }, { spineWidth: '10', gap: 2 }]) {
    assert.throws(() => predictDesignNN(bundle, inputs))
    assert.throws(() => makeDesignGeometry(bundle, inputs))
  }
  assert.throws(() => createDesignNNBundle({ ...model, inputOrder: ['gap', 'spineWidth'] }, samples, audit), /format/)
  assert.throws(() => createDesignNNBundle(model, samples.slice(1), audit), /incomplete/)
  assert.throws(() => createDesignNNBundle(model, samples, {}), /audit/)
  assert.throws(() => createDesignNNBundle({ ...model, network: { ...model.network, targetScaler: { mean: 0, scale: 0 } } }, samples, audit), /scaling/)
  const broken = structuredClone(model); broken.network.layers[0].weight[0] = [0]
  assert.throws(() => createDesignNNBundle(broken, samples, audit), /weights/)
  assert.throws(() => createDesignNNBundle(model, [samples[0], ...samples.slice(0, -1)], audit), /duplicate/)
  assert.throws(() => makeDesignLandscape(bundle, { resolution: 102 }))
  assert.throws(() => resolveDesignEndpoint(bundle.baseDesign, 'missing.P'))
})

test('asset loading supports cancellation, failure, and a fresh retry without stale shared state', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  const controller = new AbortController()
  try {
    globalThis.fetch = async (url, options) => { requests.push({ url, signal: options.signal }); return { ok: false, status: 503 } }
    await assert.rejects(loadDesignNN({ signal: controller.signal }), /Could not load/)
    assert.ok(requests.every(request => request.signal === controller.signal))
    globalThis.fetch = async url => ({ ok: true, json: async () => url.endsWith('/model.json') ? model : url.endsWith('/samples.json') ? samples : audit })
    const loaded = await loadDesignNN()
    assert.deepEqual(predictDesignNN(loaded, DEFAULT_DESIGN_INPUTS), predictDesignNN(bundle, DEFAULT_DESIGN_INPUTS))
    globalThis.fetch = async () => { throw new DOMException('Aborted', 'AbortError') }
    await assert.rejects(loadDesignNN({ signal: controller.signal }), { name: 'AbortError' })
  } finally { globalThis.fetch = originalFetch }
})
