// Browser inference for the reproducible controlled-geometry PowerSynth dataset.
// Offline PEEC labels use a fixed 4 mm mesh; this module never runs a solver.
export const DEFAULT_DESIGN_INPUTS = Object.freeze({ spineWidth: 10, gap: 2 })
export const DESIGN_INPUT_BOUNDS = Object.freeze({ spineWidth: Object.freeze([7, 13]), gap: Object.freeze([0.5, 2.5]) })
const INPUT_ORDER = ['spineWidth', 'gap']
const referenceIndices = new WeakMap()
const micron = value => Math.round(value * 1000) / 1000

export function normalizeDesignInputs(inputs) {
  const values = INPUT_ORDER.map(key => inputs?.[key])
  if (!values.every(value => typeof value === 'number' && Number.isFinite(value))) throw new Error('Both geometry inputs must be finite numbers.')
  for (let index = 0; index < values.length; index++) {
    const [minimum, maximum] = DESIGN_INPUT_BOUNDS[INPUT_ORDER[index]]
    if (values[index] < minimum || values[index] > maximum) throw new Error(`${INPUT_ORDER[index]} must be between ${minimum} and ${maximum} mm.`)
  }
  // The source geometry kernel requires integer micrometres. Prediction and
  // preview always refer to this same realized physical geometry.
  return Object.fromEntries(INPUT_ORDER.map((key, index) => [key, micron(values[index])]))
}

const referenceKey = inputs => INPUT_ORDER.map(key => inputs[key].toFixed(3)).join(':')
const finiteArray = (value, length) => Array.isArray(value) && value.length === length && value.every(Number.isFinite)

function validateNetwork(network) {
  if (!finiteArray(network?.scaler?.mean, 2) || !finiteArray(network?.scaler?.scale, 2) || network.scaler.scale.some(value => value <= 0)) throw new Error('Design model input scaling is invalid.')
  if (!Number.isFinite(network?.targetScaler?.mean) || !Number.isFinite(network?.targetScaler?.scale) || network.targetScaler.scale <= 0) throw new Error('Design model target scaling is invalid.')
  const expected = ['linear', 'tanh', 'linear', 'tanh', 'linear']
  if (!Array.isArray(network.layers) || network.layers.length !== expected.length) throw new Error('Design model architecture is invalid.')
  let width = 2
  let hidden = null
  for (let i = 0; i < expected.length; i++) {
    const layer = network.layers[i]
    if (layer?.type !== expected[i]) throw new Error('Design model architecture is invalid.')
    if (layer.type === 'linear') {
      const outputWidth = layer.bias?.length
      if ((i === 0 && ![16, 32].includes(outputWidth)) || (i === 2 && outputWidth !== hidden) || (i === 4 && outputWidth !== 1)) throw new Error('Design model layer dimensions are invalid.')
      if (!finiteArray(layer.bias, outputWidth) || !Array.isArray(layer.weight) || layer.weight.length !== outputWidth || !layer.weight.every(row => finiteArray(row, width))) throw new Error('Design model weights are invalid.')
      width = outputWidth
      if (i === 0) hidden = outputWidth
    }
  }
}

function evaluate(network, inputs) {
  let values = INPUT_ORDER.map((key, index) => (inputs[key] - network.scaler.mean[index]) / network.scaler.scale[index])
  for (const layer of network.layers) {
    if (layer.type === 'linear') values = layer.weight.map((weights, row) => weights.reduce((sum, weight, column) => sum + weight * values[column], layer.bias[row]))
    else values = values.map(Math.tanh)
  }
  const output = values[0] * network.targetScaler.scale + network.targetScaler.mean
  if (!Number.isFinite(output) || output <= 0) throw new Error('The design model produced an invalid inductance.')
  return output
}

export function createDesignNNBundle(model, samples, audit) {
  if (model?.schemaVersion !== 1 || JSON.stringify(model.inputOrder) !== JSON.stringify(INPUT_ORDER)) throw new Error('Unsupported Design NN model format.')
  validateNetwork(model.network)
  if (!Array.isArray(model.baseDesign?.board_mm) || JSON.stringify(model.baseDesign.board_mm) !== '[45,50]' || model.baseDesign.loop?.frequency_hz !== 100000 || model.baseDesign.loop.source !== 'L5.P' || model.baseDesign.loop.sink !== 'L1.P') throw new Error('The source geometry or extraction fixture is invalid.')
  if (!Array.isArray(samples) || samples.length !== 128) throw new Error('The 128-layout Design dataset is incomplete.')
  const index = new Map()
  const counts = { train: 0, validation: 0, test: 0 }
  for (const sample of samples) {
    const realized = normalizeDesignInputs(sample)
    if (!Number.isFinite(sample.inductanceNH) || sample.inductanceNH <= 0 || !Object.hasOwn(counts, sample.split)) throw new Error('A Design solver reference is invalid.')
    if (INPUT_ORDER.some(key => realized[key] !== sample[key])) throw new Error('A Design reference violates the source geometry lattice.')
    if (typeof sample.designHash !== 'string' || !/^[a-f0-9]{64}$/.test(sample.designHash)) throw new Error('A Design geometry hash is invalid.')
    const key = referenceKey(realized)
    if (index.has(key)) throw new Error('The Design dataset contains duplicate realized geometry.')
    index.set(key, sample)
    counts[sample.split]++
  }
  if (JSON.stringify(counts) !== '{"train":80,"validation":24,"test":24}') throw new Error('The Design split is incomplete.')
  if (!audit?.geometry?.valid || audit.geometry.uniqueSamples !== 128 || !Array.isArray(audit.mesh?.checks) || audit.mesh.checks.length !== 6) throw new Error('The Design geometry or mesh audit is incomplete.')
  const bundle = { ...model, samples, audit }
  referenceIndices.set(bundle, index)
  return bundle
}

export async function loadDesignNN({ signal } = {}) {
  const base = import.meta.env?.BASE_URL || '/'
  const fetchAsset = async filename => {
    const response = await fetch(`${base}models/design-nn/${filename}`, { signal })
    if (!response.ok) throw new Error(`Could not load ${filename} (${response.status}).`)
    return response.json()
  }
  const [model, samples, audit] = await Promise.all(['model.json', 'samples.json', 'audit.json'].map(fetchAsset))
  return createDesignNNBundle(model, samples, audit)
}

export function predictDesignNN(bundle, inputs) {
  const realizedInputs = normalizeDesignInputs(inputs)
  return { inductanceNH: evaluate(bundle.network, realizedInputs), realizedInputs }
}

export function findDesignReference(bundle, inputs) {
  const index = referenceIndices.get(bundle)
  if (!index) throw new Error('Load the Design model before finding solver references.')
  // This is an exact lookup of realized geometry. No nearest-neighbour or
  // interpolated solver score is ever presented as a measured reference.
  return index.get(referenceKey(normalizeDesignInputs(inputs))) || null
}

export function makeDesignGeometry(bundle, inputs) {
  const { spineWidth, gap } = normalizeDesignInputs(inputs)
  const design = structuredClone(bundle.baseDesign)
  const y0 = 8 + gap
  for (const region of design.regions) {
    if (region.id === 'T2') { region.rect_mm = [2, y0, 40 - spineWidth, 18 - y0]; region.fixed = false }
    if (region.id === 'T3') { region.rect_mm = [42 - spineWidth, y0, spineWidth, 42 - y0]; region.fixed = false }
  }
  for (const component of design.components) {
    if (component.id === 'D1') { component.rect_mm = [8, y0 + 1, 4, 6]; component.fixed = false }
    if (component.id === 'D2') { component.rect_mm = [17, y0 + 1, 4, 6]; component.fixed = false }
  }
  return design
}

export function resolveDesignEndpoint(design, ref) {
  const layers = new Map(design.layers.map(layer => [layer.id, layer]))
  const regions = new Map(design.regions.map(region => [region.id, region]))
  const terminal = design.terminals.find(item => item.id === ref)
  if (terminal) {
    if (!terminal.region) return [...terminal.position_mm]
    const region = regions.get(terminal.region)
    const layer = layers.get(region.layer)
    const [x, y, width, height] = region.rect_mm
    const point = [x + width * terminal.uv[0], y + height * terminal.uv[1], layer.z_mm + layer.thickness_mm / 2]
    if (terminal.align_to) {
      const anchor = resolveDesignEndpoint(design, terminal.align_to)
      const axis = terminal.align_axis === 'x' ? 0 : 1
      point[axis] = anchor[axis]
    }
    return point
  }
  const [componentID, pinID] = ref.split('.')
  const component = design.components.find(item => item.id === componentID)
  const pin = component?.pins.find(item => item.id === pinID)
  if (!pin) throw new Error(`Unknown physical endpoint ${ref}.`)
  const layer = layers.get(regions.get(component.parent).layer)
  return [component.rect_mm[0] + pin.offset_mm[0], component.rect_mm[1] + pin.offset_mm[1], layer.z_mm + layer.thickness_mm + pin.offset_mm[2]]
}

export function makeDesignWirePoints(design, wire, wireIndex = 0) {
  const source = resolveDesignEndpoint(design, wire.source)
  const target = resolveDesignEndpoint(design, wire.target)
  if (Array.isArray(wire.waypoints_mm)) return [source, ...wire.waypoints_mm.map(point => [...point]), target]
  const count = wire.count ?? 1
  if (!Number.isInteger(wireIndex) || wireIndex < 0 || wireIndex >= count) throw new Error('Invalid wire index.')
  const segments = wire.segments
  if (!Number.isInteger(segments) || segments < 2) throw new Error('Invalid wire segment count.')
  const dx = target[0] - source[0], dy = target[1] - source[1]
  const norm = Math.hypot(dx, dy)
  const shift = (wireIndex - (count - 1) / 2) * wire.pitch_mm
  const perpendicular = norm > 1e-12 ? [-dy / norm, dx / norm] : [1, 0]
  return Array.from({ length: segments + 1 }, (_, i) => {
    const t = i / segments
    return [source[0] * (1 - t) + target[0] * t + perpendicular[0] * shift,
      source[1] * (1 - t) + target[1] * t + perpendicular[1] * shift,
      source[2] * (1 - t) + target[2] * t + 4 * t * (1 - t) * wire.loop_height_mm]
  })
}

export function makeDesignLandscape(bundle, { resolution = 41 } = {}) {
  if (!Number.isInteger(resolution) || resolution < 2 || resolution > 101) throw new Error('Choose a landscape resolution between 2 and 101.')
  return Array.from({ length: resolution }, (_, i) => 7 + 6 * i / (resolution - 1)).flatMap(spineWidth =>
    Array.from({ length: resolution }, (_, j) => {
      const inputs = normalizeDesignInputs({ spineWidth, gap: .5 + 2 * j / (resolution - 1) })
      return { ...inputs, ...predictDesignNN(bundle, inputs), reference: findDesignReference(bundle, inputs) }
    }))
}
