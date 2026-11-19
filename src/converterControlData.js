// Unit-free authored teaching shapes, not trained-controller or circuit results.
export const CONTROL_NOTICE = 'Illustrative AI for PE control/modulation';
export const CONTROL_INSIGHTS = ['dab-modulation'];
export const CONTROL_GROUPS = [
  { id: 'voltage', label: 'Output voltage', partIds: ['J2'], anchorId: 'J2', attachmentRole: 'output-voltage', color: '#3479B7' },
  { id: 'current', label: 'Output current', partIds: ['J2'], anchorId: 'J2', attachmentRole: 'output-current', color: '#BE7D24' },
  { id: 'controller', label: 'Control card', partIds: ['CTRL1'], anchorId: 'CTRL1', attachmentRole: 'control-card', color: '#8264B0' },
  { id: 'drivers', label: 'Gate drivers', partIds: ['GD1', 'GD2', 'GD3', 'GD4'], anchorId: 'GD3', color: '#117766' },
  { id: 'power', label: 'Power bridges', partIds: Array.from({ length: 8 }, (_, i) => `Q${i + 1}`), anchorId: 'Q6', color: '#6B8D84' },
];
export const CONTROL_TARGETS = [...new Set(CONTROL_GROUPS.flatMap(group => group.partIds))];
export const CONTROL_DETAILS = 'Output voltage, current and a reference inform the illustrative NN controller. A Rogowski coil senses the AC component of output current; a separate sensor or estimate is needed for its DC component. The bridge-voltage waveforms illustrate triple phase shift modulation: D0 is the outer interbridge shift; D1 and D2 describe the inner shifts using a normalized pulse-width convention. A smaller dip and faster recovery in this example do not establish general superiority. No trained NN, circuit simulation or real-time controller executes.';

// Illustrative TPS bridge voltages over a normalized switching period. D1 and
// D2 are pulse widths normalized to a half-period; D0 shifts the secondary
// positive-pulse leading edge relative to the primary in units of one period.
export const CONTROL_TPS_PHASES = Object.freeze([
  Object.freeze({ D0: 0.08, D1: 0.60, D2: 0.68 }),
  Object.freeze({ D0: 0.11, D1: 0.68, D2: 0.70 }),
  Object.freeze({ D0: 0.09, D1: 0.64, D2: 0.68 }),
]);
export function makeControlTPSPattern({ D0, D1, D2 }) {
  if (![D0, D1, D2].every(Number.isFinite) || D0 < 0 || D1 <= 0 || D1 > 1 || D2 <= 0 || D2 > 1 || 0.04 + D0 + D2 / 2 > .5) throw new RangeError('Invalid illustrative TPS phase shifts');
  const primaryStart = 0.04, secondaryStart = primaryStart + D0;
  const intervals = (start, width) => ({ positive: [start, start + width / 2], negative: [start + .5, start + .5 + width / 2] });
  return { D0, D1, D2, primary: intervals(primaryStart, D1), secondary: intervals(secondaryStart, D2) };
}
export function getControlTPSPattern(phase = 0) {
  const index = Number.isFinite(phase) ? Math.max(0, Math.min(CONTROL_TPS_PHASES.length - 1, Math.floor(phase))) : 0;
  return makeControlTPSPattern(CONTROL_TPS_PHASES[index]);
}

export const CONTROL_LOAD_EVENT = 0.28;
export const CONTROL_REFERENCE = 0.76;
export const CONTROL_RESPONSE_CURVES = [
  { id: 'nn', label: 'NN', color: '#117766', amplitude: 0.12, recovery: 0.30 },
  { id: 'pi', label: 'PI', color: '#3479B7', amplitude: 0.22, recovery: 0.58 },
];

// Compact-support authored dip. It is continuous at the common load event and
// rejoins the same reference exactly; its normalized parameters are not metrics.
export function getControlResponseValue(controller, time) {
  const curve = CONTROL_RESPONSE_CURVES.find(item => item.id === controller);
  if (!curve) throw new RangeError(`Unknown illustrative controller: ${controller}`);
  if (!Number.isFinite(time)) return CONTROL_REFERENCE;
  const progress = (time - CONTROL_LOAD_EVENT) / curve.recovery;
  if (progress <= 0 || progress >= 1) return CONTROL_REFERENCE;
  const shape = progress * (1 - progress) ** 3 / (0.25 * 0.75 ** 3);
  return CONTROL_REFERENCE - curve.amplitude * shape;
}

export function getControlResponsePoints(controller, count = 121) {
  const curve = CONTROL_RESPONSE_CURVES.find(item => item.id === controller);
  if (!curve) throw new RangeError(`Unknown illustrative controller: ${controller}`);
  const samples = Number.isFinite(count) ? Math.max(2, Math.min(1001, Math.floor(count))) : 121;
  const times = new Set(Array.from({ length: samples }, (_, index) => index / (samples - 1)));
  times.add(CONTROL_LOAD_EVENT);
  times.add(CONTROL_LOAD_EVENT + curve.recovery);
  return [...times].sort((a, b) => a - b).map(time => ({ time, value: getControlResponseValue(controller, time) }));
}
