// Source-derived, fixed-weight Gaussian BiLSTM inference. No runtime ML dependency.
// Adapted from Xinze Li's notebook, Copyright 2026, Apache License 2.0.
// Upstream LICENSE and NOTICE are retained in public/models/rul-nn/source/.
// PyTorch LSTM gates are [input, forget, cell, output]; reverse outputs align to input time.
export const RUL_FEATURES = Object.freeze([
  'node1Voltage', 'node2Voltage', 'collectorEmitterCurrent', 'packageTempurature',
])
export const RUL_WINDOW_SIZE = 200
export const RUL_DEFAULT_CONFIDENCE = 0.9

// Fixed recording-end reference; leave Gaussian estimates and bounds unclipped.
export const rulPercent = (cycles, normalizationCycles) => cycles / normalizationCycles * 100

const bundles = new WeakSet()
const finiteVector = (value, size) => Array.isArray(value) && value.length === size && value.every(Number.isFinite)
const finiteMatrix = (value, rows, columns) => Array.isArray(value) && value.length === rows && value.every(row => finiteVector(row, columns))

function validateWindow(window) {
  if (!finiteMatrix(window, RUL_WINDOW_SIZE, RUL_FEATURES.length)) {
    throw new Error('RUL input must contain 200 samples of the four finite source signals.')
  }
  return window
}

function validateNetwork(network) {
  const validateLSTM = (layer, inputSize, hiddenSize) => {
    if (layer?.inputSize !== inputSize || layer.hiddenSize !== hiddenSize || JSON.stringify(layer.gateOrder) !== '["input","forget","cell","output"]') {
      throw new Error('The RUL recurrent architecture is invalid.')
    }
    for (const direction of ['forward', 'reverse']) {
      const weights = layer[direction]
      if (!weights || !finiteMatrix(weights.weight_ih, hiddenSize * 4, inputSize) ||
          !finiteMatrix(weights.weight_hh, hiddenSize * 4, hiddenSize) ||
          !finiteVector(weights.bias_ih, hiddenSize * 4) || !finiteVector(weights.bias_hh, hiddenSize * 4)) {
        throw new Error('RUL recurrent weights are missing or invalid.')
      }
    }
  }
  const validateNorm = (layer, width) => {
    if (!layer || !finiteVector(layer.weight, width) || !finiteVector(layer.bias, width) ||
        !Number.isFinite(layer.epsilon) || layer.epsilon <= 0) throw new Error('RUL layer normalization is invalid.')
  }
  const validateLinear = (layer, inputs, outputs) => {
    if (!layer || !finiteMatrix(layer.weight, outputs, inputs) || !finiteVector(layer.bias, outputs)) {
      throw new Error('RUL output weights are missing or invalid.')
    }
  }
  if (!network) throw new Error('The RUL network is missing.')
  validateLSTM(network.bilstm1, 4, 32)
  validateNorm(network.ln1, 64)
  validateLSTM(network.bilstm2, 64, 16)
  validateNorm(network.ln2, 32)
  validateLinear(network.fc1, 32, 16)
  validateLinear(network.fcMean, 16, 1)
  validateLinear(network.fcLogvar, 16, 1)
}

export function createRULNNBundle(model, cases, provenance = {}) {
  if (model?.schemaVersion !== 1 || model.windowSize !== RUL_WINDOW_SIZE ||
      JSON.stringify(model.inputOrder) !== JSON.stringify(RUL_FEATURES) || model.intervalType !== 'prediction') {
    throw new Error('Unsupported RUL model format.')
  }
  if (!finiteVector(model.scaler?.mean, 4) || !finiteVector(model.scaler?.scale, 4) || model.scaler.scale.some(value => value <= 0) ||
      !Number.isFinite(model.targetScaler?.mean) || !Number.isFinite(model.targetScaler?.scale) || model.targetScaler.scale <= 0 ||
      !Number.isFinite(model.normalizationCycles) || model.normalizationCycles <= 0) {
    throw new Error('RUL training normalization is missing or invalid.')
  }
  validateNetwork(model.network)
  if (!Array.isArray(cases) || cases.length !== model.metrics?.testCount || cases.length < 3) throw new Error('The RUL held-out windows are incomplete.')
  const ids = new Set()
  const indices = new Set()
  for (const entry of cases) {
    if (!entry || typeof entry.id !== 'string' || ids.has(entry.id) || !Number.isInteger(entry.windowIndex) || indices.has(entry.windowIndex) ||
        entry.split !== 'test' || !Number.isInteger(entry.startSample) || !Number.isInteger(entry.endSample) ||
        entry.endSample - entry.startSample + 1 !== RUL_WINDOW_SIZE || !Number.isInteger(entry.cycleIndex) ||
        !Number.isFinite(entry.target) || entry.target < 0) throw new Error('An RUL test case is invalid or duplicated.')
    validateWindow(entry.window)
    ids.add(entry.id)
    indices.add(entry.windowIndex)
  }
  const bundle = { ...model, model, cases, provenance, metadata: {
    features: model.features, windowSize: model.windowSize, normalizationCycles: model.normalizationCycles,
    metrics: model.metrics, source: model.source,
  } }
  bundles.add(bundle)
  return bundle
}

export async function loadRULNN({ signal } = {}) {
  const base = import.meta.env?.BASE_URL || '/'
  const fetchAsset = async filename => {
    const response = await fetch(`${base}models/rul-nn/${filename}`, { signal })
    if (!response.ok) throw new Error(`Could not load ${filename} (${response.status}).`)
    return response.json()
  }
  const [model, cases, provenance] = await Promise.all(['model.json', 'cases.json', 'provenance.json'].map(fetchAsset))
  return createRULNNBundle(model, cases, provenance)
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value))
}

function recurrentDirection(sequence, layer, weights, reverse) {
  const width = layer.hiddenSize
  let hidden = new Float64Array(width)
  const cell = new Float64Array(width)
  const outputs = new Array(sequence.length)
  const gates = new Float64Array(width * 4)
  for (let iteration = 0; iteration < sequence.length; iteration++) {
    const time = reverse ? sequence.length - iteration - 1 : iteration
    const input = sequence[time]
    for (let gate = 0; gate < width * 4; gate++) {
      const inputWeights = weights.weight_ih[gate]
      const hiddenWeights = weights.weight_hh[gate]
      let sum = weights.bias_ih[gate] + weights.bias_hh[gate]
      for (let index = 0; index < input.length; index++) sum += inputWeights[index] * input[index]
      for (let index = 0; index < width; index++) sum += hiddenWeights[index] * hidden[index]
      gates[gate] = Math.fround(sum)
    }
    const nextHidden = new Float64Array(width)
    for (let index = 0; index < width; index++) {
      const inputGate = sigmoid(gates[index])
      const forgetGate = sigmoid(gates[width + index])
      const cellGate = Math.tanh(gates[2 * width + index])
      const outputGate = sigmoid(gates[3 * width + index])
      cell[index] = Math.fround(forgetGate * cell[index] + inputGate * cellGate)
      nextHidden[index] = Math.fround(outputGate * Math.tanh(cell[index]))
    }
    outputs[time] = nextHidden
    hidden = nextHidden
  }
  return outputs
}

function bidirectional(sequence, layer) {
  const forward = recurrentDirection(sequence, layer, layer.forward, false)
  const reverse = recurrentDirection(sequence, layer, layer.reverse, true)
  return forward.map((vector, time) => [...vector, ...reverse[time]])
}

function normalize(vector, layer) {
  const mean = vector.reduce((sum, value) => sum + value, 0) / vector.length
  const variance = vector.reduce((sum, value) => sum + (value - mean) ** 2, 0) / vector.length
  const scale = 1 / Math.sqrt(variance + layer.epsilon)
  return vector.map((value, index) => Math.fround((value - mean) * scale * layer.weight[index] + layer.bias[index]))
}

function linear(vector, layer) {
  return layer.weight.map((weights, output) => {
    let result = layer.bias[output]
    for (let index = 0; index < vector.length; index++) result += weights[index] * vector[index]
    return Math.fround(result)
  })
}

// Peter J. Acklam's inverse standard normal CDF approximation (absolute error < 1e-8 here).
// The learned standard deviation is independent of the requested central interval probability.
export function normalQuantile(probability) {
  if (!Number.isFinite(probability) || probability <= 0 || probability >= 1) throw new Error('Normal probability must be strictly between zero and one.')
  const a = [-39.69683028665376, 220.9460984245205, -275.9285104469687, 138.357751867269, -30.66479806614716, 2.506628277459239]
  const b = [-54.47609879822406, 161.5858368580409, -155.6989798598866, 66.80131188771972, -13.28068155288572]
  const c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996, 3.754408661907416]
  const polynomial = (coefficients, x) => coefficients.reduce((sum, value) => sum * x + value, 0)
  if (probability < 0.02425) {
    const q = Math.sqrt(-2 * Math.log(probability))
    return polynomial(c, q) / (polynomial(d, q) * q + 1)
  }
  if (probability > 0.97575) {
    const q = Math.sqrt(-2 * Math.log(1 - probability))
    return -polynomial(c, q) / (polynomial(d, q) * q + 1)
  }
  const q = probability - 0.5
  const r = q * q
  return polynomial(a, r) * q / (polynomial(b, r) * r + 1)
}

export function predictRUL(bundle, caseOrWindow, confidence = RUL_DEFAULT_CONFIDENCE) {
  if (!bundles.has(bundle)) throw new Error('Load the RUL model before predicting.')
  if (!Number.isFinite(confidence) || confidence <= 0 || confidence >= 1) throw new Error('RUL interval confidence must be strictly between zero and one.')
  const window = validateWindow(Array.isArray(caseOrWindow) ? caseOrWindow : caseOrWindow?.window)
  const network = bundle.network
  let sequence = window.map(vector => vector.map((value, index) => Math.fround((value - bundle.scaler.mean[index]) / bundle.scaler.scale[index])))
  sequence = bidirectional(sequence, network.bilstm1).map(vector => normalize(vector, network.ln1))
  sequence = bidirectional(sequence, network.bilstm2)
  // Source takes the final aligned output, not the concatenated terminal hidden states.
  const finalStep = normalize(sequence[sequence.length - 1], network.ln2)
  const representation = linear(finalStep, network.fc1).map(value => Math.max(0, value))
  const [meanScaled] = linear(representation, network.fcMean)
  const [logvar] = linear(representation, network.fcLogvar)
  const mean = meanScaled * bundle.targetScaler.scale + bundle.targetScaler.mean
  const std = Math.exp(logvar * 0.5) * bundle.targetScaler.scale
  const radius = normalQuantile((1 + confidence) / 2) * std
  const lower = mean - radius
  const upper = mean + radius
  if (![mean, std, lower, upper].every(Number.isFinite) || std <= 0) throw new Error('The RUL model produced an invalid Gaussian distribution.')
  const percent = 100 / bundle.normalizationCycles
  return { mean, std, lower, upper, confidence, intervalType: 'prediction', unit: 'cycles',
    meanPercent: mean * percent, stdPercent: std * percent, lowerPercent: lower * percent, upperPercent: upper * percent }
}

export function sampleRULCases(bundle, count = 3, rng = Math.random) {
  if (!bundles.has(bundle)) throw new Error('Load the RUL model before sampling cases.')
  if (!Number.isInteger(count) || count < 0 || count > bundle.cases.length || typeof rng !== 'function') throw new Error('Choose a valid number of distinct RUL test windows.')
  const cases = [...bundle.cases]
  for (let index = 0; index < count; index++) {
    const random = rng()
    if (!Number.isFinite(random) || random < 0 || random >= 1) throw new Error('The case sampler requires random values in [0, 1).')
    const selected = index + Math.floor(random * (cases.length - index))
    ;[cases[index], cases[selected]] = [cases[selected], cases[index]]
  }
  return cases.slice(0, count)
}
