import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'

const asset = name => new URL(`../public/models/design-nn/${name}`, import.meta.url)
const json = async name => JSON.parse(await readFile(asset(name), 'utf8'))
const [model, samples, dataset, plan, cache, audit, provenance, geometryAudit, progress, failures, base] = await Promise.all([
  'model.json', 'samples.json', 'dataset.json', 'sampling-plan.json', 'evaluation-cache.json',
  'audit.json', 'provenance.json', 'geometry-audit.json', 'progress.json', 'failures.json', 'source/tpel2019_2R.json',
].map(json))
const mesh = { cell_mm: 4, thickness_cells: 1, quadrature_order: 6, max_branches: 5000, wire_segments: null }
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const near = (actual, expected, tolerance = 1e-10) => {
  assert.ok(Number.isFinite(actual) && Number.isFinite(expected))
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} differs from ${expected}`)
}

// The producer normalizes every numeric design field to a Python float before
// hashing. Preserve that independent, language-neutral contract, including the
// scientific notation used by the source material resistivities.
function canonicalPython(value) {
  if (value === null) return 'null'
  if (typeof value === 'number') {
    assert.ok(Number.isFinite(value))
    if (Object.is(value, -0)) return '-0.0'
    if (value === 0) return '0.0'
    if (Math.abs(value) < 1e-4 || Math.abs(value) >= 1e16) {
      const [mantissa, exponent] = value.toExponential().split('e')
      const e = Number(exponent)
      return `${mantissa}e${e < 0 ? '-' : '+'}${String(Math.abs(e)).padStart(2, '0')}`
    }
    return Number.isInteger(value) ? `${value}.0` : String(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalPython).join(',')}]`
  if (typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${canonicalPython(key)}:${canonicalPython(value[key])}`).join(',')}}`
  return JSON.stringify(value).replace(/[\u007f-\uffff]/g, character => `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`)
}
const fingerprint = value => sha256(canonicalPython(value))
const byID = new Map(dataset.map(row => [row.id, row]))

test('the completed artifact manifest matches every distributed data and model file', async () => {
  const hashes = await json('artifact-hashes.json')
  for (const filename of ['model.json', 'samples.json', 'dataset.json', 'audit.json', 'provenance.json', 'evaluation-cache.json']) assert.ok(Object.hasOwn(hashes, filename))
  for (const [filename, expected] of Object.entries(hashes)) {
    assert.ok(!filename.includes('/') && !filename.includes('\\') && filename !== '..')
    assert.match(expected, /^[a-f0-9]{64}$/)
    assert.equal(sha256(await readFile(asset(filename))), expected, filename)
  }
})

test('source bytes, kernel versions and reproduction code identify the pinned label cache', async () => {
  assert.deepEqual(model.provenance, provenance)
  assert.deepEqual(model.baseDesign, base)
  const source = provenance.source
  assert.ok(Object.keys(source.sha256).length > 10)
  for (const [filename, expected] of Object.entries(source.sha256)) {
    assert.ok(!filename.startsWith('/') && !filename.split('/').includes('..'))
    assert.match(expected, /^[a-f0-9]{64}$/)
    assert.equal(sha256(await readFile(asset(`source/${filename}`))), expected, filename)
  }
  assert.equal(fingerprint(source.sha256), source.snapshotSHA256)
  assert.deepEqual(Object.keys(source.physicsRuntimeVersions).sort(), ['networkx', 'numba', 'numpy', 'python', 'scipy'])
  for (const [name, version] of Object.entries(source.physicsRuntimeVersions)) {
    assert.equal(typeof version, 'string')
    assert.equal(provenance.runtimeVersions[name], version)
  }
  const expectedPhysics = fingerprint({ sourceSHA256: source.snapshotSHA256, runtimeVersions: source.physicsRuntimeVersions })
  assert.equal(source.physicsSHA256, expectedPhysics)
  assert.equal(cache.physicsHash, expectedPhysics)
  assert.equal(sha256(await readFile(new URL('../scripts/reproduce-design-nn.py', import.meta.url))), provenance.reproductionScriptSHA256)
})

test('128 complete geometries realize the preassigned physical slice without changing its fixtures', () => {
  assert.equal(dataset.length, 128)
  assert.equal(plan.length, 128)
  assert.equal(new Set(dataset.map(row => row.designHash)).size, 128)
  assert.equal(new Set(dataset.map(row => `${row.spineWidth}:${row.gap}`)).size, 128)
  for (const [index, row] of dataset.entries()) {
    const planned = plan[index]
    for (const key of ['id', 'split', 'spineWidth', 'gap', 'designHash']) assert.equal(row[key], planned[key])
    for (const key of ['spineWidth', 'gap']) {
      near(row[key] * 1000, Math.round(row[key] * 1000), 1e-9)
      assert.ok(Math.abs(row[key] - planned.requestedInputs[key]) <= .000500000001)
    }
    const w = row.spineWidth, g = row.gap, expected = structuredClone(base)
    for (const region of expected.regions) {
      if (region.id === 'T2') Object.assign(region, { rect_mm: [2, 8 + g, 40 - w, 10 - g], fixed: false })
      if (region.id === 'T3') Object.assign(region, { rect_mm: [42 - w, 8 + g, w, 34 - g], fixed: false })
    }
    for (const component of expected.components) {
      if (component.id === 'D1') Object.assign(component, { rect_mm: [8, 9 + g, 4, 6], fixed: false })
      if (component.id === 'D2') Object.assign(component, { rect_mm: [17, 9 + g, 4, 6], fixed: false })
    }
    // Numerically equivalent rectangle expressions can differ at the last bit.
    for (const [i, region] of row.design.regions.entries()) {
      region.rect_mm.forEach((value, axis) => near(value, expected.regions[i].rect_mm[axis], 1e-12))
      expected.regions[i].rect_mm = [...region.rect_mm]
    }
    assert.deepEqual(row.design, expected)
    assert.equal(fingerprint(row.design), row.designHash)
    const area = row.design.regions.filter(region => region.layer === 'top').reduce((sum, region) => sum + region.rect_mm[2] * region.rect_mm[3], 0)
    near(area, 1216 + 24 * w - 40 * g, 1e-8)
  }
})

test('every main target is a passive common-4mm PEEC result tied to its exact geometry cache key', () => {
  assert.deepEqual(model.dataset.mesh, mesh)
  assert.deepEqual(provenance.generation.mainMesh, mesh)
  assert.equal(samples.length, 128)
  for (const [index, row] of dataset.entries()) {
    const result = row.electrical, summary = samples[index]
    assert.deepEqual(result.mesh, mesh)
    assert.equal(result.frequency_hz, 100000)
    assert.equal(result.loop_name, base.loop.name)
    assert.ok(Number.isFinite(result.inductance_h) && result.inductance_h > 0)
    assert.ok(Number.isFinite(result.resistance_ohm) && result.resistance_ohm > 0)
    assert.ok(Number.isFinite(result.relative_residual) && result.relative_residual >= 0 && result.relative_residual < 1e-7)
    assert.ok(Number.isFinite(result.elapsed_s) && result.elapsed_s > 0)
    assert.ok(Number.isInteger(result.branch_count) && result.branch_count > 0 && result.branch_count <= mesh.max_branches)
    assert.ok(Number.isInteger(result.node_count) && result.node_count > 0)
    near(result.inductance_nh, result.inductance_h * 1e9)
    near(result.resistance_mohm, result.resistance_ohm * 1e3)
    near(result.impedance_real_ohm, result.resistance_ohm, 1e-14)
    near(result.impedance_imag_ohm, 2 * Math.PI * result.frequency_hz * result.inductance_h, 1e-14)
    assert.deepEqual(result, cache.evaluations[fingerprint({ designHash: row.designHash, mesh })])
    for (const key of ['id', 'split', 'spineWidth', 'gap', 'designHash']) assert.equal(summary[key], row[key])
    assert.equal(summary.inductanceNH, result.inductance_nh)
    assert.equal(summary.resistanceMilliOhm, result.resistance_mohm)
    assert.equal(summary.targetMeshMM, 4)
    assert.equal(summary.frequencyHz, 100000)
    assert.equal(summary.softwareEstimate, true)
    assert.ok(row.design.bond_wires.every(wire => wire.segments === 8))
  }
})

test('finer sentinel results remain separate and their refinement flags match the actual changes', () => {
  assert.deepEqual(audit.geometry, geometryAudit)
  assert.equal(geometryAudit.checkedCount, 41 * 41 + 128)
  assert.equal(geometryAudit.valid, true)
  assert.equal(geometryAudit.uniqueSamples, 128)
  assert.deepEqual(geometryAudit.failures, [])
  assert.equal(audit.mesh.checks.length, 6)
  for (const check of audit.mesh.checks) {
    const row = byID.get(check.id)
    assert.ok(row)
    assert.equal(row.split, 'train')
    assert.deepEqual(check.coarse, row.electrical)
    assert.deepEqual(check.fine.mesh, { ...mesh, cell_mm: 3 })
    assert.deepEqual(check.fine, cache.evaluations[fingerprint({ designHash: row.designHash, mesh: { ...mesh, cell_mm: 3 } })])
    const fraction = Math.abs(check.coarse.inductance_h - check.fine.inductance_h) / check.fine.inductance_h
    near(check.changePercent, fraction * 100)
    assert.equal(check.withinTolerance, fraction <= .02)
  }
  near(audit.mesh.maxChangePercent, Math.max(...audit.mesh.checks.map(check => check.changePercent)))
  assert.equal(audit.mesh.allWithinTolerance, audit.mesh.checks.every(check => check.withinTolerance))
})

test('three FastHenry comparisons preserve the shared-graph fixture and recomputable numerical differences', () => {
  const reference = audit.fastHenry
  assert.equal(reference.available, true)
  assert.equal(reference.checks.length, 3)
  assert.deepEqual(reference.checks.map(check => [check.spineWidth, check.gap]).sort(), [[7, .5], [13, 2.5], [10, 2]].sort())
  assert.equal(new Set(reference.checks.map(check => check.reference_input_sha256)).size, 3)
  assert.equal(new Set(reference.checks.map(check => check.reference_executable_sha256)).size, 1)
  for (const check of reference.checks) {
    const row = byID.get(check.id)
    assert.ok(row)
    assert.deepEqual(check.powersynth.mesh, mesh)
    near(check.powersynth.inductance_nh, row.electrical.inductance_nh)
    assert.deepEqual(check.reference_model.mesh, mesh)
    assert.equal(check.reference_model.frequency_hz, 100000)
    assert.equal(check.reference_model.cross_section_subdivisions, 1)
    assert.deepEqual(check.reference_solver_options, ['-s', 'ludecomp', '-m', 'direct', '-a', 'off'])
    assert.match(check.reference_executable_sha256, /^[a-f0-9]{64}$/)
    assert.match(check.reference_input_sha256, /^[a-f0-9]{64}$/)
    assert.ok(check.fasthenry.inductance_h > 0 && check.fasthenry.resistance_ohm > 0)
    const fraction = Math.abs(check.powersynth.inductance_h - check.fasthenry.inductance_h) / check.fasthenry.inductance_h
    near(check.relative_inductance_difference, fraction)
    near(check.differencePercent, fraction * 100)
  }
  near(reference.maxDifferencePercent, Math.max(...reference.checks.map(check => check.differencePercent)))
})

test('completion records retain numerical-estimator scope without invented or failed labels', () => {
  assert.equal(progress.status, 'complete')
  assert.equal(progress.mainTotal, 128)
  assert.equal(progress.mainComplete, 128)
  assert.deepEqual(progress.failures, [])
  assert.deepEqual(failures, [])
  assert.deepEqual(progress.testMetrics, model.metrics.test)
  assert.equal(provenance.softwareChecksOnly, true)
  assert.equal(provenance.hardwareValidated, false)
  assert.equal(provenance.generation.reusedLegacyLabels, false)
  assert.equal(model.output.unit, 'nH')
  assert.match(model.output.target, /common 4 mm/)
})
