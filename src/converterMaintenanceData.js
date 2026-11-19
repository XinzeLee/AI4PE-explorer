// Authored, dimensionless teaching shapes. No live acquisition or NN executes.
export const MAINTENANCE_NOTICE = 'Illustrative maintenance outputs';
export const MAINTENANCE_INSIGHTS = ['capacitor-health', 'switch-health', 'gate-diagnostics', 'magnetic-health', 'cooling-health', 'connection-health'];
export const MAINTENANCE_GROUPS = [
  { id: 'voltage', label: 'Output voltage', partIds: ['J2'], anchorId: 'J2', attachmentRole: 'output-voltage', color: '#3479B7' },
  { id: 'current', label: 'Output current', partIds: ['J2'], anchorId: 'J2', attachmentRole: 'output-current', color: '#BE7D24' },
];
export const MAINTENANCE_TARGETS = [...new Set(MAINTENANCE_GROUPS.flatMap(group => group.partIds))];
export const MAINTENANCE_DETAILS = 'Vout, Iout and operating history/conditions are conceptual inputs to a possible shared supervisory NN with three parallel heads. A Rogowski coil senses AC current ripple; a separate sensor or estimate is needed for DC current. RUL means remaining operation from the present condition to the first modeled service-ending wear-out condition, under assumed future use and uncertainty; sudden random faults are not silently included. The Normal fault class means no open/short indication in this gradual-wear example, not absence of aging. Diagnosis is separate from independent fast hardware protection. Generic ripple, regulation-error and learned-condition trends do not establish component-specific ESR, inductance or thermal resistance. Whole-converter maintenance is the assessment scope, not demonstrated coverage or unique fault localization for every part. No live acquisition, trained NN, calibrated RUL predictor, fault detector or converter simulation runs. Inspection/service planning is illustrative and performs no action.';

export const MAINTENANCE_SIGNAL_STYLES = {
  voltage: { label: 'Vout', color: '#3479B7', mean: 0.62, offset: 0 },
  current: { label: 'Iout', color: '#BE7D24', mean: 0.46, offset: 0.7 },
};
export const MAINTENANCE_RIPPLE_LEVELS = [0.025, 0.040, 0.060, 0.085];
const phaseIndex = phase => Number.isFinite(phase) ? Math.max(0, Math.min(3, Math.floor(phase))) : 0;
const sampleCount = (count, fallback, minimum = 2) => Number.isFinite(count) ? Math.max(minimum, Math.min(1025, Math.floor(count))) : fallback;

export function getMaintenanceWaveform(signal, phase = 0, count = 129) {
  const style = MAINTENANCE_SIGNAL_STYLES[signal];
  if (!style) throw new RangeError(`Unknown maintenance signal: ${signal}`);
  const length = sampleCount(count, 129, 65);
  const amplitude = MAINTENANCE_RIPPLE_LEVELS[phaseIndex(phase)];
  const ripples = Array.from({ length }, (_, index) => {
    const time = index / (length - 1);
    return amplitude * (0.4 + 0.6 * time) * Math.sin(2 * Math.PI * 8 * time + style.offset);
  });
  // Keep the observation-window mean comparable while its ripple grows.
  const center = ripples.reduce((sum, value) => sum + value, 0) / length;
  return ripples.map((ripple, index) => ({ time: index / (length - 1), value: style.mean + ripple - center }));
}

const remainingOutlook = [0.78, 0.65, 0.51, 0.35];
export function getMaintenanceRulData(phase = 0, count = 41) {
  const stage = phaseIndex(phase), length = sampleCount(count, 41);
  return Array.from({ length }, (_, index) => {
    const time = index / (length - 1);
    const estimate = remainingOutlook[stage] + 0.14 * (1 - time);
    const spread = 0.05 + 0.025 * time + 0.009 * stage;
    return { time, estimate, lower: estimate - spread, upper: estimate + spread };
  });
}

export const MAINTENANCE_HEALTH_SERIES = [
  { id: 'ripple', label: 'Ripple trend', color: '#3479B7' },
  { id: 'regulationError', label: 'Regulation-error trend', color: '#A56A1D' },
  { id: 'condition', label: 'Learned condition trend', color: '#8264B0' },
];
export function getMaintenanceHealthData(phase = 0, count = 25) {
  const stage = phaseIndex(phase), length = sampleCount(count, 25);
  return Array.from({ length }, (_, index) => {
    const time = index / (length - 1);
    return { time, ripple: 0.14 + 0.10 * stage + 0.18 * time,
      regulationError: 0.10 + 0.07 * stage + 0.14 * time,
      condition: 0.17 + 0.08 * stage + 0.20 * time };
  });
}

export const MAINTENANCE_FAULT_CLASSES = [
  { id: 'normal', label: 'Normal' },
  { id: 'open', label: 'Possible open circuit' },
  { id: 'short', label: 'Possible short circuit' },
  { id: 'uncertain', label: 'Uncertain' },
];
export function getMaintenanceFaultState(phase = 0) {
  return { classId: 'normal', label: 'Normal', message: 'No open/short indication', wearPresent: phaseIndex(phase) > 0 };
}
