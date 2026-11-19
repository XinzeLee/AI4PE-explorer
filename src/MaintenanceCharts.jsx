import { useId } from 'react';
import {
  MAINTENANCE_SIGNAL_STYLES, MAINTENANCE_HEALTH_SERIES, MAINTENANCE_FAULT_CLASSES,
  getMaintenanceWaveform, getMaintenanceRulData, getMaintenanceHealthData, getMaintenanceFaultState,
} from './converterMaintenanceData';

const TEXT = '#43534C', INK = '#117766';
const figureStyle = { margin: 0, minWidth: 0 };
const svgStyle = { display: 'block', width: '100%' };
const captionStyle = { color: TEXT, fontSize: 11, lineHeight: 1.45 };
const linePath = (points, x, y, field = 'value') => points.map((point, index) => `${index ? 'L' : 'M'}${x(point.time).toFixed(2)} ${y(point[field]).toFixed(2)}`).join('');
const x = time => 19 + time * 187;
const y = value => 97 - value * 80;

export function MaintenanceSignals({ phase = 0 }) {
  const id = useId();
  const traces = ['voltage', 'current'];
  return <figure className="maintenance-signals" style={figureStyle}>
    <svg viewBox="0 0 300 68" role="img" aria-labelledby={`${id}-title ${id}-description`} style={svgStyle}>
      <title id={`${id}-title`}>Illustrative output voltage and current observation windows</title>
      <desc id={`${id}-description`}>The two authored traces show increasing ripple over the observation window while their average operating levels remain comparable. Later reveal phases show more ripple. These are not acquired converter measurements; no physical units or numerical scale are shown.</desc>
      {traces.map((signal, index) => {
        const style = MAINTENANCE_SIGNAL_STYLES[signal];
        const baseline = index === 0 ? 18 : 43;
        const points = getMaintenanceWaveform(signal, phase);
        return <g key={signal}>
          <text x="7" y={baseline + 4} fill={style.color} fontFamily="inherit" fontSize="15">{style.label}</text>
          <path d={`M51 ${baseline}H289`} stroke="#CDD6D0" strokeDasharray="3 4" fill="none" aria-hidden="true" />
          <path d={linePath(points, time => 51 + time * 238, value => baseline - (value - style.mean) * 90)} stroke={style.color} strokeWidth="1.6" fill="none" strokeLinejoin="round" aria-hidden="true" />
        </g>;
      })}
      <path d="M51 53H289" stroke="#819187" strokeWidth="1" fill="none" aria-hidden="true" />
      <text x="170" y="65" textAnchor="middle" fill={TEXT} fontFamily="inherit" fontSize="11">Time</text>
    </svg>
    <figcaption style={captionStyle}>Comparable operating level <span aria-hidden="true">·</span> growing ripple</figcaption>
  </figure>;
}

export function MaintenanceRul({ phase = 0 }) {
  const id = useId();
  const points = getMaintenanceRulData(phase);
  const band = `${linePath(points, x, y, 'upper')}${points.slice().reverse().map(point => `L${x(point.time).toFixed(2)} ${y(point.lower).toFixed(2)}`).join('')}Z`;
  return <figure className="maintenance-rul" style={figureStyle}>
    <svg viewBox="0 0 220 120" role="img" aria-labelledby={`${id}-title ${id}-description`} style={svgStyle}>
      <title id={`${id}-title`}>Qualitative remaining useful life with uncertainty</title>
      <desc id={`${id}-description`}>An authored remaining-operation estimate declines with an uncertainty band, toward a modeled service limit. Later phases show less remaining operation. This is conditional on assumed future use, not a calibrated time-to-failure prediction or an absolute converter lifetime.</desc>
      <path d="M19 8V97H206" stroke="#819187" strokeWidth="1" fill="none" aria-hidden="true" />
      <path d="M19 97H206" stroke="#A16E28" strokeWidth="1.5" strokeDasharray="4 3" fill="none" aria-hidden="true" />
      <path d={band} fill="#8264B0" fillOpacity="0.18" stroke="none" aria-hidden="true" />
      <path d={linePath(points, x, y, 'estimate')} stroke="#8264B0" strokeWidth="2.1" fill="none" aria-hidden="true" />
      <text x="112" y="114" textAnchor="middle" fill={TEXT} fontFamily="inherit" fontSize="12">Time</text>
    </svg>
    <figcaption style={captionStyle}><span style={{ display: 'block' }}><span aria-hidden="true" style={{ display: 'inline-block', width: 13, borderTop: '2px dashed #A16E28', marginRight: 5 }} />Modeled service limit</span><span style={{ display: 'block' }}>Under assumed future use</span></figcaption>
  </figure>;
}

export function MaintenanceHealth({ phase = 0 }) {
  const id = useId();
  const points = getMaintenanceHealthData(phase);
  return <figure className="maintenance-health" style={figureStyle}>
    <svg viewBox="0 0 220 120" role="img" aria-labelledby={`${id}-title ${id}-description`} style={svgStyle}>
      <title id={`${id}-title`}>Illustrative worsening health indicators</title>
      <desc id={`${id}-description`}>Ripple, regulation-error and learned condition-burden trends increase in this gradual-wear example. Higher trends mean more deviation or worse condition. These generic authored indicators do not identify capacitor ESR, inductance or thermal resistance; no physical units, percentages or numerical scale are shown.</desc>
      <path d="M19 8V97H206" stroke="#819187" strokeWidth="1" fill="none" aria-hidden="true" />
      {MAINTENANCE_HEALTH_SERIES.map(series => <path key={series.id} d={linePath(points, x, y, series.id)} stroke={series.color} strokeWidth="1.9" fill="none" aria-hidden="true" />)}
      <text x="112" y="114" textAnchor="middle" fill={TEXT} fontFamily="inherit" fontSize="12">Time</text>
    </svg>
    <figcaption style={captionStyle}>{MAINTENANCE_HEALTH_SERIES.map(series => <span key={series.id} style={{ display: 'block' }}><span aria-hidden="true" style={{ display: 'inline-block', width: 12, borderTop: `2px solid ${series.color}`, marginRight: 5 }} />{series.label}</span>)}</figcaption>
  </figure>;
}

export function MaintenanceFault({ phase = 0 }) {
  const id = useId();
  const state = getMaintenanceFaultState(phase);
  return <figure className="maintenance-fault" style={figureStyle}>
    <svg viewBox="0 0 220 135" role="img" aria-labelledby={`${id}-title ${id}-description`} style={svgStyle}>
      <title id={`${id}-title`}>Open and short circuit diagnostic head: Normal</title>
      <desc id={`${id}-description`}>Normal is selected, with no open/short indication. Possible open circuit, Possible short circuit and Uncertain are other diagnostic classes. Normal describes this hard-fault head, not absence of gradual wear. Diagnosis does not replace independent fast hardware protection.</desc>
      {MAINTENANCE_FAULT_CLASSES.map((item, index) => {
        const selected = item.id === state.classId, top = 10 + index * 29;
        return <g key={item.id}>
          <rect x="10" y={top} width="200" height="24" rx="4" fill={selected ? '#EDF6F0' : '#FAFBF9'} stroke={selected ? '#77A98D' : '#D6DFD8'} />
          {selected ? <path d={`M20 ${top + 12}l3 3 6-7`} stroke={INK} strokeWidth="1.8" fill="none" aria-hidden="true" /> : <circle cx="24" cy={top + 12} r="3" fill="none" stroke="#819187" aria-hidden="true" />}
          <text x="37" y={top + 16} fill={selected ? '#185D49' : TEXT} fontFamily="inherit" fontSize="12">{item.label}</text>
        </g>;
      })}
    </svg>
    <figcaption style={captionStyle}><strong style={{ display: 'block', color: INK, fontWeight: 600 }}>{state.message}</strong><span>Wear can still progress</span></figcaption>
  </figure>;
}
