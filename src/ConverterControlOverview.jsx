import { forwardRef, useEffect, useId, useImperativeHandle, useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, CircuitBoard, RotateCcw } from 'lucide-react';
import { CONTROL_DETAILS, CONTROL_GROUPS, CONTROL_NOTICE } from './converterControlData';
import { ControlSignals } from './ControlSignals';
import { ControlResponse } from './ControlResponse';
import { LAB_URL } from './controlLabNavigation';
import './converter-design.css';
import './converter-control.css';

const GROUPS = Object.fromEntries(CONTROL_GROUPS.map(group => [group.id, group]));
const PRIMARY = ['voltage', 'current', 'controller'];
const motionReduced = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function ControllerNetwork({ ports }) {
  const input = [22, 50, 78], hidden = [10, 36, 63, 89];
  return <svg className="control-neural-graph" viewBox="0 0 155 100" role="img" aria-label="Illustrative NN controller: output voltage, current and reference inputs produce triple phase shift commands D0, D1 and D2">
    <g className="control-neural-edges">{input.flatMap((y, i) => hidden.map((next, j) => <line key={`${i}-${j}`} x1="33" y1={y} x2="79" y2={next} />))}{hidden.map(y => <line key={`out-${y}`} x1="79" y1={y} x2="125" y2="50" />)}</g>
    <g className="control-network-labels"><text x="1" y="26" fill={GROUPS.voltage.color}>Vout</text><text x="1" y="54" fill={GROUPS.current.color}>Iout</text><text x="1" y="82">Vref</text><text x="132" y="46">D₀</text><text x="132" y="60">D₁,₂</text></g>
    {input.map((y, index) => <circle key={y} ref={element => { if (element && index < 2) ports.current[index === 0 ? 'voltage' : 'current'] = element; }} cx="33" cy={y} r="4.4" fill={index === 0 ? GROUPS.voltage.color : index === 1 ? GROUPS.current.color : '#6d8e75'} className="control-network-input" />)}
    {hidden.map(y => <circle key={y} cx="79" cy={y} r="4.1" className="control-network-hidden" />)}<circle cx="125" cy="50" r="4.5" className="control-network-output" />
  </svg>;
}

function side(rect, edge, origin) {
  return { x: (edge === 'left' ? rect.left : edge === 'right' ? rect.right : rect.left + rect.width / 2) - origin.left, y: (edge === 'top' ? rect.top : edge === 'bottom' ? rect.bottom : rect.top + rect.height / 2) - origin.top };
}
function between(start, end) {
  const bend = Math.max(10, Math.abs(end.x - start.x) * .5);
  return `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}`;
}

export const ConverterControlOverview = forwardRef(function ConverterControlOverview({ onClose, onResetView, selectedPart, onOpenNNLab, active = true }, ref) {
  const root = useRef(null), header = useRef(null), workflow = useRef(null), footer = useRef(null), svg = useRef(null);
  const nn = useRef(null), pwm = useRef(null), card = useRef(null), response = useRef(null), cardPort = useRef(null), back = useRef(null);
  const anchors = useRef({}), ports = useRef({}), wires = useRef({}), dots = useRef({}), sensors = useRef({}), polarity = useRef({}), arrows = useRef({});
  const draw = useRef(() => {}), schedule = useRef(() => {});
  const [phase, setPhase] = useState(() => motionReduced() ? 2 : 0);
  const [revealed, setRevealed] = useState(motionReduced);
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
    const finish = () => { clear(); revealClock.current.elapsed = 2400; setPhase(2); setRevealed(true); };
    if (media.matches) finish();
    else {
      setPhase(elapsed >= 1800 ? 2 : elapsed >= 900 ? 1 : 0); setRevealed(elapsed >= 2400);
      if (elapsed < 900) timers.push(setTimeout(() => setPhase(1), 900 - elapsed));
      if (elapsed < 1800) timers.push(setTimeout(() => setPhase(2), 1800 - elapsed));
      if (elapsed < 2400) timers.push(setTimeout(() => setRevealed(true), 2400 - elapsed));
    }
    const changeMotion = event => { if (event.matches) finish(); };
    media.addEventListener('change', changeMotion);
    return () => { revealClock.current.elapsed = Math.min(2400, Math.max(revealClock.current.elapsed, elapsed + performance.now() - started)); clear(); media.removeEventListener('change', changeMotion); };
  }, [replay, active]);

  useLayoutEffect(() => {
    if (!active) return;
    const main = root.current.closest('.explorer'), stage = main?.querySelector('.hardware-stage'), host = stage?.querySelector('.webgl-host');
    if (!main || !stage || !host) return;
    let frame = null, disposed = false;
    function drawConnections() {
      if (disposed || !svg.current) return;
      const layer = svg.current, origin = layer.getBoundingClientRect(), hostRect = host.getBoundingClientRect();
      const mobile = window.matchMedia('(max-width: 760px)').matches;
      const width = Math.max(1, main.clientWidth);
      const height = Math.max(main.clientHeight, Math.ceil(Math.max(...[header.current, workflow.current, footer.current, stage].map(element => element.getBoundingClientRect().bottom - origin.top))));
      const viewBox = `0 0 ${width} ${height}`;
      if (layer.getAttribute('viewBox') !== viewBox) { layer.setAttribute('viewBox', viewBox); layer.style.width = `${width}px`; layer.style.height = `${height}px`; }
      const projected = {};
      for (const group of CONTROL_GROUPS) {
        const anchor = anchors.current[group.id];
        const visible = !!(anchor?.visible && Number.isFinite(anchor.u) && Number.isFinite(anchor.v) && hostRect.width && hostRect.height);
        dots.current[group.id].setAttribute('visibility', visible ? 'visible' : 'hidden');
        if (!visible) continue;
        const point = { x: hostRect.left + anchor.u * hostRect.width - origin.left, y: hostRect.top + anchor.v * hostRect.height - origin.top };
        projected[group.id] = point;
        dots.current[group.id].setAttribute('cx', point.x); dots.current[group.id].setAttribute('cy', point.y);
      }
      const flowRect = workflow.current.getBoundingClientRect();
      const stageBottom = stage.getBoundingClientRect().bottom - origin.top;
      for (const id of ['voltage', 'current']) {
        const source = projected[id], targetRect = ports.current[id]?.getBoundingClientRect();
        const clipped = !mobile && targetRect && (targetRect.bottom < flowRect.top || targetRect.top > flowRect.bottom);
        const visible = !!(source && targetRect && !clipped);
        wires.current[id].setAttribute('visibility', visible ? 'visible' : 'hidden');
        sensors.current[id].setAttribute('visibility', visible ? 'visible' : 'hidden');
        polarity.current[id].setAttribute('visibility', visible ? 'visible' : 'hidden');
        if (!visible) continue;
        // The current leader now starts on the projected 3D coil itself.
        const marker = id === 'voltage' ? { x: source.x - 19, y: source.y - 22 } : source;
        sensors.current[id].setAttribute('transform', `translate(${marker.x} ${marker.y})`);
        const target = { x: targetRect.left + targetRect.width / 2 - origin.left, y: targetRect.top + targetRect.height / 2 - origin.top };
        const bend = Math.max(28, Math.abs(target.x - marker.x) * .35);
        const gutter = id === 'voltage' ? 5 : 10;
        const exitY = stageBottom - (id === 'voltage' ? 7 : 2);
        const path = mobile
          ? `M ${source.x} ${source.y} L ${marker.x} ${marker.y} C ${marker.x} ${exitY}, ${gutter} ${exitY - 24}, ${gutter} ${exitY} L ${gutter} ${target.y - 12} Q ${gutter} ${target.y}, ${target.x} ${target.y}`
          : `M ${source.x} ${source.y} L ${marker.x} ${marker.y} C ${marker.x + bend} ${marker.y}, ${target.x - Math.min(42, bend)} ${target.y}, ${target.x} ${target.y}`;
        wires.current[id].setAttribute('d', path); wires.current[id].dataset.partId = anchors.current[id].partId;
        const other = projected[id === 'voltage' ? 'current' : 'voltage'];
        const dx = other ? source.x - other.x : id === 'voltage' ? -1 : 1, dy = other ? source.y - other.y : 0;
        const length = Math.max(1, Math.hypot(dx, dy));
        polarity.current[id].setAttribute('x', source.x + dx / length * 11);
        polarity.current[id].setAttribute('y', source.y + dy / length * 11 + 4);
      }
      const nnRect = nn.current.getBoundingClientRect(), pwmRect = pwm.current.getBoundingClientRect(), cardRect = card.current.getBoundingClientRect();
      const cardTarget = projected.controller;
      wires.current.controller.setAttribute('visibility', cardTarget ? 'visible' : 'hidden');
      if (cardTarget) {
        const source = side(cardRect, mobile ? 'right' : 'bottom', origin);
        const railY = Math.max(nnRect.bottom, pwmRect.bottom, cardRect.bottom) - origin.top + 8;
        const edgeX = flowRect.left - origin.left - 8;
        const outerRail = width - 5;
        const path = mobile
          ? `M ${source.x} ${source.y} L ${outerRail} ${source.y} L ${outerRail} ${cardTarget.y + 15} C ${outerRail} ${cardTarget.y}, ${cardTarget.x + 28} ${cardTarget.y}, ${cardTarget.x} ${cardTarget.y}`
          : `M ${source.x} ${source.y} L ${source.x} ${railY} L ${edgeX} ${railY} C ${edgeX - 35} ${railY}, ${cardTarget.x + 55} ${cardTarget.y}, ${cardTarget.x} ${cardTarget.y}`;
        wires.current.controller.setAttribute('d', path); wires.current.controller.dataset.partId = anchors.current.controller.partId;
      }
      arrows.current.nnPwm.setAttribute('d', between(side(nnRect, 'right', origin), side(pwmRect, 'left', origin)));
      const start = side(pwmRect, mobile ? 'bottom' : 'right', origin), end = side(cardRect, mobile ? 'top' : 'left', origin);
      arrows.current.pwmCard.setAttribute('d', mobile ? `M ${start.x} ${start.y} C ${start.x} ${start.y + 12}, ${end.x} ${end.y - 12}, ${end.x} ${end.y}` : between(start, end));
      layer.dataset.visibleGroups = Object.keys(projected).join(' ');
      layer.dataset.visibleLeaders = PRIMARY.filter(id => wires.current[id].getAttribute('visibility') === 'visible').join(' ');
      layer.dataset.ready = 'ready';
    }
    function scheduleDraw() { if (disposed || frame !== null) return; frame = requestAnimationFrame(() => { frame = null; drawConnections(); }); }
    draw.current = drawConnections; schedule.current = scheduleDraw;
    const observer = new ResizeObserver(scheduleDraw);
    for (const element of [main, stage, header.current, workflow.current, footer.current, nn.current, pwm.current, card.current, response.current]) observer.observe(element);
    window.addEventListener('resize', scheduleDraw, { passive: true });
    window.addEventListener('scroll', scheduleDraw, { passive: true, capture: true });
    scheduleDraw();
    if (!root.current.dataset.hasFocused) { back.current?.focus({ preventScroll: true }); root.current.dataset.hasFocused = 'true'; }
    return () => { disposed = true; if (frame !== null) cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', scheduleDraw); window.removeEventListener('scroll', scheduleDraw, true); draw.current = () => {}; schedule.current = () => {}; };
  }, [active]);

  return <section ref={root} className="converter-control-overview" aria-label="AI for converter control" data-control-overview="true" data-phase={phase} data-revealed={revealed ? 'true' : 'false'}>
    <header ref={header} className="converter-design-heading converter-control-heading"><div><h1>AI for converter control</h1><p>Sense the output. Adjust phase shifts. Regulate voltage.</p></div><div className="converter-design-actions"><button ref={back} onClick={onClose} aria-label="Back to explorer" title="Back to explorer"><ArrowLeft size={16} /><span>Back to explorer</span></button><button onClick={onResetView} aria-label="Reset hardware view" title="Reset hardware view"><RotateCcw size={15} /><span>Reset view</span></button></div></header>

    <div className="converter-design-hardware-overlay converter-control-hardware-overlay"><div className="converter-design-hardware-top"><strong>Forward operation · output J2</strong><span className="control-sensing-label">Rogowski · AC ripple</span></div><div className="converter-design-legend">{PRIMARY.map(id => <span key={id}><i style={{ background: GROUPS[id].color }} />{GROUPS[id].label}</span>)}</div><div className="control-actuation-rail">CTRL1 <span>→</span> gate drivers <span>→</span> bridges <span>→</span> J2</div><div className="converter-design-hardware-bottom"><span>Drag to orbit · Scroll to zoom</span>{selectedPart ? <span title={`${selectedPart.id} · ${selectedPart.name}`} aria-live="polite"><b>{selectedPart.id}</b> {selectedPart.name}</span> : null}</div></div>

    <aside ref={workflow} className="converter-design-workflow converter-control-workflow" aria-label="NN-based converter control loop"><div className="control-workflow-caption"><h2>NN controller + triple phase shift modulation</h2><button className="control-replay" onClick={() => setReplay(value => value + 1)} aria-label="Replay control illustration" title="Replay the brief illustration"><RotateCcw size={12} />Replay</button></div>
      <div className="control-flow-nodes">
        <a ref={nn} className="control-flow-node control-nn-node control-nn-link nn-interactive-card" href={LAB_URL} onClick={onOpenNNLab}><h3>NN-based controller</h3><ControllerNetwork ports={ports} /><p>Illustrative example</p><span className="control-nn-cta nn-interactive-cta">Explore a DAB modulation example <span aria-hidden="true">→</span></span></a>
        <section ref={pwm} className="control-flow-node control-pwm-node"><h3>Triple phase shift modulation</h3><div className="control-signal-sketch"><ControlSignals phase={phase} /></div><small>Bridge voltages v<sub>p</sub> and v<sub>s</sub></small></section>
        <section ref={card} className="control-flow-node control-card-node"><h3>NN Deployment</h3><CircuitBoard className="control-card-symbol" size={47} aria-hidden="true" /><p>Neural networks deploy on this control card.</p><span ref={cardPort} className="control-card-callout" aria-hidden="true" /></section>
      </div>
      <section ref={response} className="converter-control-response" aria-label="Illustrative load-step response"><h3>{CONTROL_NOTICE}</h3><ControlResponse revealed={revealed} /></section>
    </aside>

    <footer ref={footer} className="converter-design-footer converter-control-footer"><p>{CONTROL_NOTICE}</p><details onToggle={() => schedule.current()}><summary>About the illustration</summary><div tabIndex={0} aria-label="Control illustration details"><p>{CONTROL_DETAILS}</p></div></details></footer>

    <svg ref={svg} className="converter-design-leaders converter-control-leaders" aria-hidden="true" preserveAspectRatio="none"><defs>{PRIMARY.map(id => <marker key={id} id={`control-${instance}-${id}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M1 1L7 4L1 7" fill="none" stroke={GROUPS[id].color} strokeWidth="1.2" /></marker>)}<marker id={`control-${instance}-flow`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M1 1L7 4L1 7" fill="none" stroke="#6b8a77" strokeWidth="1.2" /></marker></defs>
      <g className="control-feedback-wires">{PRIMARY.map(id => <path key={id} ref={element => { wires.current[id] = element; }} data-group={id} stroke={GROUPS[id].color} markerEnd={`url(#control-${instance}-${id})`} visibility="hidden" />)}</g>
      <g className="control-anchor-dots">{CONTROL_GROUPS.map(group => <circle key={group.id} ref={element => { dots.current[group.id] = element; }} data-group={group.id} r={PRIMARY.includes(group.id) ? 2.5 : 2} fill={group.color} visibility="hidden" />)}</g>
      {['voltage', 'current'].map(id => <g key={id}><g ref={element => { sensors.current[id] = element; }} className="control-sense-marker" data-sensor={id === 'current' ? 'rogowski-3d-leader' : 'voltage'} visibility="hidden">{id === 'voltage' ? <><circle r="8.5" fill="white" stroke={GROUPS[id].color} /><text y="4" textAnchor="middle" fill={GROUPS[id].color}>V</text></> : null}</g><text ref={element => { polarity.current[id] = element; }} className="control-output-polarity" textAnchor="middle" visibility="hidden">{id === 'voltage' ? '+' : ''}</text></g>)}
      <g className="control-logical-arrows" markerEnd={`url(#control-${instance}-flow)`}><path ref={element => { arrows.current.nnPwm = element; }} /><path ref={element => { arrows.current.pwmCard = element; }} /></g>
    </svg>
    <p className="control-sr-only" aria-live="polite">{revealed ? 'Illustrative NN and PI response comparison is visible. The animation has finished.' : phase === 0 ? 'Illustrative triple phase shift bridge voltages are shown.' : 'Illustrative interbridge and inner phase shifts change.'}</p>
  </section>;
});
