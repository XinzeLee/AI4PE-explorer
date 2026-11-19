import { useId } from 'react';
import { CONTROL_LOAD_EVENT, CONTROL_REFERENCE, CONTROL_RESPONSE_CURVES, getControlResponsePoints } from './converterControlData';

const LEFT = 51, RIGHT = 338, TOP = 39, BOTTOM = 156;
const x = time => LEFT + time * (RIGHT - LEFT);
const y = value => BOTTOM - (value - 0.4) / 0.46 * (BOTTOM - TOP);
const responsePath = controller => getControlResponsePoints(controller).map((point, index) => `${index ? 'L' : 'M'}${x(point.time).toFixed(2)} ${y(point.value).toFixed(2)}`).join('');
const paths = Object.fromEntries(CONTROL_RESPONSE_CURVES.map(curve => [curve.id, responsePath(curve.id)]));
const labelColor = '#43534C';

export function ControlResponse({ revealed = true }) {
  const id = useId();
  const legend = [
    ...CONTROL_RESPONSE_CURVES,
    { id: 'reference', label: 'Reference', color: '#59675F', dashed: true },
    { id: 'load', label: 'Load step', color: '#A96C20' },
  ];
  return <figure className="control-response" data-revealed={revealed ? 'true' : 'false'} style={{ margin: 0, minWidth: 0 }}>
    <svg viewBox="0 0 360 198" width="100%" role="img" aria-labelledby={`${id}-title ${id}-description`} style={{ display: 'block' }}>
      <title id={`${id}-title`}>Illustrative output-voltage response to a common load step</title>
      <desc id={`${id}-description`}>{revealed
        ? 'A load-current increase is followed by a voltage dip. The authored NN curve has a smaller dip and earlier recovery than the authored conventional PI curve. Both begin and end at the same reference. The axes have no numerical scale or physical units. No trained model, circuit simulation or real-time controller produced these curves; the comparison does not establish general superiority.'
        : 'Time and Output voltage axes without units or numerical scales. The illustrative comparison appears at the end of the diagram reveal; no controller is running.'}</desc>
      <g fill="none" stroke={labelColor} strokeWidth="1.2" aria-hidden="true">
        <path d={`M${LEFT} ${TOP}V${BOTTOM}H${RIGHT}`} />
        <path d={`M${LEFT} ${TOP + 4}l-3 5m3-5l3 5M${RIGHT - 3} ${BOTTOM}l-5-3m5 3l-5 3`} />
      </g>
      <g fill={labelColor} fontFamily="inherit" fontSize="12">
        <text x={(LEFT + RIGHT) / 2} y="185" textAnchor="middle">Time</text>
        <text transform={`translate(16 ${(TOP + BOTTOM) / 2}) rotate(-90)`} textAnchor="middle">Output voltage</text>
      </g>
      {revealed ? <>
        <path d={`M${LEFT} ${y(CONTROL_REFERENCE)}H${RIGHT}`} fill="none" stroke="#59675F" strokeWidth="1.2" strokeDasharray="4 4" aria-hidden="true" />
        <path d={`M${x(CONTROL_LOAD_EVENT)} 30V${BOTTOM}`} fill="none" stroke="#A96C20" strokeWidth="1" strokeDasharray="2 4" opacity="0.7" aria-hidden="true" />
        <path d={`M${LEFT} 26H${x(CONTROL_LOAD_EVENT)}V13H${RIGHT}`} fill="none" stroke="#A96C20" strokeWidth="1.7" strokeLinejoin="round" aria-hidden="true" />
        <text x={x(CONTROL_LOAD_EVENT) + 7} y="27" fill="#83551D" fontFamily="inherit" fontSize="10">Load step</text>
        {CONTROL_RESPONSE_CURVES.slice().reverse().map(curve => <path key={curve.id} d={paths[curve.id]} fill="none" stroke={curve.color} strokeWidth="2.2" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true" />)}
      </> : <text x={(LEFT + RIGHT) / 2} y={(TOP + BOTTOM) / 2} textAnchor="middle" fill={labelColor} fontFamily="inherit" fontSize="11">Illustrative comparison appears here</text>}
    </svg>
    <figcaption style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '5px 13px', color: labelColor, fontSize: 11, lineHeight: 1.5 }}>
      {legend.map(item => <span key={item.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}><span aria-hidden="true" style={{ width: 15, borderTop: `2px ${item.dashed ? 'dashed' : 'solid'} ${item.color}` }} />{item.label}</span>)}
    </figcaption>
  </figure>;
}
