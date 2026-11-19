// Fixed-weight browser inference for the two separately trained ECCE2025 models.
// Layer arrays preserve PyTorch's [output][input] weight ordering.
export const DEFAULT_INPUTS = Object.freeze({ P: 100, Vref: 160, D1: 0.6, D2: 0.6 })
export const POWER_LEVELS = Object.freeze([100, 400, 700, 1000])
export const VOLTAGE_LEVELS = Object.freeze([160, 200, 240])
export const MODULATION_LEVELS = Object.freeze(Array.from({ length: 21 }, (_, index) => (60 + index * 2) / 100))
const INPUT_ORDER = ['P', 'Vref', 'D1', 'D2']
const referenceIndices = new WeakMap()

function inputVector(inputs) {
  const values = INPUT_ORDER.map(key => Number(inputs?.[key]))
  if (!values.every(Number.isFinite)) throw new Error('All four model inputs must be finite numbers.')
  if (!POWER_LEVELS.includes(values[0]) || !VOLTAGE_LEVELS.includes(values[1])) {
    throw new Error('Choose a sampled power and reference voltage.')
  }
  if (values[2] < 0.6 || values[2] > 1 || values[3] < 0.6 || values[3] > 1) {
    throw new Error('D1 and D2 must be between 0.60 and 1.00.')
  }
  return values
}

function referenceKey(values) {
  return values.map(value => Number(value).toFixed(8)).join(':')
}

function evaluate(network, values) {
  let current = values.map((value, index) => Math.fround((value - network.scaler.mean[index]) / network.scaler.scale[index]))
  for (const layer of network.layers) {
    if (layer.type === 'linear') {
      current = layer.weight.map((weights, row) => Math.fround(weights.reduce((sum, weight, index) => sum + weight * current[index], layer.bias[row])))
    } else if (layer.type === 'batchnorm') {
      current = current.map((value, index) => Math.fround((value - layer.mean[index]) / Math.sqrt(layer.variance[index] + layer.epsilon) * layer.weight[index] + layer.bias[index]))
    } else if (layer.type === 'relu') {
      current = current.map(value => Math.max(0, value))
    } else if (layer.type === 'tanh') {
      current = current.map(value => Math.fround(Math.tanh(value)))
    } else {
      throw new Error(`Unsupported NN layer: ${layer.type}`)
    }
  }
  if (!current.every(Number.isFinite)) throw new Error('The model produced an invalid prediction.')
  return current
}

function validateNetwork(network, outputCount) {
  const finiteArray = (value, length) => Array.isArray(value) && value.length === length && value.every(Number.isFinite)
  if (!network || !finiteArray(network.scaler?.mean, 4) || !finiteArray(network.scaler?.scale, 4) || network.scaler.scale.some(value => value <= 0)) {
    throw new Error('Model input scaling is missing or invalid.')
  }
  const expected = ['linear', 'batchnorm', outputCount === 1 ? 'relu' : 'tanh', 'linear', 'batchnorm', outputCount === 1 ? 'relu' : 'tanh', 'linear']
  if (!Array.isArray(network.layers) || network.layers.length !== expected.length) throw new Error('The model architecture is invalid.')
  let width = 4
  for (let index = 0; index < expected.length; index++) {
    const layer = network.layers[index]
    if (layer?.type !== expected[index]) throw new Error('The model architecture does not match the exported networks.')
    if (layer.type === 'linear') {
      const outputWidth = index === 6 ? outputCount : 32
      if (!finiteArray(layer.bias, outputWidth) || !Array.isArray(layer.weight) || layer.weight.length !== outputWidth || !layer.weight.every(row => finiteArray(row, width))) throw new Error('Model weights are missing or invalid.')
      width = outputWidth
    } else if (layer.type === 'batchnorm') {
      if (!['weight', 'bias', 'mean', 'variance'].every(key => finiteArray(layer[key], width)) || layer.variance.some(value => value < 0) || !Number.isFinite(layer.epsilon) || layer.epsilon <= 0) throw new Error('Batch normalization parameters are invalid.')
    }
  }
}

export function createControlNNBundle(model, samples) {
  if (model?.schemaVersion !== 1 || JSON.stringify(model.inputOrder) !== JSON.stringify(INPUT_ORDER) || JSON.stringify(model.classMapping) !== '[4,6,8]') throw new Error('Unsupported control model format.')
  validateNetwork(model.regression, 1)
  validateNetwork(model.classification, 3)
  if (!Array.isArray(samples) || samples.length !== 4633) throw new Error('The cleaned simulation dataset is incomplete.')
  const index = new Map()
  for (const sample of samples) {
    const values = inputVector(sample)
    if (!Number.isFinite(sample.stress) || ![4, 6, 8].includes(sample.zvs)) throw new Error('A simulation reference is invalid.')
    const key = referenceKey(values)
    if (index.has(key)) throw new Error('The simulation dataset contains duplicate inputs.')
    index.set(key, sample)
  }
  const bundle = { ...model, samples }
  referenceIndices.set(bundle, index)
  return bundle
}

export async function loadControlNN({ signal } = {}) {
  const base = import.meta.env?.BASE_URL || '/'
  const fetchAsset = async filename => {
    const response = await fetch(`${base}models/control-nn/${filename}`, { signal })
    if (!response.ok) throw new Error(`Could not load ${filename} (${response.status}).`)
    return response.json()
  }
  const [model, samples] = await Promise.all([fetchAsset('model.json'), fetchAsset('samples.json')])
  return createControlNNBundle(model, samples)
}

export function predictControlNN(bundle, inputs) {
  const values = inputVector(inputs)
  const [stress] = evaluate(bundle.regression, values)
  const logits = evaluate(bundle.classification, values)
  const best = logits.reduce((winner, value, index) => value > logits[winner] ? index : winner, 0)
  return { stress, zvs: bundle.classMapping[best], logits }
}

export function findReference(bundle, inputs) {
  const index = referenceIndices.get(bundle)
  if (!index) throw new Error('Load the control model before finding reference samples.')
  return index.get(referenceKey(inputVector(inputs))) || null
}

export function makeLandscape(bundle, P, Vref) {
  return MODULATION_LEVELS.flatMap(D1 => MODULATION_LEVELS.map(D2 => {
    const inputs = { P, Vref, D1, D2 }
    return { D1, D2, ...predictControlNN(bundle, inputs), reference: findReference(bundle, inputs) }
  }))
}
