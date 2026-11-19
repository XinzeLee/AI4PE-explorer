import { useId, useMemo, useRef, useState } from 'react';
import DesignNNSurface from './DesignNNSurface';

const color = (value, min, max) => {
  const t = Math.max(0, Math.min(1, (value - min) / Math.max(1e-9, max - min)));
  return `hsl(${174 - 131 * t} ${40 + 10 * t}% ${29 + 40 * t}%)`;
};
const fmt = (value, digits = 3) => Number(value).toFixed(digits);
const nearest = (values, selected) => values.reduce((best, value) => Math.abs(value - selected) < Math.abs(best - selected) ? value : best, values[0]);

function Heatmap({ rows, inputs, xField, yField, grid, samples, showSamples, onSelect }) {
  const id = useId().replace(/:/g, ''), cellRefs = useRef(new Map());
  const left = 65, top = 16, size = 348;
  const x = value => left + (value - xField.min) / (xField.max - xField.min) * size;
  const y = value => top + (yField.max - value) / (yField.max - yField.min) * size;
  const stepX = size / Math.max(1, grid.xValues.length - 1), stepY = size / Math.max(1, grid.yValues.length - 1);
  const activeX = nearest(grid.xValues, inputs[xField.key]), activeY = nearest(grid.yValues, inputs[yField.key]);
  const key = row => `${row[xField.key]}:${row[yField.key]}`;
  const select = row => onSelect({ [xField.key]: row[xField.key], [yField.key]: row[yField.key] });
  function move(event, row) {
    const delta = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] }[event.key];
    if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(row); return; }
    if (!delta) return;
    event.preventDefault();
    const next = {
      [xField.key]: grid.xValues[Math.max(0, Math.min(grid.xValues.length - 1, grid.xValues.indexOf(row[xField.key]) + delta[0]))],
      [yField.key]: grid.yValues[Math.max(0, Math.min(grid.yValues.length - 1, grid.yValues.indexOf(row[yField.key]) + delta[1]))],
    };
    select(next); cellRefs.current.get(key(next))?.focus();
  }
  return <figure className="design-landscape"><svg viewBox="0 0 450 423" role="group" aria-labelledby={`${id}-title ${id}-desc`}>
    <title id={`${id}-title`}>Predicted loop inductance across {xField.name.toLowerCase()} and {yField.name.toLowerCase()}</title><desc id={`${id}-desc`}>{xField.name} increases to the right from {xField.min} to {xField.max} millimeters. {yField.name} increases upward from {yField.min} to {yField.max} millimeters. Other inputs are held at the values above. Colors show predicted inductance in nanohenries. The crosshair marks the actual selected inputs. Arrow keys navigate the prediction grid.</desc>
    <defs><clipPath id={`${id}-clip`}><rect x={left} y={top} width={size} height={size} /></clipPath></defs>
    <g clipPath={`url(#${id}-clip)`}>{rows.map(row => {
      const active = row[xField.key] === activeX && row[yField.key] === activeY;
      return <rect key={key(row)} ref={element => { if (element) cellRefs.current.set(key(row), element); else cellRefs.current.delete(key(row)); }} x={x(row[xField.key]) - stepX / 2} y={y(row[yField.key]) - stepY / 2} width={stepX + .2} height={stepY + .2} fill={color(row.inductanceNH, grid.min, grid.max)} role="button" tabIndex={active ? 0 : -1} aria-label={`${xField.name} ${fmt(row[xField.key])} millimeters, ${yField.name} ${fmt(row[yField.key])} millimeters, NN estimate ${fmt(row.inductanceNH)} nanohenries`} onClick={() => select(row)} onKeyDown={event => move(event, row)} className="design-map-cell" />;
    })}
    {showSamples ? <g pointerEvents="none" className="design-map-samples">{samples.map((sample, index) => <circle key={sample.id || index} cx={x(sample[xField.key])} cy={y(sample[yField.key])} r="1.7" fill="#f8f9f3" stroke="#1e4438" strokeWidth=".7" />)}</g> : null}
    <g pointerEvents="none" aria-hidden="true" className="design-map-crosshair"><path d={`M${x(inputs[xField.key])} ${top}V${top + size}M${left} ${y(inputs[yField.key])}H${left + size}`} stroke="white" strokeWidth=".7" strokeDasharray="3 3" opacity=".6" /><circle cx={x(inputs[xField.key])} cy={y(inputs[yField.key])} r="5" fill="none" stroke="#fff" strokeWidth="2.8" /><circle cx={x(inputs[xField.key])} cy={y(inputs[yField.key])} r="5" fill="none" stroke="#193c31" strokeWidth="1.2" /></g></g>
    <rect x={left} y={top} width={size} height={size} fill="none" stroke="#6e8d7b" strokeWidth=".7" pointerEvents="none" />
    {[0, .25, .5, .75, 1].map(t => { const vx = xField.min + t * (xField.max - xField.min), vy = yField.min + t * (yField.max - yField.min); return <g key={t} className="design-map-axis"><path d={`M${x(vx)} ${top + size}v5M${left - 5} ${y(vy)}h5`} /><text x={x(vx)} y={top + size + 20} textAnchor="middle">{fmt(vx, 2)}</text><text x={left - 12} y={y(vy) + 4} textAnchor="end">{fmt(vy, 2)}</text></g>; })}
    <text x={left + size / 2} y="410" textAnchor="middle" className="design-map-axis-label">{xField.name} {xField.symbol} (mm) →</text><text transform={`translate(15 ${top + size / 2}) rotate(-90)`} textAnchor="middle" className="design-map-axis-label">{yField.name} {yField.symbol} (mm) →</text>
  </svg><figcaption><p>Click a cell · Arrow keys explore the grid</p></figcaption></figure>;
}

/** Heatmap and 3D share the same grid, numeric color scale and conditional slice. */
export default function DesignNNLandscape({ rows, inputs, selectedInductance, fields, axes, onAxesChange, samples = [], onSelect }) {
  const id = useId().replace(/:/g, ''), [showSamples, setShowSamples] = useState(false), [view, setView] = useState('heatmap');
  const xField = fields.find(field => field.key === axes[0]), yField = fields.find(field => field.key === axes[1]);
  const held = fields.filter(field => !axes.includes(field.key));
  const grid = useMemo(() => {
    const values = rows.map(row => row.inductanceNH);
    return { xValues: [...new Set(rows.map(row => row[xField.key]))].sort((a, b) => a - b), yValues: [...new Set(rows.map(row => row[yField.key]))].sort((a, b) => a - b), min: Math.min(...values), max: Math.max(...values) };
  }, [rows, xField.key, yField.key]);
  const sliceSamples = samples.filter(sample => held.every(field => Math.abs(sample[field.key] - inputs[field.key]) < 1e-8));
  const tabs = [{ id: 'heatmap', label: '2D heatmap' }, { id: 'surface', label: '3D landscape' }];
  function changeAxis(index, key) { const next = [...axes]; next[index] = key; onAxesChange(next); }
  function tabKey(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault(); const next = event.key === 'Home' ? 'heatmap' : event.key === 'End' ? 'surface' : view === 'heatmap' ? 'surface' : 'heatmap';
    setView(next); document.getElementById(`${id}-${next}`)?.focus();
  }
  return <section className="design-landscape-card"><div className="design-card-heading"><div><span className="design-step">03 / THE RESPONSE</span><h2>Explore the learned landscape.</h2></div><span className="design-dimension-badge">100 kHz</span></div>
    <p className="design-card-intro">NN loop-inductance estimates across two dimensions. {held.length ? 'The other dimensions stay at their current values.' : 'Select a setting to change the layout.'}</p>
    {fields.length > 2 ? <div className="design-slice-controls"><label>Horizontal axis<select aria-label="Landscape horizontal axis" value={axes[0]} onChange={event => changeAxis(0, event.target.value)}>{fields.map(field => <option key={field.key} value={field.key} disabled={field.key === axes[1]}>{field.name} {field.symbol}</option>)}</select></label><label>Depth / vertical axis<select aria-label="Landscape depth or vertical axis" value={axes[1]} onChange={event => changeAxis(1, event.target.value)}>{fields.map(field => <option key={field.key} value={field.key} disabled={field.key === axes[0]}>{field.name} {field.symbol}</option>)}</select></label></div> : null}
    {held.length ? <div className="design-held-inputs" aria-label="Held geometry inputs"><span>Held fixed</span>{held.map(field => <span key={field.key}><b>{field.symbol}</b> {fmt(inputs[field.key])} mm</span>)}</div> : null}
    <div className="design-landscape-tabs" role="tablist" aria-label="Neural-network landscape view">{tabs.map(tab => <button key={tab.id} id={`${id}-${tab.id}`} role="tab" aria-selected={view === tab.id} aria-controls={`${id}-panel`} tabIndex={view === tab.id ? 0 : -1} onClick={() => setView(tab.id)} onKeyDown={tabKey}>{tab.label}</button>)}</div>
    <div id={`${id}-panel`} className="design-landscape-panel" role="tabpanel" aria-labelledby={`${id}-${view}`}>{view === 'surface' ? <DesignNNSurface rows={rows} inputs={inputs} selectedInductance={selectedInductance} xField={xField} yField={yField} min={grid.min} max={grid.max} onSelect={onSelect} /> : <Heatmap rows={rows} inputs={inputs} xField={xField} yField={yField} grid={grid} samples={sliceSamples} showSamples={showSamples} onSelect={onSelect} />}</div>
    <div className="design-color-scale design-shared-scale" aria-label="Shared heatmap and surface color scale"><span>{fmt(grid.min, 2)}</span><i style={{ background: `linear-gradient(to right, ${color(grid.min, grid.min, grid.max)}, ${color(grid.max, grid.min, grid.max)})` }} /><span>{fmt(grid.max, 2)} nH</span></div>
    <div className="design-map-options">{view === 'heatmap' ? <label><input type="checkbox" checked={showSamples} onChange={event => setShowSamples(event.target.checked)} />Show {sliceSamples.length} {held.length ? 'exact-slice ' : ''}solver points</label> : <span>Selected marker = current NN estimate</span>}<span>{grid.xValues.length} × {grid.yValues.length} NN grid</span></div>
    <p className="design-landscape-note">Both views use the same slice and color limits. Color and height scales adapt to this slice. {held.length ? 'Only source points matching the held inputs belong to this slice. ' : ''}A prediction does not imply an exact solver reference or an optimized design.</p>
  </section>;
}
