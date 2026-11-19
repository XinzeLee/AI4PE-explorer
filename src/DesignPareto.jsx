import { useId } from 'react';
import { getDesignParetoFront, PARETO_CANDIDATES } from './converterDesignData';

const LEFT = 54, RIGHT = 340, TOP = 22, BOTTOM = 188;
const x = value => LEFT + value * (RIGHT - LEFT);
const y = value => BOTTOM - value * (BOTTOM - TOP);
const FRONT_COLOR = '#117766', OTHER_COLOR = '#7C8785', LABEL_COLOR = '#43534C';
const front = getDesignParetoFront(PARETO_CANDIDATES);
const frontIds = new Set(front.map(candidate => candidate.id));
const guide = [...front].sort((a, b) => a.efficiency - b.efficiency)
  .map(candidate => `${x(candidate.efficiency).toFixed(1)},${y(candidate.density).toFixed(1)}`).join(' ');

export function DesignPareto({ reveal = true, selectedId, onSelect }) {
  const id = useId();
  const titleId = `${id}-title`, descriptionId = `${id}-description`;
  return <figure className="design-pareto" data-revealed={reveal ? 'true' : 'false'} data-front-ids={reveal ? front.map(candidate => candidate.id).join(' ') : ''} style={{ margin: 0, minWidth: 0 }}>
    <svg viewBox="0 0 360 240" width="100%" role="group" aria-labelledby={`${titleId} ${descriptionId}`} style={{ display: 'block', overflow: 'visible' }}>
      <title id={titleId}>Efficiency and power density: an illustrative two-objective Pareto plot</title>
      <desc id={descriptionId}>{reveal
        ? 'Both normalized objectives increase away from the origin. Twelve gray feasible candidates are dominated. Five green candidates are nondominated among those shown. The dashed line is a visual guide only, not a set of evaluated intermediate designs. All coordinates are authored illustrations; no optimizer was run.'
        : 'Axes range from zero to one. Illustrative candidates will appear when the workflow reaches the comparison. No optimizer is running.'}</desc>
      <style>{'.design-pareto-point:focus{outline:none;stroke:#182F29;stroke-width:3}.design-pareto-point[role="button"]{cursor:pointer}'}</style>
      <rect x={LEFT} y={TOP} width={RIGHT - LEFT} height={BOTTOM - TOP} fill="#F8FAF7" />
      <path d={`M${LEFT} ${TOP}V${BOTTOM}H${RIGHT}`} fill="none" stroke={LABEL_COLOR} strokeWidth="1.4" />
      <path d={`M${LEFT} ${TOP + 5}l-3.2 4.8m3.2-4.8l3.2 4.8M${RIGHT - 5} ${BOTTOM}l-4.8-3.2m4.8 3.2l-4.8 3.2`} fill="none" stroke={LABEL_COLOR} strokeWidth="1.2" />
      <path d={`M${LEFT - 3} ${TOP}H${LEFT}M${RIGHT} ${BOTTOM}v3`} fill="none" stroke={LABEL_COLOR} />
      <g fill={LABEL_COLOR} fontFamily="inherit" fontSize="11">
        <text x={LEFT - 10} y={TOP + 4} textAnchor="end">1</text>
        <text x={LEFT - 10} y={BOTTOM + 4} textAnchor="end">0</text>
        <text x={LEFT} y={BOTTOM + 18} textAnchor="middle">0</text>
        <text x={RIGHT} y={BOTTOM + 18} textAnchor="middle">1</text>
        <text x={(LEFT + RIGHT) / 2} y="231" textAnchor="middle" fontSize="12">Efficiency (normalized)</text>
        <text transform={`translate(15 ${(TOP + BOTTOM) / 2}) rotate(-90)`} textAnchor="middle" fontSize="12">Power density (normalized)</text>
      </g>
      {reveal ? <>
        <polyline points={guide} fill="none" stroke={FRONT_COLOR} strokeWidth="1.4" strokeDasharray="4 4" opacity="0.7" aria-hidden="true" />
        {PARETO_CANDIDATES.filter(candidate => !frontIds.has(candidate.id)).map(candidate => <circle key={candidate.id} cx={x(candidate.efficiency)} cy={y(candidate.density)} r="3.5" fill={OTHER_COLOR} aria-hidden="true" />)}
        {front.map(candidate => <g key={candidate.id}>
          {selectedId === candidate.id ? <circle cx={x(candidate.efficiency)} cy={y(candidate.density)} r="8.5" fill="none" stroke="#182F29" strokeWidth="1.3" aria-hidden="true" /> : null}
          <circle className="design-pareto-point" cx={x(candidate.efficiency)} cy={y(candidate.density)} r="5.1" fill={FRONT_COLOR} stroke="white" strokeWidth="1.3" tabIndex={0}
            role={onSelect ? 'button' : 'img'} aria-label={`Candidate ${candidate.id}, nondominated among shown: normalized efficiency ${candidate.efficiency.toFixed(2)}, normalized power density ${candidate.density.toFixed(2)}`}
            aria-pressed={onSelect ? selectedId === candidate.id : undefined}
            onClick={onSelect ? () => onSelect(candidate.id) : undefined}
            onKeyDown={onSelect ? event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelect(candidate.id); } } : undefined}>
            <title>{`${candidate.id} · efficiency ${candidate.efficiency.toFixed(2)} · power density ${candidate.density.toFixed(2)} · normalized illustration`}</title>
          </circle>
        </g>)}
      </> : <text x={(LEFT + RIGHT) / 2} y={(TOP + BOTTOM) / 2} textAnchor="middle" fill={LABEL_COLOR} fontFamily="inherit" fontSize="11">Design candidates appear here</text>}
    </svg>
    <figcaption style={{ color: LABEL_COLOR, fontSize: 11, lineHeight: 1.5 }}>
      <span style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '5px 14px' }}>
        <span><span aria-hidden="true" style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: OTHER_COLOR, marginRight: 5 }} />Dominated feasible</span>
        <span><span aria-hidden="true" style={{ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: FRONT_COLOR, marginRight: 5 }} />Pareto front among shown</span>
      </span>
      <span style={{ display: 'block', marginTop: 3 }}>Dashed guide only · illustrative normalized values</span>
    </figcaption>
  </figure>;
}
