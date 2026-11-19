import { useId } from 'react';
import { getControlTPSPattern } from './converterControlData';

const LEFT = 60, RIGHT = 350, PERIODS = 2;
const x = time => LEFT + time / PERIODS * (RIGHT - LEFT);
function bridgePath(intervals, center, amplitude) {
  let path = `M${x(0)} ${center}`;
  for (let period = 0; period < PERIODS; period++) {
    for (const [interval, level] of [[intervals.positive, center - amplitude], [intervals.negative, center + amplitude]]) {
      path += `H${x(period + interval[0])}V${level}H${x(period + interval[1])}V${center}`;
    }
  }
  return `${path}H${x(PERIODS)}`;
}

export function ControlSignals({ phase = 0 }) {
  const id = useId(), { primary, secondary } = getControlTPSPattern(phase);
  return <figure className="control-signals" style={{ margin: 0, minWidth: 0 }}>
    <svg viewBox="0 0 380 214" width="100%" role="img" aria-labelledby={`${id}-title ${id}-description`} style={{ display: 'block' }}>
      <title id={`${id}-title`}>Triple phase shift bridge-voltage waveforms</title>
      <desc id={`${id}-description`}>Primary and secondary bridge voltages have positive, zero and negative levels, with half-wave symmetry. D0 is the outer shift between the positive-pulse leading edges. D1 and D2 represent the inner bridge phase shifts using the convention of pulse widths normalized to half a switching period. The curves are illustrative.</desc>
      <g fill="#43534C" fontFamily="inherit" fontSize="23">
        <text x="6" y="62">v<tspan baselineShift="sub" fontSize="15">p</tspan></text>
        <text x="6" y="142">v<tspan baselineShift="sub" fontSize="15">s</tspan></text>
        <text x={(x(primary.positive[0]) + x(primary.positive[1])) / 2} y="19" textAnchor="middle">D<tspan baselineShift="sub" fontSize="15">1</tspan></text>
        <text x={(x(secondary.positive[0]) + x(secondary.positive[1])) / 2} y="99" textAnchor="middle">D<tspan baselineShift="sub" fontSize="15">2</tspan></text>
        <text x={(x(primary.positive[0]) + x(secondary.positive[0])) / 2} y="204" textAnchor="middle">D<tspan baselineShift="sub" fontSize="15">0</tspan></text>
      </g>
      <g fill="none" stroke="#C6D0CA" strokeWidth="1" strokeDasharray="3 4" aria-hidden="true"><path d={`M${LEFT} 58H${RIGHT}M${LEFT} 138H${RIGHT}M${x(1)} 25V180`} /></g>
      <g fill="none" strokeWidth="2.3" strokeLinejoin="round" aria-hidden="true"><path d={bridgePath(primary, 58, 22)} stroke="#8264B0" /><path d={bridgePath(secondary, 138, 22)} stroke="#117766" /></g>
      <g fill="none" stroke="#43534C" strokeWidth="1" aria-hidden="true"><path d={`M${x(primary.positive[0])} 28V24H${x(primary.positive[1])}V28M${x(secondary.positive[0])} 108V104H${x(secondary.positive[1])}V108M${x(primary.positive[0])} 183V188H${x(secondary.positive[0])}V183`} /></g>
    </svg>
    <figcaption>D<sub>0</sub>: outer shift · D<sub>1</sub>, D<sub>2</sub>: inner shifts (normalized pulse-width convention)</figcaption>
  </figure>;
}
