import { ProjectCredit } from './ProjectCredit';
import { ModelRepositoryLink } from './ModelRepositoryLink';
import { useEffect, useId, useMemo, useRef, useState, useTransition } from 'react';
import { ArrowLeft, ArrowUpRight, Check, ChevronRight, CircleHelp, ExternalLink, Network, Shuffle } from 'lucide-react';
import { loadRULNN, predictRUL, sampleRULCases, rulPercent } from './rulNN';
import { pageUrl, sitePath } from './controlLabNavigation';
import './rul-lab.css';

const SOURCE = 'https://github.com/XinzeLee/Fundamentals_of_AI_for_PE/tree/0587acf5854b0127f696c13e0367663d24f6ae73/9_Case_Studies_PE/IGBT_Maintenance';
const FEATURES = [
  { name: 'Node 1 voltage', field: 'node1Voltage', color: '#537c9e' },
  { name: 'Node 2 voltage', field: 'node2Voltage', color: '#8c789f' },
  { name: 'Collector-emitter current', field: 'collectorEmitterCurrent', color: '#16806c' },
  { name: 'Package temperature', field: 'packageTempurature', color: '#b47e45' },
];
const fmt = (value, digits = 1) => Number.isFinite(value) ? value.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits }) : '—';
const percent = (value, normalizationCycles) => fmt(rulPercent(value, normalizationCycles));
const range = values => { const low = Math.min(...values), high = Math.max(...values), pad = Math.max((high - low) * .08, Math.abs(low) * .005, .00001); return [low - pad, high + pad]; };

function Waveform({ sample, channel, compact = false, limits }) {
  const id = useId(), width = 560, height = compact ? 145 : 190;
  const left = compact ? 12 : 55, right = 15, top = 18, bottom = compact ? 25 : 37;
  const values = sample.window.map(row => row[channel]);
  const [low, high] = limits || range(values);
  const x = i => left + i / (values.length - 1) * (width - left - right);
  const y = value => top + (high - value) / (high - low) * (height - top - bottom);
  const points = values.map((value, i) => `${x(i).toFixed(2)},${y(value).toFixed(2)}`).join(' ');
  return <svg className={`rul-waveform ${compact ? 'rul-waveform-compact' : ''}`} viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-title ${id}-desc`}>
    <title id={`${id}-title`}>{FEATURES[channel].name}, {sample.id}</title>
    <desc id={`${id}-desc`}>A recorded 200-sample history window. Horizontal axis: sample within window, 0 to 199. Vertical values preserve the source scale. This is measured input data, not a generated waveform.</desc>
    {[0, 1, 2].map(i => <path key={i} className="rul-wave-grid" d={`M${left} ${top + i / 2 * (height - top - bottom)}H${width - right}`} />)}
    <polyline points={points} fill="none" stroke={FEATURES[channel].color} strokeWidth={compact ? 2 : 1.9} strokeLinejoin="round" />
    {!compact && [low, (low + high) / 2, high].map(value => <text key={value} className="rul-plot-tick" x={left - 9} y={y(value) + 4} textAnchor="end">{fmt(value, 2)}</text>)}
    <text className="rul-plot-tick" x={left} y={height - 8}>0</text><text className="rul-plot-tick" x={width - right} y={height - 8} textAnchor="end">199</text><text className="rul-plot-label" x={width / 2} y={height - 8} textAnchor="middle">Sample within window</text>
  </svg>;
}

function IntervalBar({ prediction, target, limits }) {
  const [min, max] = limits;
  const x = value => 18 + (value - min) / (max - min) * 524;
  return <svg className="rul-interval-bar" viewBox="0 0 560 53" role="img" aria-label={`Shared RUL scale ${fmt(min, 0)} to ${fmt(max, 0)} cycles. Predicted mean ${fmt(prediction.mean)}, interval ${fmt(prediction.lower)} to ${fmt(prediction.upper)}, target ${target}.`}>
    <path d="M18 19H542" stroke="#e0e8db" strokeWidth="2" />
    <rect x={x(prediction.lower)} y="13" width={x(prediction.upper) - x(prediction.lower)} height="12" rx="2" fill="#d7e9dc" stroke="#86b297" />
    <path d={`M${x(prediction.mean)} 8V30`} stroke="#16755d" strokeWidth="2.5" />
    <path d={`M${x(target)} 9V29`} stroke="#b27b47" strokeWidth="2" strokeDasharray="3 2" />
    <text x="18" y="47" className="rul-plot-tick">{fmt(min, 0)}</text><text x="542" y="47" className="rul-plot-tick" textAnchor="end">{fmt(max, 0)} cycles</text>
  </svg>;
}

function Distribution({ prediction, target, limits }) {
  const id = useId(), { mean, std, lower, upper } = prediction;
  const width = 560, height = 230, left = 35, right = 25, top = 30, base = 175;
  const spread = Math.max(std, 1), [min, max] = limits;
  const x = value => left + (value - min) / (max - min) * (width - left - right);
  const y = value => base - Math.exp(-.5 * ((value - mean) / spread) ** 2) * (base - top);
  const points = Array.from({ length: 141 }, (_, i) => min + (max - min) * i / 140);
  const line = points.map((v, i) => `${i ? 'L' : 'M'}${x(v).toFixed(2)},${y(v).toFixed(2)}`).join(' ');
  const band = Array.from({ length: 91 }, (_, i) => lower + (upper - lower) * i / 90);
  const fill = `M${x(lower)},${base} ${band.map(v => `L${x(v).toFixed(2)},${y(v).toFixed(2)}`).join(' ')} L${x(upper)},${base}Z`;
  return <svg className="rul-distribution" viewBox={`0 0 ${width} ${height}`} role="img" aria-labelledby={`${id}-title ${id}-desc`}>
    <title id={`${id}-title`}>Gaussian RUL estimate with a 90% prediction interval</title>
    <desc id={`${id}-desc`}>Predicted mean {fmt(mean)} cycles. 90% interval {fmt(lower)} to {fmt(upper)} cycles. Ground-truth target {target} cycles. The shaded band is a model estimate, not confidence in the mean.</desc>
    <path d={fill} fill="#dcece1" /><path d={line} fill="none" stroke="#407a61" strokeWidth="2" />
    <path d={`M${left} ${base}H${width - right}`} className="rul-plot-axis" />
    <path d={`M${x(lower)} ${base}V${y(lower)}M${x(upper)} ${base}V${y(upper)}`} className="rul-band-boundary" />
    <path d={`M${x(mean)} ${base}V${top - 8}`} stroke="#16755d" strokeWidth="1.6" />
    <path d={`M${x(target)} ${base}V${top + 12}`} stroke="#bb8050" strokeWidth="1.6" strokeDasharray="4 4" />
    <text className="rul-plot-label" x={x(mean)} y="14" textAnchor="middle">Mean {fmt(mean)}</text>
    {[min, (min + max) / 2, max].map(v => <text key={v} className="rul-plot-tick" x={x(v)} y={base + 21} textAnchor="middle">{fmt(v, 0)}</text>)}
    <text className="rul-plot-label" x={width / 2} y={height - 9} textAnchor="middle">Remaining detected cycles →</text>
  </svg>;
}

export function RULNetworkDiagram({ bundle, vertical = false }) {
  const id = useId().replace(/:/g, ''), network = bundle.network;
  const steps = bundle.windowSize, channels = bundle.inputOrder.length;
  const first = network.bilstm1.hiddenSize, second = network.bilstm2.hiddenSize;
  const firstWidth = first * 2, secondWidth = second * 2;
  const denseInput = network.fc1.weight[0].length, shared = network.fc1.bias.length;
  const meanInput = network.fcMean.weight[0].length, meanOutput = network.fcMean.bias.length;
  const varianceInput = network.fcLogvar.weight[0].length, varianceOutput = network.fcLogvar.bias.length;
  const boxes = vertical ? {
    input: [20, 8, 350, 112], first: [20, 144, 350, 200], second: [20, 368, 350, 180],
    readout: [20, 572, 350, 112], dense: [20, 708, 350, 112],
    mean: [20, 844, 160, 82], variance: [210, 844, 160, 82], output: [20, 950, 350, 132],
  } : {
    input: [8, 98, 145, 140], first: [187, 51, 220, 234], second: [441, 51, 220, 234],
    readout: [695, 98, 150, 140], dense: [879, 98, 145, 140],
    mean: [1058, 70, 145, 82], variance: [1058, 186, 145, 82], output: [1237, 98, 215, 140],
  };
  const connect = (from, to) => {
    const [x, y, w, h] = boxes[from], [a, b, c, d] = boxes[to];
    if (vertical) { const mid = (y + h + b) / 2; return `M${x + w / 2} ${y + h}V${mid}H${a + c / 2}V${b}`; }
    const mid = (x + w + a) / 2; return `M${x + w} ${y + h / 2}H${mid}V${b + d / 2}H${a}`;
  };
  const node = (key, content, kind = key) => {
    const [x, y, width, height] = boxes[key];
    return <g key={key} transform={`translate(${x} ${y})`} className={`rul-network-${kind}`}><rect className="rul-network-node" width={width} height={height} rx="9" />{content(width, height)}</g>;
  };
  const pill = (width, height, label) => <g className="rul-network-pill"><rect x="12" y={height - 34} width={width - 24} height="23" rx="4" /><text x={width / 2} y={height - 18} textAnchor="middle">{label}</text></g>;
  const recurrent = (key, title, hidden, outputWidth, layerNorm = false) => node(key, (width, height) => <>
    <text className="rul-network-title" x={width / 2} y="26" textAnchor="middle">{title}</text>
    <text className="rul-network-detail" x={width / 2} y="48" textAnchor="middle">{hidden} units / direction</text>
    {[false, true].map(reverse => <g key={String(reverse)} className={reverse ? 'rul-network-reverse' : 'rul-network-forward'}>
      <text x="17" y={reverse ? 111 : 70}>{reverse ? 'Reverse' : 'Forward'}</text>
      <path d={reverse ? `M${width - 17} 123H17` : `M17 82H${width - 17}`} markerEnd={`url(#${id}-${reverse ? 'reverse' : 'forward'})`} />
      {[.37, .55, .73].map(position => <circle key={position} cx={width * position} cy={reverse ? 123 : 82} r="4.5" />)}
    </g>)}
    <text className="rul-network-concat" x={width / 2} y={height - (layerNorm ? 53 : 21)} textAnchor="middle">Concat → {steps} × {outputWidth}</text>
    {layerNorm ? pill(width, height, `LayerNorm ${network.ln1.weight.length} / step`) : null}
  </>, 'recurrent');
  const description = `${steps} time steps with ${channels} training-standardized channels enter a bidirectional LSTM with ${first} hidden units in each direction. Aligned directions concatenate to ${firstWidth} features per step, followed by layer normalization. A second bidirectional LSTM has ${second} units per direction and ${secondWidth} concatenated features. The source selects the last aligned time step, index ${steps - 1}, applies layer normalization, then a shared ${denseInput}-to-${shared} dense layer with ReLU. Separate ${meanInput}-to-${meanOutput} and ${varianceInput}-to-${varianceOutput} linear heads predict standardized mean and log variance. Inverse target scaling gives a Gaussian distribution in detected cycles and a 90 percent prediction interval. The readout is not a concatenation of terminal hidden states.`;
  return <svg className={`rul-network-diagram ${vertical ? 'rul-network-mobile' : 'rul-network-desktop'}`} viewBox={vertical ? '0 0 390 1098' : '0 0 1460 330'} role="img" aria-labelledby={`${id}-title ${id}-desc`}>
    <title id={`${id}-title`}>Gaussian BiLSTM architecture: recorded history to RUL mean and uncertainty</title><desc id={`${id}-desc`}>{description}</desc>
    <defs>{['flow', 'forward', 'reverse'].map(kind => <marker key={kind} id={`${id}-${kind}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M1 1L7 4L1 7Z" className={`rul-network-arrow-${kind}`} /></marker>)}</defs>
    <g className="rul-network-edges" aria-hidden="true">{[['input', 'first'], ['first', 'second'], ['second', 'readout'], ['readout', 'dense'], ['dense', 'mean'], ['dense', 'variance'], ['mean', 'output'], ['variance', 'output']].map(([from, to]) => <path key={`${from}-${to}`} d={connect(from, to)} markerEnd={`url(#${id}-flow)`} />)}</g>
    {node('input', (width, height) => <><text className="rul-network-title" x={width / 2} y="25" textAnchor="middle">Recorded history</text><text className="rul-network-dimension" x={width / 2} y="52" textAnchor="middle">{steps} × {channels}</text><g aria-hidden="true">{FEATURES.map((feature, row) => <g key={feature.field}>{[0, 1, 2, 3, 4, 5].map(column => <circle key={column} cx={width / 2 - 40 + column * 16} cy={height * .55 + row * 7} r="2.2" fill={feature.color} />)}</g>)}</g><text className="rul-network-detail" x={width / 2} y={height - 12} textAnchor="middle">Training-scaled signals</text></>)}
    {recurrent('first', 'BiLSTM layer 1', first, firstWidth, true)}
    {recurrent('second', 'BiLSTM layer 2', second, secondWidth)}
    {node('readout', (width, height) => <><text className="rul-network-title" x={width / 2} y="25" textAnchor="middle">Last aligned step</text><text className="rul-network-dimension" x={width / 2} y="53" textAnchor="middle">{secondWidth} features</text><text className="rul-network-detail" x={width / 2} y="76" textAnchor="middle">t = {steps - 1}</text>{pill(width, height, `LayerNorm ${network.ln2.weight.length}`)}</>)}
    {node('dense', (width, height) => <><text className="rul-network-title" x={width / 2} y="25" textAnchor="middle">Shared dense</text><text className="rul-network-dimension" x={width / 2} y="56" textAnchor="middle">{denseInput} → {shared}</text>{pill(width, height, 'ReLU')}</>)}
    {node('mean', width => <><text className="rul-network-title" x={width / 2} y="23" textAnchor="middle">Mean head</text><text className="rul-network-detail" x={width / 2} y="44" textAnchor="middle">Linear {meanInput} → {meanOutput}</text><text className="rul-network-parameter" x={width / 2} y="68" textAnchor="middle">μ_z</text></>, 'head')}
    {node('variance', width => <><text className="rul-network-title" x={width / 2} y="23" textAnchor="middle">Log-variance</text><text className="rul-network-detail" x={width / 2} y="44" textAnchor="middle">Linear {varianceInput} → {varianceOutput}</text><text className="rul-network-parameter" x={width / 2} y="68" textAnchor="middle">log σ²_z</text></>, 'head')}
    {node('output', (width, height) => <><text className="rul-network-title" x={width / 2} y="25" textAnchor="middle">Gaussian RUL</text><text className="rul-network-detail" x={width / 2} y="48" textAnchor="middle">Inverse scaling → cycles</text><text className="rul-network-dimension" x={width / 2} y="81" textAnchor="middle">μ ± 1.645σ</text><text className="rul-network-detail" x={width / 2} y="105" textAnchor="middle">90% prediction interval</text><text className="rul-network-detail" x={width / 2} y={height - 12} textAnchor="middle">Mean μ · learned spread σ</text></>)}
  </svg>;
}

function Architecture({ bundle }) {
  return <section className="rul-architecture"><div className="rul-section-heading"><Network size={17} aria-hidden="true" /><h2>One history. A distribution of remaining life.</h2></div><p>Four signal channels pass through two bidirectional LSTM layers. Separate heads estimate the mean and log variance from shared dense features.</p><figure className="rul-network-figure"><RULNetworkDiagram bundle={bundle} /><RULNetworkDiagram bundle={bundle} vertical /><figcaption>Forward and reverse features concatenate at each time step. The source reads the final aligned step, then shares one dense representation between the two scalar heads. Paths are schematic; dimensions follow the loaded weights.</figcaption></figure><div className="rul-equation"><span>90% prediction interval</span><strong>μ ± 1.645σ</strong><small>σ is learned from the data · no retraining in this page</small></div></section>;
}

function Method({ bundle }) {
  const meta = bundle.metadata || {}, metrics = meta.metrics || {};
  return <details className="rul-method"><summary><CircleHelp size={16} /><span>Data, training & what the interval means</span><small>Source and reproduced results</small></summary><div className="rul-method-body"><section><h3>The recorded example</h3><p>Adapted from Xinze Li’s IGBT maintenance case study. The model uses one A17 accelerated-aging recording: 200 samples of node 1 voltage, node 2 voltage, collector-emitter current and package temperature.</p><p>The target counts detected cycles remaining until the recording ends. It is a recording-end proxy; no hours, calendar lifetime or whole-converter lifetime are inferred.</p><p>Window selection follows current minima after sample 1600. Detecting a minimum uses seven future samples. These are offline examples, rather than a live fault-protection system.</p></section><section><h3>The reproduced model</h3><p>Inputs and targets are standardized using training data only. The source architecture and Gaussian negative log-likelihood are retained, using a fixed initialization selected by validation loss from five recorded seeds. The best validation checkpoint is saved with a deep copy, correcting the source notebook’s checkpoint aliasing.</p><dl><div><dt>Train / validation / test</dt><dd>818 / 176 / 176 windows</dd></div><div><dt>Mean absolute error</dt><dd>{fmt(metrics.testMaeCycles, 2)} cycles</dd></div><div><dt>90% interval coverage</dt><dd>{Number.isFinite(metrics.testCoverage90) ? `${fmt((metrics.testCoverage90) * 100, 2)}%` : '—'}</dd></div></dl><p>These are new held-out results. Historical notebook results: MAE 81.61 cycles and interval coverage 93.18%.</p></section><section><h3>Interpreting uncertainty</h3><p>The shaded interval is a 90% Gaussian prediction interval for individual RUL outcomes, not a confidence interval for the mean. Nominal 90% coverage is a model assumption; held-out coverage is reported separately.</p><p>Windows overlap and come from the same device. The random window split does not establish generalization to unseen IGBTs. Gaussian bounds are shown without clipping and may extend below zero.</p><p>Signal plots use source values and sample indices. No unverified channel-unit or sample-time conversion is applied.</p></section><div className="rul-source-links"><p>Source: Xinze Li · <cite>Fundamentals of AI for Power Electronics</cite> · commit <code>0587acf</code>. Adapted code: Apache-2.0; source educational content: CC BY-NC 4.0. Modifications and artifacts are documented with the reproduced model.</p><a href={SOURCE} target="_blank" rel="noreferrer">Case study <ExternalLink size={12} /></a><a href={meta.source?.notebookUrl || `${SOURCE.replace('/tree/', '/blob/')}/rul_prediction.ipynb`} target="_blank" rel="noreferrer">Source notebook <ExternalLink size={12} /></a><a href={sitePath('models/rul-nn/provenance.json')} target="_blank" rel="noreferrer">Reproduction record <ExternalLink size={12} /></a></div></div></details>;
}

export default function RULLab({ onBack }) {
  const heading = useRef(null), [bundle, setBundle] = useState(null), [loadError, setLoadError] = useState(''), [attempt, setAttempt] = useState(0);
  const [examples, setExamples] = useState([]), [selectedId, setSelectedId] = useState(null), [channel, setChannel] = useState(2), [isPending, startTransition] = useTransition();
  useEffect(() => { heading.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const controller = new AbortController(); let current = true;
    setBundle(null); setLoadError(''); setExamples([]); setSelectedId(null);
    loadRULNN({ signal: controller.signal }).then(data => {
      if (!current) return;
      const choices = sampleRULCases(data, 3); setBundle(data); setExamples(choices); setSelectedId(choices[0].id);
    }).catch(error => { if (current && error.name !== 'AbortError') setLoadError('The trained RUL model or recorded examples could not be loaded. Retry to load the local assets again.'); });
    return () => { current = false; controller.abort(); };
  }, [attempt]);
  const result = useMemo(() => {
    if (!bundle || !examples.length) return { rows: [] };
    try { return { rows: examples.map(sample => ({ sample, prediction: predictRUL(bundle, sample, .9) })) }; }
    catch { return { rows: [], error: true }; }
  }, [bundle, examples]);
  const selected = result.rows.find(row => row.sample.id === selectedId) || result.rows[0];
  const channelRange = useMemo(() => examples.length ? range(examples.flatMap(sample => sample.window.map(row => row[channel]))) : [0, 1], [examples, channel]);
  const rulRange = useMemo(() => [Math.min(0, ...result.rows.map(row => row.prediction.lower)), Math.max(bundle?.normalizationCycles || 1169, ...result.rows.map(row => row.prediction.upper))], [bundle, result.rows]);
  const distributionRange = useMemo(() => [Math.min(0, ...result.rows.map(row => row.prediction.mean - 3.4 * row.prediction.std)), Math.max(bundle?.normalizationCycles || 1169, ...result.rows.map(row => row.prediction.mean + 3.4 * row.prediction.std))], [bundle, result.rows]);
  function shuffle() {
    const previous = new Set(examples.map(sample => sample.id));
    let choices;
    for (let i = 0; i < 20; i++) { choices = sampleRULCases(bundle, 3); if (choices.every(sample => !previous.has(sample.id))) break; }
    startTransition(() => { setExamples(choices); setSelectedId(choices[0].id); });
  }
  const failed = loadError || result.error;
  return <main className="rul-lab" data-rul-lab="true"><header className="rul-topbar"><a href={pageUrl('maintenance')} className="rul-back" onClick={event => { if (onBack && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); onBack(); } }}><ArrowLeft size={16} />Back to Maintenance</a><div className="lab-header-actions"><a href={SOURCE} target="_blank" rel="noreferrer">IGBT maintenance case study <ArrowUpRight size={14} /></a><ModelRepositoryLink /></div></header><div className="rul-content"><section className="rul-heading"><div><p className="rul-eyebrow"><Network size={14} />MAINTENANCE / RUL PLAYGROUND</p><h1 ref={heading} tabIndex={-1}>How much life remains?</h1><p>Recorded waveforms. A predicted mean. An interval of uncertainty.</p></div><div className="rul-source-badge"><span>IGBT accelerated aging</span><strong>BiLSTM · Gaussian output</strong><small>200 samples × 4 signal channels</small></div></section><div className="rul-context-note"><Network size={19} /><p><strong>A component-level research example.</strong> This model estimates cycles remaining until the end of one IGBT recording. It is a companion to the converter’s illustrative maintenance story. Percentages use 1,169 detected cycles, the maximum ground-truth target from the recording, as the fixed 100% reference.</p></div>
    {failed ? <section className="rul-load-state" role="alert"><CircleHelp size={28} /><h2>RUL model unavailable</h2><p>{loadError || 'The recorded input could not be evaluated by the trained model.'}</p><button onClick={() => setAttempt(value => value + 1)}>Retry loading</button></section> : !selected ? <section className="rul-load-state" role="status"><Network size={28} /><h2>Loading recorded examples</h2><p>Fixed network weights and held-out waveform windows.</p></section> : <>
      <section className="rul-examples-section" aria-label="Random waveform examples"><div className="rul-examples-heading"><div><span className="rul-section-index">01 / OBSERVE & PREDICT</span><h2>Three randomly selected RUL studies</h2><p>Randomly sampled from {bundle.cases.length} held-out windows. Select one to inspect all four signals.</p></div><button className="rul-shuffle" onClick={shuffle} disabled={isPending}><Shuffle size={15} />{isPending ? 'Predicting…' : 'New random examples'}</button></div><label className="rul-channel-control">Preview signal<select value={channel} onChange={event => setChannel(Number(event.target.value))}>{FEATURES.map((feature, i) => <option value={i} key={feature.field}>{feature.name}</option>)}</select><small>Shared waveform and RUL scales across the three examples</small></label><div className="rul-example-grid" aria-busy={isPending}>{result.rows.map(({ sample, prediction }, i) => <button className={`rul-example-card ${sample.id === selected.sample.id ? 'rul-example-selected' : ''}`} key={sample.id} aria-pressed={sample.id === selected.sample.id} aria-label={`Inspect example ${i + 1}, ${sample.id}, mean ${percent(prediction.mean, bundle.normalizationCycles)} percent (${fmt(prediction.mean)} cycles), 90% prediction interval ${percent(prediction.lower, bundle.normalizationCycles)} to ${percent(prediction.upper, bundle.normalizationCycles)} percent (${fmt(prediction.lower)} to ${fmt(prediction.upper)} cycles)`} onClick={() => setSelectedId(sample.id)}><div className="rul-card-heading"><span>EXAMPLE {String(i + 1).padStart(2, '0')}</span><small>{sample.id}</small>{sample.id === selected.sample.id ? <Check size={15} /> : null}</div><Waveform sample={sample} channel={channel} compact limits={channelRange} /><div className="rul-card-result"><span>Predicted mean RUL</span><strong>{percent(prediction.mean, bundle.normalizationCycles)}%<small>({fmt(prediction.mean)} cycles)</small></strong><p><i />90% prediction interval</p><b>{percent(prediction.lower, bundle.normalizationCycles)}% – {percent(prediction.upper, bundle.normalizationCycles)}%<small> ({fmt(prediction.lower)} – {fmt(prediction.upper)} cycles)</small></b></div><IntervalBar prediction={prediction} target={sample.target} limits={rulRange} /><div className="rul-card-reference"><span>Ground-truth target</span><strong>{percent(sample.target, bundle.normalizationCycles)}% ({fmt(sample.target, 0)} cycles)</strong></div><span className="rul-card-inspect">{sample.id === selected.sample.id ? 'Inspecting this example' : 'Inspect signals & uncertainty'}<ChevronRight size={13} /></span></button>)}</div></section>
      <section className="rul-inspection" aria-label="Selected waveform and RUL prediction"><div className="rul-inspection-heading"><div><span className="rul-section-index">02 / INSPECT THE ESTIMATE</span><h2>{selected.sample.id}<small>Held-out window {selected.sample.windowIndex}</small></h2></div><p>All four channels enter the model.<br />Preview-channel selection only changes the plot.</p></div><div className="rul-detail-grid"><section className="rul-signal-panel"><div className="rul-panel-title"><h3>The recorded input</h3><span>200 × 4 · source values</span></div><div className="rul-signals-grid">{FEATURES.map((feature, i) => <figure key={feature.field}><figcaption><i style={{ background: feature.color }} /><strong>{feature.name}</strong><small>{feature.field}</small></figcaption><Waveform sample={selected.sample} channel={i} /></figure>)}</div><p className="rul-signal-note">Raw recording samples {selected.sample.startSample}–{selected.sample.endSample}. Only the selected history window enters the network; the displayed target is used for comparison.</p></section><section className="rul-uncertainty-panel" aria-label="Selected RUL uncertainty"><div className="rul-panel-title"><h3>The predicted distribution</h3><span>Shared RUL axis · Gaussian estimate</span></div><div className="rul-selected-metrics" aria-live="polite" aria-atomic="true"><div><span>Mean RUL</span><strong>{percent(selected.prediction.mean, bundle.normalizationCycles)}%<small>({fmt(selected.prediction.mean)} cycles)</small></strong></div><div><span>90% prediction interval</span><strong>{percent(selected.prediction.lower, bundle.normalizationCycles)}% – {percent(selected.prediction.upper, bundle.normalizationCycles)}%<small>({fmt(selected.prediction.lower)} – {fmt(selected.prediction.upper)} cycles)</small></strong></div></div><Distribution prediction={selected.prediction} target={selected.sample.target} limits={distributionRange} /><div className="rul-distribution-key"><span><i />Predicted mean + 90% band</span><span><i />Ground-truth target</span></div><dl className="rul-selected-comparison"><div><dt>Ground-truth target</dt><dd>{percent(selected.sample.target, bundle.normalizationCycles)}% ({fmt(selected.sample.target, 0)} cycles)</dd></div><div><dt>Prediction − target</dt><dd>{selected.prediction.mean >= selected.sample.target ? '+' : ''}{fmt(selected.prediction.mean - selected.sample.target)} cycles</dd></div><div><dt>Target within interval</dt><dd>{selected.sample.target >= selected.prediction.lower && selected.sample.target <= selected.prediction.upper ? 'Yes' : 'No'}</dd></div></dl><p className="rul-interval-note">The band expresses uncertainty in an individual RUL outcome. It is not a confidence interval for the mean.{selected.prediction.lower < 0 ? ' The Gaussian lower bound extends below zero and is shown unmodified.' : ''}</p></section></div></section>
      <Architecture bundle={bundle} /><Method bundle={bundle} />
    </>}
    <footer className="rul-footer"><span>Recorded data → recurrent neural network → mean + uncertainty</span><a href={SOURCE} target="_blank" rel="noreferrer">View source study <ExternalLink size={12} /></a><ProjectCredit /></footer></div></main>;
}
