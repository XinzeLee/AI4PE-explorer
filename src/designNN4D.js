// Design NN v2: four physical geometry inputs, fixed offline PEEC targets.
// The two-input v1 runtime/assets remain available in designNN.js.
export { resolveDesignEndpoint, makeDesignWirePoints } from './designNN.js'

export const DESIGN_INPUT_ORDER = Object.freeze(['spineWidth', 'gap', 'barHeight', 'dieOffset'])
export const DEFAULT_DESIGN_INPUTS = Object.freeze({ spineWidth: 10, gap: 2, barHeight: 6, dieOffset: 0 })
export const DESIGN_INPUT_BOUNDS = Object.freeze({
  spineWidth: Object.freeze([7, 13]), gap: Object.freeze([.5, 2.5]),
  barHeight: Object.freeze([4.75, 6]), dieOffset: Object.freeze([-.75, .75]),
})
const referenceIndices = new WeakMap()
const micron = value => Math.round(value * 1000) / 1000
const finiteArray = (value, count) => Array.isArray(value) && value.length === count && value.every(Number.isFinite)

export function normalizeDesignInputs(inputs) {
  const realized = {}
  for (const key of DESIGN_INPUT_ORDER) {
    const value = inputs?.[key], [minimum, maximum] = DESIGN_INPUT_BOUNDS[key]
    if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('All four geometry inputs must be finite numbers.')
    if (value < minimum || value > maximum) throw new Error(`${key} must be between ${minimum} and ${maximum} mm.`)
    realized[key] = micron(value)
  }
  return realized
}

const referenceKey = inputs => DESIGN_INPUT_ORDER.map(key => inputs[key].toFixed(3)).join(':')

function validateNetwork(network) {
  if (!finiteArray(network?.scaler?.mean, 4) || !finiteArray(network?.scaler?.scale, 4) || network.scaler.scale.some(value => value <= 0)) throw new Error('Design model input scaling is invalid.')
  if (!Number.isFinite(network?.targetScaler?.mean) || !Number.isFinite(network?.targetScaler?.scale) || network.targetScaler.scale <= 0) throw new Error('Design model target scaling is invalid.')
  const types = ['linear', 'tanh', 'linear', 'tanh', 'linear']
  if (!Array.isArray(network.layers) || network.layers.length !== types.length) throw new Error('Design model architecture is invalid.')
  let inputWidth = 4, hiddenWidth
  for (let i = 0; i < types.length; i++) {
    const layer = network.layers[i]
    if (layer?.type !== types[i]) throw new Error('Design model architecture is invalid.')
    if (layer.type === 'linear') {
      const width = layer.bias?.length
      if ((i === 0 && ![32, 64].includes(width)) || (i === 2 && width !== hiddenWidth) || (i === 4 && width !== 1)) throw new Error('Design model layer dimensions are invalid.')
      if (!finiteArray(layer.bias, width) || !Array.isArray(layer.weight) || layer.weight.length !== width || !layer.weight.every(row => finiteArray(row, inputWidth))) throw new Error('Design model weights are invalid.')
      inputWidth = width
      if (i === 0) hiddenWidth = width
    }
  }
}

function evaluate(network, inputs) {
  let values = DESIGN_INPUT_ORDER.map((key, i) => (inputs[key] - network.scaler.mean[i]) / network.scaler.scale[i])
  for (const layer of network.layers) {
    if (layer.type === 'linear') values = layer.weight.map((weights, row) => weights.reduce((sum, weight, i) => sum + weight * values[i], layer.bias[row]))
    else values = values.map(Math.tanh)
  }
  const output = values[0] * network.targetScaler.scale + network.targetScaler.mean
  if (!Number.isFinite(output) || output <= 0) throw new Error('The Design model produced an invalid inductance.')
  return output
}

export function createDesignNNBundle(model, samples, audit) {
  if (model?.schemaVersion !== 2 || JSON.stringify(model.inputOrder) !== JSON.stringify(DESIGN_INPUT_ORDER)) throw new Error('Unsupported four-input Design model format.')
  validateNetwork(model.network)
  if (JSON.stringify(model.baseDesign?.board_mm) !== '[45,50]' || model.baseDesign.loop?.frequency_hz !== 100000 || model.baseDesign.loop.source !== 'L5.P' || model.baseDesign.loop.sink !== 'L1.P') throw new Error('The source geometry or extraction fixture is invalid.')
  if (!Array.isArray(samples) || samples.length !== 256) throw new Error('The 256-layout Design dataset is incomplete.')
  const index = new Map(), counts = { train: 0, validation: 0, test: 0 }
  for (const sample of samples) {
    const realized = normalizeDesignInputs(sample)
    if (!Number.isFinite(sample.inductanceNH) || sample.inductanceNH <= 0 || !Object.hasOwn(counts, sample.split)) throw new Error('A Design solver reference is invalid.')
    if (DESIGN_INPUT_ORDER.some(key => realized[key] !== sample[key])) throw new Error('A Design reference violates the source geometry lattice.')
    if (typeof sample.designHash !== 'string' || !/^[a-f0-9]{64}$/.test(sample.designHash)) throw new Error('A Design geometry hash is invalid.')
    const key = referenceKey(realized)
    if (index.has(key)) throw new Error('The Design dataset contains duplicate realized geometry.')
    index.set(key, sample); counts[sample.split]++
  }
  if (JSON.stringify(counts) !== '{"train":160,"validation":48,"test":48}') throw new Error('The Design split is incomplete.')
  if (!audit?.geometry?.valid || audit.geometry.uniqueSamples !== 256 || audit.geometry.dimensions !== 4 || !Array.isArray(audit.mesh?.checks) || audit.mesh.checks.length !== 6) throw new Error('The Design geometry or mesh audit is incomplete.')
  const bundle = { ...model, samples, audit }
  referenceIndices.set(bundle, index)
  return bundle
}

export async function loadDesignNN({ signal } = {}) {
  const base = import.meta.env?.BASE_URL || '/'
  const fetchAsset = async filename => {
    const response = await fetch(`${base}models/design-nn-4d/${filename}`, { signal })
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
  return index.get(referenceKey(normalizeDesignInputs(inputs))) || null
}

export function makeDesignGeometry(bundle, inputs) {
  const { spineWidth, gap, barHeight, dieOffset } = normalizeDesignInputs(inputs)
  const design = structuredClone(bundle.baseDesign), y0 = 2 + barHeight + gap
  for (const region of design.regions) {
    if (region.id === 'T1') { region.rect_mm = [2, 2, 40, barHeight]; region.fixed = false }
    if (region.id === 'T2') { region.rect_mm = [2, y0, 40 - spineWidth, 18 - y0]; region.fixed = false }
    if (region.id === 'T3') { region.rect_mm = [42 - spineWidth, y0, spineWidth, 42 - y0]; region.fixed = false }
  }
  for (const component of design.components) {
    if (component.id === 'D1') { component.rect_mm = [8 + dieOffset, y0 + 1, 4, 6]; component.fixed = false }
    if (component.id === 'D2') { component.rect_mm = [17 + dieOffset, y0 + 1, 4, 6]; component.fixed = false }
  }
  return design
}

export function makeDesignLandscape(bundle, { resolution = 41, inputs = DEFAULT_DESIGN_INPUTS, axes = ['spineWidth', 'gap'] } = {}) {
  if (!Number.isInteger(resolution) || resolution < 2 || resolution > 101) throw new Error('Choose a landscape resolution between 2 and 101.')
  if (!Array.isArray(axes) || axes.length !== 2 || axes[0] === axes[1] || axes.some(key => !DESIGN_INPUT_ORDER.includes(key))) throw new Error('Choose two distinct physical landscape axes.')
  const fixed = normalizeDesignInputs(inputs)
  const axisValues = axes.map(key => {
    const [minimum, maximum] = DESIGN_INPUT_BOUNDS[key]
    return Array.from({ length: resolution }, (_, i) => micron(minimum + (maximum - minimum) * i / (resolution - 1)))
  })
  return axisValues[0].flatMap(first => axisValues[1].map(second => {
    const values = { ...fixed, [axes[0]]: first, [axes[1]]: second }
    return { ...values, ...predictDesignNN(bundle, values), reference: findDesignReference(bundle, values) }
  }))
}
