import { ProjectCredit } from './ProjectCredit';
import { ModelRepositoryLink } from './ModelRepositoryLink';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, CircleHelp, Cpu, ExternalLink, Network, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { DEFAULT_DESIGN_INPUTS, DESIGN_INPUT_BOUNDS, findDesignReference, loadDesignNN, makeDesignGeometry, makeDesignLandscape, normalizeDesignInputs, predictDesignNN } from './designNN4D';
import DesignModuleViewer from './DesignModuleViewer';
import DesignNNLandscape from './DesignNNLandscape';
import { pageUrl, sitePath } from './controlLabNavigation';
import './design-nn.css';

const DEFAULT_INPUTS = DEFAULT_DESIGN_INPUTS;
const field = (key, name, symbol, description, fallback) => ({ key, name, symbol, description, min: (DESIGN_INPUT_BOUNDS[key] || fallback)[0], max: (DESIGN_INPUT_BOUNDS[key] || fallback)[1] });
const FIELDS = [
  field('spineWidth', 'Spine width', 'w', 'Width of the vertical T3 switch-node copper.', [7, 13]),
  field('gap', 'Copper gap', 'g', 'Clearance from DC− copper T1 to the T2 shelf.', [.5, 2.5]),
  field('barHeight', 'DC− bar height (in plane)', 'h', 'In-plane height of T1; copper thickness remains 0.2 mm.', [4.75, 6]),
  field('dieOffset', 'Low die-pair translation', 'Δx', 'Moves D1 and D2 together horizontally; their spacing stays fixed.', [-.75, .75]),
];
const fmt = (value, digits = 3) => Number.isFinite(value) ? value.toFixed(digits) : '—';
const signed = value => `${value > 0 ? '+' : ''}${fmt(value)}`;
const modelAssetBase = bundle => sitePath((bundle?.assetBase || (Object.keys(DEFAULT_INPUTS).length > 2 ? 'models/design-nn-4d' : 'models/design-nn')).replace(/^\/+|\/+$/g, ''));
const sourceAssetBase = bundle => sitePath((bundle?.sourceAssetBase || 'models/design-nn/source').replace(/^\/+|\/+$/g, ''));

function GeometryInput({ field, value, onChange }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => { setDraft(String(value)); }, [value]);
  const commit = () => {
    const next = Number(draft);
    if (draft.trim() && Number.isFinite(next)) {
      const clamped = Math.round(Math.max(field.min, Math.min(field.max, next)) * 1000) / 1000;
      setDraft(String(clamped)); onChange(clamped);
    } else setDraft(String(value));
  };
  return <div className="design-input-field"><div className="design-geometry-input-label"><label htmlFor={`design-${field.key}-range`}>{field.name} <span>{field.symbol}</span></label><div className="design-number-wrap"><input id={`design-${field.key}-number`} aria-label={`${field.name} in millimeters`} type="number" min={field.min} max={field.max} step="0.001" value={draft} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => { if (event.key === 'Enter') { commit(); event.currentTarget.blur(); } }} /><span>mm</span></div></div><input id={`design-${field.key}-range`} type="range" min={field.min} max={field.max} step="0.001" value={value} onChange={event => onChange(Number(event.target.value))} style={{ '--design-fill': `${(value - field.min) / (field.max - field.min) * 100}%` }} aria-valuetext={`${fmt(value)} millimeters`} /><div className="design-input-bounds"><span>{field.min} mm</span><span>{field.max} mm</span></div><p>{field.description}</p></div>;
}

function SourceSamples({ bundle, inputs, fields, onSelect }) {
  const samples = bundle.samples || [];
  return <details className="design-samples"><summary><span>Inspect a solved layout</span><small>{samples.length} source-domain samples</small></summary><p>Select an exact solver sample to restore every geometry input, including the held slice parameters. All split labels are retained.</p><div className="design-table-scroll" tabIndex={0} aria-label="Solved layout samples"><table><caption className="design-sr-only">Source-domain geometry in millimeters, solver loop inductance and dataset split</caption><thead><tr><th scope="col">Layout</th>{fields.map(field => <th key={field.key} scope="col" title={field.name}>{field.symbol} (mm)</th>)}<th scope="col">Solver L (nH)</th><th scope="col">Split</th><th scope="col">Inspect</th></tr></thead><tbody>{samples.map((row, i) => {
    const active = fields.every(field => Math.abs(row[field.key] - inputs[field.key]) < 1e-8);
    return <tr key={row.id || i} data-selected={active ? 'true' : 'false'}><td>{row.id || `Layout ${i + 1}`}</td>{fields.map(field => <td key={field.key}>{fmt(row[field.key])}</td>)}<td>{fmt(row.inductanceNH)}</td><td>{row.split || '—'}</td><td><button aria-label={`Inspect solver sample ${row.id || i + 1}`} aria-pressed={active} onClick={() => onSelect(Object.fromEntries(fields.map(field => [field.key, row[field.key]])))}>{active ? <><Check size={11} />Selected</> : 'Select'}</button></td></tr>;
  })}</tbody></table></div></details>;
}

function NetworkArchitecture({ network, fields }) {
  const id = useId().replace(/:/g, '');
  const hidden = network.layers.filter(layer => layer.type === 'linear').slice(0, -1).map(layer => layer.bias.length);
  const activations = network.layers.filter(layer => layer.type !== 'linear').map(layer => layer.type);
  const inputYs = fields.length === 4 ? [28, 67, 106, 145] : [57, 116], hiddenYs = [24, 49, 74, 99, 124, 149];
  return <figure className="design-network-architecture"><svg viewBox="0 0 520 211" role="img" aria-labelledby={`${id}-title ${id}-desc`}>
    <title id={`${id}-title`}>Exported geometry surrogate architecture</title><desc id={`${id}-desc`}>{fields.length} labeled geometry inputs feed hidden layers with {hidden.join(' and ')} neurons and {activations.join(' and ')} activation, followed by one loop-inductance output. Representative neurons are drawn; full layer counts are labeled. This is a structural diagram, not computed neuron activity or feature attribution.</desc>
    <g className="design-arch-edges">{inputYs.flatMap((y, i) => hiddenYs.map((next, j) => <line key={`in-${i}-${j}`} x1="61" y1={y} x2="198" y2={next} />))}{hiddenYs.flatMap((y, i) => hiddenYs.map((next, j) => <line key={`hidden-${i}-${j}`} x1="198" y1={y} x2="343" y2={next} />))}{hiddenYs.map((y, i) => <line key={`out-${i}`} x1="343" y1={y} x2="472" y2="86.5" />)}</g>
    <g className="design-arch-inputs">{fields.map((field, i) => <g key={field.key}><text x="43" y={inputYs[i] + 4} textAnchor="end">{field.symbol}</text><circle cx="61" cy={inputYs[i]} r="6" /></g>)}</g>
    {[198, 343].map((x, i) => <g key={x} className="design-arch-hidden-layer">{hiddenYs.map(y => <circle key={y} cx={x} cy={y} r="5.5" />)}<rect x={x - 13} y="80" width="26" height="14" /><text x={x} y="90" textAnchor="middle" className="design-arch-ellipsis">···</text><text x={x} y="181" textAnchor="middle" className="design-network-size">{hidden[i]} neurons</text><text x={x} y="199" textAnchor="middle" className="design-network-activation">{activations[i]}</text></g>)}
    <g className="design-arch-result"><circle cx="472" cy="86.5" r="7" /><text x="490" y="91">L</text></g>
    <text x="61" y="181" textAnchor="middle" className="design-network-caption">{fields.length} inputs</text><text x="61" y="199" textAnchor="middle" className="design-network-caption">geometry · mm</text><text x="472" y="181" textAnchor="middle" className="design-network-caption">1 output</text><text x="472" y="199" textAnchor="middle" className="design-network-caption">loop L · nH</text>
  </svg><figcaption>Representative neurons · full counts and activation types from exported weights · no live neuron activity is shown</figcaption></figure>;
}

function ArchitecturePanel({ bundle, fields }) {
  return <section className="design-architecture-card" aria-label="Geometry neural-network architecture"><div><span className="design-step">UNDER THE HOOD</span><h2>The geometry-to-inductance network.</h2><p>{fields.length} physical dimensions enter the fixed neural network. One output estimates the modeled commutation-loop inductance at 100 kHz.</p><div className="design-architecture-inputs">{fields.map(field => <span key={field.key}><b>{field.symbol}</b>{field.name}</span>)}</div></div><NetworkArchitecture network={bundle.network} fields={fields} /></section>;
}

function MethodDetails({ bundle, fields }) {
  const metrics = bundle.metrics || {}, audit = bundle.audit || {}, mesh = audit.mesh || {}, external = audit.fastHenry || {};
  const baseline = bundle.training?.baseline, assetBase = modelAssetBase(bundle), sourceBase = sourceAssetBase(bundle);
  const hasBaseline = Number.isFinite(baseline?.degree) && Number.isFinite(baseline?.testMAENH) && Number.isFinite(baseline?.testRMSENH);
  const splits = ['train', 'validation', 'test'].filter(split => metrics[split]);
  return <details className="design-method"><summary><CircleHelp size={15} /><span>Training, solver checks & source</span><small>Separate questions, separate evidence</small></summary><div className="design-method-grid"><section><h3>What the network learns</h3><p>{fields.length} geometry inputs predict one loop inductance at 100 kHz. Fixed trained weights run locally. Changing a control evaluates the network; it does not run a field solver or retrain the model.</p><p>The 45 × 50 mm module comes from the paper-linked PowerSynth 2R benchmark. {fields.length === 4 ? 'The independent inputs are spine width w, copper gap g, in-plane DC− bar height h, and the joint horizontal translation Δx of D1/D2. Height h describes the planar copper footprint, not its 0.2 mm thickness. A fixed mapping updates T1/T2/T3 copper and the low die-pair position. High dies, leads, device sizes, die spacing and source topology remain fixed.' : 'Spine width w and gap g are independent inputs. A fixed mapping changes T2/T3 copper dimensions and the low die pair’s vertical position. In-plane DC− bar height remains 6 mm and horizontal die translation remains zero.'}</p><h4>Neural-network fit to solver data</h4>{splits.length ? <table className="design-metrics-table"><thead><tr><th scope="col">Split</th><th scope="col">MAE (nH)</th><th scope="col">RMSE (nH)</th><th scope="col">Max |error| (nH)</th></tr></thead><tbody>{splits.map(split => <tr key={split}><th scope="row">{split}</th><td>{fmt(metrics[split].maeNH)}</td><td>{fmt(metrics[split].rmseNH)}</td><td>{fmt(metrics[split].maxErrorNH)}</td></tr>)}</tbody></table> : <p>See the source provenance for held-out model results.</p>}{hasBaseline ? <p className="design-method-baseline">Validation-selected degree-{baseline.degree} polynomial Ridge baseline · held-out test MAE {fmt(baseline.testMAENH)} nH / RMSE {fmt(baseline.testRMSENH)} nH.</p> : null}<p className="design-method-muted">These errors compare learned predictions with solver labels. They do not measure error against physical hardware.</p></section>
    <section><h3>What the solver checks establish</h3><p>The labels describe the DC commutation path from L5.P to L1.P with all four device links on. All dataset targets use the same {mesh.targetCellMM || 4} mm mesh. Copper thickness is 0.2 mm and the source ceramic gap is 0.835 mm. Bond-wire diameters and the assumed 1 mm wire height follow the documented source adaptation; wire spans change with geometry.</p><dl className="design-audit-facts"><div><dt>Geometry / connectivity</dt><dd>{audit.geometry?.valid ? 'Checked source-domain layouts' : 'See geometry audit'}</dd></div><div><dt>FastHenry comparison</dt><dd>{Array.isArray(external.checks) ? `${external.checks.length} documented checks` : 'See solver audit'}</dd></div>{Number.isFinite(external.maxDifferencePercent) ? <div><dt>Largest solver difference</dt><dd>{fmt(external.maxDifferencePercent, 2)}%</dd></div> : null}</dl><p>FastHenry uses the same exported conductor graph, so this is not independent geometry validation. Solver comparisons are separate from held-out NN accuracy.</p><p>Loop inductance alone does not establish efficiency, thermal performance, EMI compliance or an optimal converter design. The converter’s co-design and Pareto story remains a separate conceptual illustration.</p></section>
    <div className="design-source-links"><p>Source: PowerSynth paper-linked 2R benchmark · geometry, adaptations, solver settings, trained weights and numerical audit records are included.</p><a href={`${sourceBase}/tpel2019_2R.json`} target="_blank" rel="noreferrer">Source geometry <ExternalLink size={12} /></a><a href={`${assetBase}/provenance.json`} target="_blank" rel="noreferrer">Source provenance <ExternalLink size={12} /></a><a href={`${assetBase}/model.json`} target="_blank" rel="noreferrer">Model & metrics <ExternalLink size={12} /></a><a href={`${assetBase}/audit.json`} target="_blank" rel="noreferrer">Numerical solver audit <ExternalLink size={12} /></a><a href={`${assetBase}/samples.csv`} download>Download solver dataset (CSV) <ExternalLink size={12} /></a></div></div></details>;
}

export default function DesignNNLab({ onBack }) {
  const heading = useRef(null), [inputs, setInputs] = useState(() => ({ ...DEFAULT_INPUTS }));
  const [bundle, setBundle] = useState(null), [loadError, setLoadError] = useState(''), [attempt, setAttempt] = useState(0), [axes, setAxes] = useState(['spineWidth', 'gap']);
  const fields = useMemo(() => (bundle?.inputOrder || Object.keys(DEFAULT_INPUTS)).map(key => FIELDS.find(field => field.key === key)), [bundle]);
  const sourceBase = sourceAssetBase(bundle);
  const heldSignature = fields.filter(field => !axes.includes(field.key)).map(field => `${field.key}:${inputs[field.key]}`).join('|');
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const controller = new AbortController(); let active = true; setLoadError(''); setBundle(null);
    loadDesignNN({ signal: controller.signal }).then(result => { if (active) setBundle(result); }).catch(error => {
      if (active && error.name !== 'AbortError') setLoadError('The trained design model or solver records could not be loaded. Retry to load the local assets again.');
    });
    return () => { active = false; controller.abort(); };
  }, [attempt]);
  const selectInputs = useCallback(next => setInputs(current => normalizeDesignInputs({ ...current, ...next })), []);
  const result = useMemo(() => {
    if (!bundle) return null;
    try { return { prediction: predictDesignNN(bundle, inputs), reference: findDesignReference(bundle, inputs), design: makeDesignGeometry(bundle, inputs) }; }
    catch { return { error: 'The selected geometry could not be evaluated by the trained design model.' }; }
  }, [bundle, inputs]);
  const landscape = useMemo(() => {
    if (!bundle) return null;
    try { return { rows: makeDesignLandscape(bundle, { resolution: 41, inputs, axes }) }; }
    catch { return { error: 'The prediction landscape could not be evaluated.' }; }
  // Only held variables change a conditional slice; plotted inputs move its marker.
  }, [bundle, axes[0], axes[1], heldSignature]);
  const error = loadError || result?.error || landscape?.error, prediction = result?.prediction?.inductanceNH, reference = result?.reference?.inductanceNH;
  const mesh = bundle?.audit?.mesh;
  return <main className="design-nn-lab" data-design-nn-lab="true"><header className="design-lab-topbar"><a href={pageUrl('design')} className="design-lab-back" onClick={event => { if (onBack && event.button === 0 && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onBack(); } }}><ArrowLeft size={16} />Back to Design</a><ModelRepositoryLink /></header>
    <div className="design-lab-content"><section className="design-lab-heading"><div><p className="design-eyebrow"><Network size={14} />DESIGN / LOOP INDUCTANCE SURROGATE OF POWER MODULES</p><h1 ref={heading} tabIndex={-1}>Shape the copper. See the response.</h1><p>{fields.length === 4 ? 'Four' : 'Two'} dimensions. One neural-network estimate of loop inductance.</p></div><div className="design-study-badge"><span>Power-module layout</span><strong>Geometric variables → loop inductance</strong><small>45 × 50 mm DBC · 100 kHz</small></div></section><div className="design-context-note"><Cpu size={19} /><p><strong>A numerical surrogate for a specific power module.</strong> Explore a bounded slice of source geometry. The network estimates solver results; the converter’s conceptual co-design workflow is a separate illustration.</p></div>
    {error ? <section className="design-load-state" role="alert"><CircleHelp size={27} /><h2>Design model unavailable</h2><p>{error}</p><button onClick={() => setAttempt(value => value + 1)}>Retry loading</button></section> : !result || !landscape ? <section className="design-load-state" role="status"><Network size={28} /><h2>Loading the geometry surrogate</h2><p>Fixed trained weights, source geometry and recorded solver comparisons.</p></section> : <><div className="design-playground-grid"><DesignModuleViewer design={result.design} inputs={inputs} />
      <section className="design-input-card" data-input-count={fields.length}><div className="design-card-heading"><div><span className="design-step">02 / SHAPE & PREDICT</span><h2>Change {fields.length === 4 ? 'four' : 'two'} dimensions.</h2></div><button className="design-reset" onClick={() => setInputs({ ...DEFAULT_INPUTS })} aria-label="Reset geometry inputs"><RotateCcw size={12} />Reset</button></div><div className="design-input-fields">{fields.map(field => <GeometryInput key={field.key} field={field} value={inputs[field.key]} onChange={value => selectInputs({ [field.key]: value })} />)}</div><div className="design-fixed-inputs"><SlidersHorizontal size={12} /><span>Fixed substrate, leads and device sizes<br /><small>{fields.length === 4 ? 'Height and gap move the low die pair vertically; Δx translates both dies horizontally.' : 'Gap changes also move the low die pair; source topology is preserved.'}</small></span></div>
      <div className="design-prediction"><span>Predicted loop inductance</span><strong>{fmt(prediction)}<small>nH</small></strong><span className="design-sr-only" role="status" aria-live="polite" aria-atomic="true">Predicted loop inductance: {fmt(prediction)} nanohenries.</span></div>
      <section className="design-reference" aria-label="Exact solver reference"><h3><i className={result.reference ? 'has-reference' : ''} />Exact {mesh?.targetCellMM || 4} mm solver reference</h3>{result.reference ? <><dl><div><dt>Recorded loop inductance</dt><dd>{fmt(reference)} nH</dd></div><div><dt>Prediction − solver</dt><dd>{signed(prediction - reference)} nH</dd></div><div><dt>Sample</dt><dd>{result.reference.id}{result.reference.split ? <small>{result.reference.split}</small> : null}</dd></div></dl><p>Same geometry and solver settings as the selected sample.</p></> : <p>No exact solver reference at these inputs. Select a solved layout below to compare with recorded data.</p>}</section></section>
      <DesignNNLandscape rows={landscape.rows} inputs={inputs} selectedInductance={prediction} fields={fields} axes={axes} onAxesChange={setAxes} samples={bundle.samples} onSelect={selectInputs} /></div><ArchitecturePanel bundle={bundle} fields={fields} /><SourceSamples bundle={bundle} inputs={inputs} fields={fields} onSelect={selectInputs} /><MethodDetails bundle={bundle} fields={fields} /></>}
    <footer className="design-lab-footer"><span>Source geometry → numerical solver data → fixed neural network</span><a href={`${sourceBase}/tpel2019_2R.json`} target="_blank" rel="noreferrer">Inspect source layout <ExternalLink size={12} /></a><ProjectCredit /></footer></div>
  </main>;
}
