import { forwardRef, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, RotateCcw } from 'lucide-react';
import { MAINTENANCE_DETAILS, MAINTENANCE_GROUPS, MAINTENANCE_NOTICE } from './converterMaintenanceData';
import { MaintenanceFault, MaintenanceHealth, MaintenanceRul, MaintenanceSignals } from './MaintenanceCharts';
import { RUL_LAB_URL } from './controlLabNavigation';
import './converter-design.css';
import './converter-maintenance.css';

const HEADS = [
  { id: 'rul', label: 'Remaining useful life', Chart: MaintenanceRul },
  { id: 'fault', label: 'Open / short-circuit diagnosis', Chart: MaintenanceFault },
  { id: 'health', label: 'Predicted health indicators', Chart: MaintenanceHealth },
];
const GROUPS = Object.fromEntries(MAINTENANCE_GROUPS.map(group => [group.id, group]));
const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function SharedNetwork({ ports, output }) {
  const inputs = [28, 72], hidden = [12, 37, 62, 87];
  return <svg className="maintenance-neural-graph" viewBox="0 0 126 100" role="img" aria-label="Illustrative shared neural representation of waveform windows and operating context">
    <g className="maintenance-neural-edges">{inputs.flatMap((y, i) => hidden.map((next, j) => <line key={`${i}-${j}`} x1="16" y1={y} x2="63" y2={next} />))}{hidden.map(y => <line key={`output-${y}`} x1="63" y1={y} x2="110" y2="50" />)}</g>
    {inputs.map((y, index) => <circle key={y} ref={element => { if (element) ports.current[index === 0 ? 'signals' : 'history'] = element; }} cx="16" cy={y} r="4.5" className="maintenance-network-input" />)}
    {hidden.map(y => <circle key={y} cx="63" cy={y} r="4.1" className="maintenance-network-hidden" />)}<circle ref={output} cx="110" cy="50" r="4.6" className="maintenance-network-output" />
  </svg>;
}
function edge(rect, side, origin) {
  return { x: (side === 'left' ? rect.left : side === 'right' ? rect.right : rect.left + rect.width / 2) - origin.left, y: (side === 'top' ? rect.top : side === 'bottom' ? rect.bottom : rect.top + rect.height / 2) - origin.top };
}
function curve(start, end) {
  const bend = Math.max(10, Math.abs(end.x - start.x) * .5);
  return `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}`;
}

export const ConverterMaintenanceOverview = forwardRef(function ConverterMaintenanceOverview({ onClose, onResetView, selectedPart, onAssessmentChange, onOpenNNLab, active = true }, ref) {
  const root = useRef(null), heading = useRef(null), workflow = useRef(null), footer = useRef(null), layer = useRef(null), back = useRef(null);
  const signals = useRef(null), history = useRef(null), nn = useRef(null), sharedOutput = useRef(null), assessmentCard = useRef(null);
  const signalPorts = useRef({}), nnPorts = useRef({}), heads = useRef({}), paths = useRef({}), wires = useRef({}), dots = useRef({}), sensors = useRef({}), polarity = useRef({});
  const anchors = useRef({}), draw = useRef(() => {}), schedule = useRef(() => {}), assessment = useRef(onAssessmentChange);
  assessment.current = onAssessmentChange;
  const [phase, setPhase] = useState(() => reducedMotion() ? 3 : 0);
  const [replay, setReplay] = useState(0);
  const revealClock = useRef({ elapsed: 0, replay: 0 });
  const instance = useId().replace(/[^a-zA-Z0-9_-]/g, '');

  useImperativeHandle(ref, () => ({ setAnchors(next) { anchors.current = next || {}; draw.current(); } }), []);

  useEffect(() => {
    if (revealClock.current.replay !== replay) revealClock.current = { elapsed: 0, replay };
    if (!active) return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    let timers = [];
    const started = performance.now();
    const elapsed = revealClock.current.elapsed;
    const clear = () => { timers.forEach(timer => clearTimeout(timer)); timers = []; };
    const finish = () => { clear(); revealClock.current.elapsed = 2400; setPhase(3); assessment.current?.(true); };
    if (media.matches) finish();
    else {
      setPhase(elapsed >= 2400 ? 3 : elapsed >= 1400 ? 2 : elapsed >= 700 ? 1 : 0); assessment.current?.(elapsed >= 2400);
      if (elapsed < 700) timers.push(setTimeout(() => setPhase(1), 700 - elapsed));
      if (elapsed < 1400) timers.push(setTimeout(() => setPhase(2), 1400 - elapsed));
      if (elapsed < 2400) timers.push(setTimeout(finish, 2400 - elapsed));
    }
    const change = event => { if (event.matches) finish(); };
    media.addEventListener('change', change);
    return () => { revealClock.current.elapsed = Math.min(2400, Math.max(revealClock.current.elapsed, elapsed + performance.now() - started)); clear(); media.removeEventListener('change', change); };
  }, [replay, active]);
  useEffect(() => () => assessment.current?.(false), []);

  useLayoutEffect(() => {
    if (!active) return;
    const main = root.current.closest('.explorer'), stage = main?.querySelector('.hardware-stage'), host = stage?.querySelector('.webgl-host');
    if (!main || !stage || !host) return;
    let frame = null, disposed = false;
    function drawConnections() {
      if (disposed || !layer.current) return;
      const svg = layer.current, origin = svg.getBoundingClientRect(), hostRect = host.getBoundingClientRect();
      const mobile = window.matchMedia('(max-width: 1000px)').matches;
      const width = Math.max(1, main.clientWidth), height = Math.max(main.clientHeight, Math.ceil(Math.max(...[heading.current, workflow.current, footer.current, stage].map(element => element.getBoundingClientRect().bottom - origin.top))));
      const viewBox = `0 0 ${width} ${height}`;
      if (svg.getAttribute('viewBox') !== viewBox) { svg.setAttribute('viewBox', viewBox); svg.style.width = `${width}px`; svg.style.height = `${height}px`; }
      const projected = {}, flowRect = workflow.current.getBoundingClientRect();
      for (const group of MAINTENANCE_GROUPS) {
        const anchor = anchors.current[group.id], portRect = signalPorts.current[group.id]?.getBoundingClientRect();
        const clipped = !mobile && portRect && (portRect.bottom < flowRect.top || portRect.top > flowRect.bottom);
        const visible = !!(anchor?.visible && Number.isFinite(anchor.u) && Number.isFinite(anchor.v) && portRect && !clipped && hostRect.width && hostRect.height);
        for (const element of [wires.current[group.id], dots.current[group.id], sensors.current[group.id], polarity.current[group.id]]) element.setAttribute('visibility', visible ? 'visible' : 'hidden');
        if (!visible) continue;
        const source = { x: hostRect.left + anchor.u * hostRect.width - origin.left, y: hostRect.top + anchor.v * hostRect.height - origin.top };
        projected[group.id] = source;
        dots.current[group.id].setAttribute('cx', source.x); dots.current[group.id].setAttribute('cy', source.y);
        // The current leader now starts on the projected 3D coil itself.
        const marker = group.id === 'voltage' ? { x: source.x - 19, y: source.y - 22 } : source;
        sensors.current[group.id].setAttribute('transform', `translate(${marker.x} ${marker.y})`);
        const target = { x: portRect.left + portRect.width / 2 - origin.left, y: portRect.top + portRect.height / 2 - origin.top }, bend = Math.max(28, Math.abs(target.x - marker.x) * .35);
        const path = mobile
          ? `M ${source.x} ${source.y} L ${marker.x} ${marker.y} C ${marker.x} ${marker.y + Math.max(30, (target.y - marker.y) * .35)}, ${target.x - 24} ${target.y}, ${target.x} ${target.y}`
          : `M ${source.x} ${source.y} L ${marker.x} ${marker.y} C ${marker.x + bend} ${marker.y}, ${target.x - Math.min(40, bend)} ${target.y}, ${target.x} ${target.y}`;
        wires.current[group.id].setAttribute('d', path); wires.current[group.id].dataset.partId = anchor.partId;
      }
      for (const id of ['voltage', 'current']) {
        const point = projected[id]; if (!point) continue;
        const other = projected[id === 'voltage' ? 'current' : 'voltage'];
        const dx = other ? point.x - other.x : id === 'voltage' ? -1 : 1, dy = other ? point.y - other.y : 0, length = Math.max(1, Math.hypot(dx, dy));
        polarity.current[id].setAttribute('x', point.x + dx / length * 11); polarity.current[id].setAttribute('y', point.y + dy / length * 11 + 4);
      }
      const nnRect = nn.current.getBoundingClientRect(), signalStart = edge(signals.current.getBoundingClientRect(), 'right', origin), historyStart = edge(history.current.getBoundingClientRect(), 'right', origin);
      const signalTarget = edge(nnPorts.current.signals.getBoundingClientRect(), 'left', origin), historyTarget = edge(nnPorts.current.history.getBoundingClientRect(), 'left', origin);
      if (mobile) {
        const observationRect = signals.current.closest('.maintenance-observation-card').getBoundingClientRect();
        const rightRail = observationRect.right - origin.left + 5, gapY = observationRect.bottom - origin.top + 6, leftRail = nnRect.left - origin.left + 8;
        paths.current.signals.setAttribute('d', `M ${signalStart.x} ${signalStart.y} L ${rightRail} ${signalStart.y} L ${rightRail} ${gapY} L ${leftRail} ${gapY} L ${leftRail} ${signalTarget.y} L ${signalTarget.x} ${signalTarget.y}`);
        paths.current.history.setAttribute('d', `M ${historyStart.x} ${historyStart.y} L ${rightRail + 5} ${historyStart.y} L ${rightRail + 5} ${gapY + 6} L ${leftRail + 8} ${gapY + 6} L ${leftRail + 8} ${historyTarget.y} L ${historyTarget.x} ${historyTarget.y}`);
      } else {
        paths.current.signals.setAttribute('d', curve(signalStart, signalTarget));
        paths.current.history.setAttribute('d', curve(historyStart, historyTarget));
      }
      const source = edge(sharedOutput.current.getBoundingClientRect(), 'right', origin), resultRect = assessmentCard.current.getBoundingClientRect();
      const headRects = HEADS.map(head => heads.current[head.id].getBoundingClientRect());
      if (mobile) {
        const leftRail = flowRect.left - origin.left + 5, rightRail = width - 5;
        const forkY = nnRect.bottom - origin.top + 10, lastY = edge(headRects.at(-1), 'left', origin).y;
        paths.current.fanout.setAttribute('d', `M ${source.x} ${source.y} C ${rightRail} ${source.y}, ${rightRail} ${forkY}, ${rightRail} ${forkY} L ${leftRail} ${forkY} L ${leftRail} ${lastY}`);
        HEADS.forEach((head, index) => {
          const input = edge(headRects[index], 'left', origin), output = edge(headRects[index], 'right', origin);
          paths.current[`in-${head.id}`].setAttribute('d', `M ${leftRail} ${input.y} L ${input.x} ${input.y}`);
          paths.current[`out-${head.id}`].setAttribute('d', `M ${output.x} ${output.y} L ${rightRail} ${output.y}`);
        });
        const target = edge(resultRect, 'top', origin), mergeY = target.y - 9, firstY = edge(headRects[0], 'right', origin).y;
        paths.current.merge.setAttribute('d', `M ${rightRail} ${firstY} L ${rightRail} ${mergeY} L ${target.x} ${mergeY} L ${target.x} ${target.y}`);
      } else {
        const inputs = headRects.map(rect => edge(rect, 'top', origin)), outputs = headRects.map(rect => edge(rect, 'bottom', origin));
        const forkY = Math.min(...inputs.map(point => point.y)) - 9, outside = nnRect.right - origin.left + 6;
        paths.current.fanout.setAttribute('d', `M ${source.x} ${source.y} C ${outside} ${source.y}, ${outside} ${forkY}, ${outside} ${forkY} L ${inputs[0].x} ${forkY}`);
        const target = edge(resultRect, 'top', origin), mergeY = Math.max(...outputs.map(point => point.y)) + 9;
        HEADS.forEach((head, index) => {
          paths.current[`in-${head.id}`].setAttribute('d', `M ${inputs[index].x} ${forkY} L ${inputs[index].x} ${inputs[index].y}`);
          paths.current[`out-${head.id}`].setAttribute('d', `M ${outputs[index].x} ${outputs[index].y} L ${outputs[index].x} ${mergeY}`);
        });
        paths.current.merge.setAttribute('d', `M ${outputs[0].x} ${mergeY} L ${outputs.at(-1).x} ${mergeY} M ${target.x} ${mergeY} L ${target.x} ${target.y}`);
      }
      svg.dataset.visibleGroups = Object.keys(projected).join(' '); svg.dataset.ready = 'ready';
    }
    function scheduleDraw() { if (disposed || frame !== null) return; frame = requestAnimationFrame(() => { frame = null; drawConnections(); }); }
    draw.current = drawConnections; schedule.current = scheduleDraw;
    const observer = new ResizeObserver(scheduleDraw);
    for (const element of [main, stage, heading.current, workflow.current, footer.current, signals.current, history.current, nn.current, assessmentCard.current, ...Object.values(heads.current)]) observer.observe(element);
    window.addEventListener('resize', scheduleDraw, { passive: true }); window.addEventListener('scroll', scheduleDraw, { passive: true, capture: true });
    scheduleDraw(); back.current?.focus({ preventScroll: true });
    return () => { disposed = true; if (frame !== null) cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', scheduleDraw); window.removeEventListener('scroll', scheduleDraw, true); draw.current = () => {}; schedule.current = () => {}; };
  }, [active]);

  function replaySequence() { assessment.current?.(false); setPhase(0); setReplay(value => value + 1); }

  return <section ref={root} className="converter-maintenance-overview" aria-label="AI for converter maintenance" data-maintenance-overview="true" data-phase={phase} data-assessed={phase === 3 ? 'true' : 'false'}>
    <header ref={heading} className="converter-design-heading converter-maintenance-heading"><div><h1>AI for converter maintenance</h1><p>Observe signals. Assess condition. Plan service.</p></div><div className="converter-design-actions"><button ref={back} onClick={onClose} aria-label="Back to explorer" title="Back to explorer"><ArrowLeft size={16} /><span>Back to explorer</span></button><button onClick={onResetView} aria-label="Reset hardware view" title="Reset hardware view"><RotateCcw size={15} /><span>Reset view</span></button></div></header>

    <div className="converter-design-hardware-overlay converter-maintenance-hardware-overlay"><div className="converter-design-hardware-top"><strong>In-situ observations · J2</strong><span className="maintenance-sensing-label">Rogowski · AC ripple</span></div><div className="converter-design-legend">{MAINTENANCE_GROUPS.map(group => <span key={group.id}><i style={{ background: group.color }} />{group.label}</span>)}</div><p className="maintenance-scope-label">{phase === 3 ? 'Converter-level maintenance assessment' : 'Observe the converter in operation'}</p><div className="converter-design-hardware-bottom"><span>Drag to orbit · Scroll to zoom</span>{selectedPart ? <span title={`${selectedPart.id} · ${selectedPart.name}`} aria-live="polite"><b>{selectedPart.id}</b> {selectedPart.name}</span> : null}</div></div>

    <aside ref={workflow} className="converter-design-workflow converter-maintenance-workflow" aria-label="Parallel supervisory maintenance outputs">
      <div className="maintenance-input-row"><section className="maintenance-observation-card"><div className="maintenance-observation-heading"><h2>Vout / Iout observations</h2><button onClick={replaySequence} aria-label="Replay maintenance illustration" className="maintenance-replay"><RotateCcw size={12} />Replay</button></div><div ref={signals} className="maintenance-signal-window">{['voltage', 'current'].map(id => <span key={id} ref={element => { signalPorts.current[id] = element; }} className={`maintenance-signal-port maintenance-port-${id}`} style={{ background: GROUPS[id].color }} />)}<MaintenanceSignals phase={phase} /></div><div ref={history} className="maintenance-history-input">Operating history / conditions</div></section><a ref={nn} className="maintenance-network-card maintenance-nn-link" href={RUL_LAB_URL} onClick={onOpenNNLab}><h2>Supervisory maintenance NN</h2><SharedNetwork ports={nnPorts} output={sharedOutput} /><p>One shared representation</p><span className="maintenance-nn-cta">Explore IGBT remaining life <span aria-hidden="true">↗</span></span></a></div>
      <div className="maintenance-parallel-heads" aria-label="Three parallel output heads">{HEADS.map(({ id, label, Chart }) => <section key={id} ref={element => { heads.current[id] = element; }} className={`maintenance-output-head maintenance-head-${id}`} data-head={id}><h3>{label}</h3><div className="maintenance-head-chart"><Chart phase={phase} /></div>{id === 'health' ? <p className="maintenance-health-direction">Higher = more deviation</p> : null}</section>)}</div>
      <section ref={assessmentCard} className="maintenance-assessment-card" data-assessed={phase === 3 ? 'true' : 'false'}><div><h2>Predictive maintenance</h2><p>For the converter</p></div><p className="maintenance-service-path"><span>Inspect degradation trend</span><ArrowRight size={15} aria-hidden="true" /><strong>Plan service</strong></p></section>
    </aside>

    <footer ref={footer} className="converter-design-footer converter-maintenance-footer"><p>{MAINTENANCE_NOTICE} · under assumed use</p><details onToggle={() => schedule.current()}><summary>About the illustration</summary><div tabIndex={0} aria-label="Maintenance illustration details"><p>{MAINTENANCE_DETAILS}</p></div></details></footer>

    <svg ref={layer} className="converter-design-leaders maintenance-leaders" aria-hidden="true" preserveAspectRatio="none"><defs><marker id={`maintenance-${instance}-arrow`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M1 1L7 4L1 7" fill="none" stroke="#789780" strokeWidth="1.2" /></marker></defs>
      <g className="maintenance-sensing-wires">{MAINTENANCE_GROUPS.map(group => <g key={group.id}><path ref={element => { wires.current[group.id] = element; }} data-group={group.id} stroke={group.color} visibility="hidden" /><circle ref={element => { dots.current[group.id] = element; }} r="2.5" fill={group.color} visibility="hidden" /><g ref={element => { sensors.current[group.id] = element; }} className="maintenance-sense-marker" data-sensor={group.id === 'current' ? 'rogowski-3d-leader' : 'voltage'} visibility="hidden">{group.id === 'voltage' ? <><circle r="8.5" fill="white" stroke={group.color} /><text y="4" textAnchor="middle" fill={group.color}>V</text></> : null}</g><text ref={element => { polarity.current[group.id] = element; }} className="maintenance-output-polarity" textAnchor="middle" visibility="hidden">{group.id === 'voltage' ? '+' : ''}</text></g>)}</g>
      <g className="maintenance-network-connections"><path className="maintenance-feed-connection" ref={element => { paths.current.signals = element; }} markerEnd={`url(#maintenance-${instance}-arrow)`} /><path className="maintenance-feed-connection" ref={element => { paths.current.history = element; }} markerEnd={`url(#maintenance-${instance}-arrow)`} /><path className="maintenance-branch-connection" ref={element => { paths.current.fanout = element; }} />{HEADS.map(head => <g key={head.id}><path className="maintenance-branch-connection" ref={element => { paths.current[`in-${head.id}`] = element; }} markerEnd={`url(#maintenance-${instance}-arrow)`} /><path className="maintenance-assessment-connection" ref={element => { paths.current[`out-${head.id}`] = element; }} /></g>)}<path className="maintenance-assessment-connection" ref={element => { paths.current.merge = element; }} markerEnd={`url(#maintenance-${instance}-arrow)`} /></g>
    </svg>
    <p className="maintenance-sr-only">Output voltage and current waveforms plus operating context feed a shared supervisory neural network. A conceptual Rogowski coil senses AC ripple; a separate sensor or estimate is needed for DC current. Three parallel heads estimate remaining useful life, diagnose open or short circuits, and predict health indicators. Their outputs inform one converter maintenance recommendation.</p><p className="maintenance-sr-only" aria-live="polite">{phase === 3 ? 'Illustrative assessment complete: health worsens and remaining useful life shortens with uncertainty. No open or short indication. Inspect the degradation trend and plan service.' : 'Illustrative maintenance observations and outputs are being revealed.'}</p>
  </section>;
});
