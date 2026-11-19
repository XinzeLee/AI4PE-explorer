import { forwardRef, useId, useImperativeHandle, useLayoutEffect, useRef } from 'react';
import { ArrowLeft, Box, RotateCcw, SlidersHorizontal, Thermometer, Waves } from 'lucide-react';
import { DESIGN_GROUPS, DESIGN_NOTICE } from './converterDesignData';
import { DesignPareto } from './DesignPareto';
import { DESIGN_LAB_URL } from './controlLabNavigation';
import './converter-design.css';

function NeuralNetwork({ portRefs }) {
  const inputY = [17, 39, 61, 83];
  const hiddenY = [12, 37, 62, 87];
  const outputY = [25, 50, 75];
  return <svg className="design-neural-graph" viewBox="0 0 124 100" role="img" aria-label="Illustrative neural network with input, hidden and output layers">
    <g className="design-neural-edges">{inputY.flatMap((y, input) => hiddenY.map((nextY, hidden) => <line key={`in-${input}-${hidden}`} x1="15" y1={y} x2="62" y2={nextY} />))}{hiddenY.flatMap((y, hidden) => outputY.map((nextY, output) => <line key={`out-${hidden}-${output}`} x1="62" y1={y} x2="109" y2={nextY} />))}</g>
    {inputY.map((y, index) => <circle key={`input-${index}`} ref={element => { if (element) portRefs.current[DESIGN_GROUPS[index].id] = element; }} cx="15" cy={y} r="4.6" fill={DESIGN_GROUPS[index].color} className="design-network-input" />)}
    {hiddenY.map(y => <circle key={`hidden-${y}`} cx="62" cy={y} r="4.2" className="design-network-hidden" />)}
    {outputY.map(y => <circle key={`output-${y}`} cx="109" cy={y} r="4.2" className="design-network-output" />)}
  </svg>;
}

function edgePoint(rect, side, origin) {
  return {
    x: (side === 'left' ? rect.left : side === 'right' ? rect.right : rect.left + rect.width / 2) - origin.left,
    y: (side === 'top' ? rect.top : side === 'bottom' ? rect.bottom : rect.top + rect.height / 2) - origin.top,
  };
}

function flowPath(start, end, vertical = false) {
  if (vertical) {
    const bend = Math.max(12, Math.abs(end.y - start.y) * .5);
    return `M ${start.x} ${start.y} C ${start.x} ${start.y + bend}, ${end.x} ${end.y - bend}, ${end.x} ${end.y}`;
  }
  const bend = Math.max(10, Math.abs(end.x - start.x) * .5);
  return `M ${start.x} ${start.y} C ${start.x + bend} ${start.y}, ${end.x - bend} ${end.y}, ${end.x} ${end.y}`;
}

export const ConverterDesignOverview = forwardRef(function ConverterDesignOverview({ onClose, onResetView, selectedPart, onOpenNNLab, active = true }, ref) {
  const root = useRef(null);
  const heading = useRef(null);
  const workflow = useRef(null);
  const footer = useRef(null);
  const leaderSvg = useRef(null);
  const nn = useRef(null);
  const model = useRef(null);
  const optimizer = useRef(null);
  const pareto = useRef(null);
  const designInput = useRef(null);
  const portRefs = useRef({});
  const wireRefs = useRef({});
  const sourceRefs = useRef({});
  const arrowRefs = useRef({});
  const anchors = useRef({});
  const draw = useRef(() => {});
  const schedule = useRef(() => {});
  const backButton = useRef(null);
  const instanceId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const arrowId = `design-arrow-${instanceId}`;
  const feedbackId = `design-feedback-${instanceId}`;

  useImperativeHandle(ref, () => ({
    setAnchors(nextAnchors) {
      anchors.current = nextAnchors || {};
      draw.current();
    },
  }), []);

  useLayoutEffect(() => {
    if (!active) return;
    const main = root.current.closest('.explorer');
    const stage = main?.querySelector('.hardware-stage');
    const canvasHost = stage?.querySelector('.webgl-host');
    if (!main || !stage || !canvasHost) return;
    let frame = null;
    let disposed = false;

    function drawConnections() {
      if (disposed || !leaderSvg.current) return;
      const svg = leaderSvg.current;
      const svgRect = svg.getBoundingClientRect();
      const canvasRect = canvasHost.getBoundingClientRect();
      const mainRect = main.getBoundingClientRect();
      const nodeRects = {
        nn: nn.current.getBoundingClientRect(),
        model: model.current.getBoundingClientRect(),
        optimizer: optimizer.current.getBoundingClientRect(),
        pareto: pareto.current.getBoundingClientRect(),
      };
      const flowRect = workflow.current.getBoundingClientRect();
      const inputRect = designInput.current.getBoundingClientRect();
      const mobile = window.matchMedia('(max-width: 760px)').matches;
      // Measure actual content items, excluding this absolute SVG. This equals
      // the mobile scroll extent without allowing an old SVG height to keep a
      // collapsed details panel artificially tall.
      const contentBottom = Math.max(...[heading.current, workflow.current, footer.current, stage].map(element => element.getBoundingClientRect().bottom - svgRect.top));
      const width = Math.max(1, main.clientWidth);
      const height = Math.max(main.clientHeight, Math.ceil(contentBottom));
      const viewBox = `0 0 ${width} ${height}`;
      if (svg.getAttribute('viewBox') !== viewBox) {
        svg.setAttribute('viewBox', viewBox);
        svg.style.width = `${width}px`;
        svg.style.height = `${height}px`;
      }
      const visibleGroups = [];
      for (const group of DESIGN_GROUPS) {
        const anchor = anchors.current[group.id];
        const wire = wireRefs.current[group.id];
        const dot = sourceRefs.current[group.id];
        const port = portRefs.current[group.id];
        const portRect = port?.getBoundingClientRect();
        const portClipped = !mobile && portRect && (portRect.bottom < flowRect.top || portRect.top > flowRect.bottom);
        const visible = !!(anchor?.visible && Number.isFinite(anchor.u) && Number.isFinite(anchor.v) && portRect && !portClipped && canvasRect.width && canvasRect.height);
        wire.setAttribute('visibility', visible ? 'visible' : 'hidden');
        dot.setAttribute('visibility', visible ? 'visible' : 'hidden');
        if (!visible) continue;
        const source = { x: canvasRect.left + anchor.u * canvasRect.width - svgRect.left, y: canvasRect.top + anchor.v * canvasRect.height - svgRect.top };
        const target = { x: portRect.left + portRect.width / 2 - svgRect.left, y: portRect.top + portRect.height / 2 - svgRect.top };
        const bend = Math.max(28, Math.abs(target.x - source.x) * .35);
        const path = mobile
          ? `M ${source.x} ${source.y} C ${source.x} ${source.y + Math.max(30, (target.y - source.y) * .4)}, ${target.x - 28} ${target.y}, ${target.x} ${target.y}`
          : `M ${source.x} ${source.y} C ${source.x + bend} ${source.y}, ${target.x - Math.min(42, bend)} ${target.y}, ${target.x} ${target.y}`;
        wire.setAttribute('d', path);
        wire.dataset.partId = anchor.partId || '';
        dot.setAttribute('cx', source.x);
        dot.setAttribute('cy', source.y);
        visibleGroups.push(group.id);
      }
      svg.dataset.visibleGroups = visibleGroups.join(' ');
      arrowRefs.current.nnModel.setAttribute('d', flowPath(edgePoint(nodeRects.nn, 'right', svgRect), edgePoint(nodeRects.model, 'left', svgRect)));
      arrowRefs.current.modelOptimizer.setAttribute('d', flowPath(edgePoint(nodeRects.model, mobile ? 'bottom' : 'right', svgRect), edgePoint(nodeRects.optimizer, mobile ? 'top' : 'left', svgRect), mobile));
      arrowRefs.current.optimizerPareto.setAttribute('d', flowPath(edgePoint(nodeRects.optimizer, 'bottom', svgRect), edgePoint(nodeRects.pareto, 'top', svgRect), true));
      const feedbackStart = edgePoint(nodeRects.optimizer, mobile ? 'right' : 'top', svgRect);
      const feedbackEnd = edgePoint(inputRect, 'right', svgRect);
      if (mobile) {
        const rail = width - 5;
        arrowRefs.current.feedback.setAttribute('d', `M ${feedbackStart.x} ${feedbackStart.y} C ${rail} ${feedbackStart.y}, ${rail} ${feedbackEnd.y}, ${feedbackEnd.x} ${feedbackEnd.y}`);
      } else {
        const lane = Math.min(feedbackStart.y - 10, feedbackEnd.y + 18);
        arrowRefs.current.feedback.setAttribute('d', `M ${feedbackStart.x} ${feedbackStart.y} C ${feedbackStart.x} ${lane}, ${feedbackEnd.x + 32} ${lane}, ${feedbackEnd.x} ${feedbackEnd.y}`);
      }
      svg.dataset.ready = 'ready';
      svg.dataset.viewport = `${Math.round(mainRect.width)} ${Math.round(mainRect.height)}`;
    }

    function scheduleDraw() {
      if (frame !== null || disposed) return;
      frame = requestAnimationFrame(() => { frame = null; drawConnections(); });
    }
    draw.current = drawConnections;
    schedule.current = scheduleDraw;
    const resizeObserver = new ResizeObserver(scheduleDraw);
    for (const element of [main, stage, heading.current, workflow.current, footer.current, nn.current, model.current, optimizer.current, pareto.current]) resizeObserver.observe(element);
    window.addEventListener('resize', scheduleDraw, { passive: true });
    window.addEventListener('scroll', scheduleDraw, { passive: true, capture: true });
    scheduleDraw();
    if (!root.current.dataset.hasFocused) { backButton.current?.focus({ preventScroll: true }); root.current.dataset.hasFocused = 'true'; }
    return () => {
      disposed = true;
      if (frame !== null) cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      window.removeEventListener('resize', scheduleDraw);
      window.removeEventListener('scroll', scheduleDraw, true);
      draw.current = () => {};
      schedule.current = () => {};
    };
  }, [active]);

  return <section ref={root} className="converter-design-overview" aria-label="AI for converter design" data-design-overview="true" data-active={String(active)}>
    <header ref={heading} className="converter-design-heading">
      <div><h1>AI for converter design</h1><p>Connect hardware choices to performance trade-offs.</p></div>
      <div className="converter-design-actions"><button ref={backButton} onClick={onClose} aria-label="Back to explorer" title="Back to explorer"><ArrowLeft size={16} /><span>Back to explorer</span></button><button onClick={onResetView} aria-label="Reset hardware view" title="Reset hardware view"><RotateCcw size={15} /><span>Reset view</span></button></div>
    </header>

    <div className="converter-design-hardware-overlay">
      <div className="converter-design-hardware-top"><strong>Converter hardware</strong><span ref={designInput} className="design-input-label">Design inputs</span></div>
      <div className="converter-design-legend" aria-label="Hardware feature groups">{DESIGN_GROUPS.map(group => <span key={group.id}><i style={{ background: group.color }} />{group.label}</span>)}</div>
      <div className="converter-design-hardware-bottom"><span>Drag to orbit · Scroll to zoom</span>{selectedPart ? <span title={`${selectedPart.id} · ${selectedPart.name}`} aria-live="polite"><b>{selectedPart.id}</b> {selectedPart.name}</span> : null}</div>
    </div>

    <aside ref={workflow} className="converter-design-workflow" aria-label="AI-assisted converter design workflow">
      <h2 className="design-workflow-caption">An AI-assisted design loop</h2>
      <div className="design-flow-nodes">
        <a ref={nn} className="design-flow-node design-neural-node design-nn-link" href={DESIGN_LAB_URL} onClick={onOpenNNLab} aria-label="Explore geometry to loop inductance">
          <h3>NN surrogate</h3>
          <NeuralNetwork portRefs={portRefs} />
          <p>Geometry · materials<br />Operating conditions</p>
          <small>Illustrative architecture</small>
          <span className="design-nn-cta">Explore geometric variables → loop inductance <span aria-hidden="true">↗</span></span>
        </a>
        <section ref={model} className="design-flow-node design-model-node" aria-label="Performance and multiphysics estimates">
          <h3>Performance /<br />multi-physics estimates</h3>
          <div className="design-model-symbols" aria-hidden="true"><Waves size={22} /><Thermometer size={22} /><Box size={22} /></div>
          <p>Loss · temperature<br />Field response</p>
          <small>Surrogate + calculations</small>
        </section>
        <section ref={optimizer} className="design-flow-node design-optimizer-node" aria-label="Multi-objective optimizer">
          <h3>Multi-objective optimizer</h3>
          <div className="design-optimizer-symbol" aria-hidden="true"><SlidersHorizontal size={35} /></div>
          <p>Compare design candidates</p>
          <div className="design-optimizer-goals"><span>Efficiency ↑</span><span>Power density ↑</span></div>
          <small className="design-next-label">Next design ↺</small>
        </section>
      </div>
      <section ref={pareto} className="converter-design-plot" aria-label="Efficiency and power-density trade-offs"><DesignPareto /></section>
    </aside>

    <footer ref={footer} className="converter-design-footer">
      <p>{DESIGN_NOTICE}</p>
      <details onToggle={() => schedule.current()}><summary>About the diagram</summary><div><p>The neural network represents a possible surrogate model. Performance estimates can combine learned models with engineering calculations and multiphysics tools.</p></div></details>
    </footer>

    <svg ref={leaderSvg} className="converter-design-leaders" aria-hidden="true" preserveAspectRatio="none">
      <defs><marker id={arrowId} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"><path d="M1 1L7 4L1 7" fill="none" stroke="#799582" strokeWidth="1.2" /></marker><marker id={feedbackId} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="5" markerHeight="5" orient="auto"><path d="M1 1L7 4L1 7" fill="none" stroke="#94a68d" strokeWidth="1.2" /></marker></defs>
      <g className="design-input-wires">{DESIGN_GROUPS.map(group => <g key={group.id}><path ref={element => { wireRefs.current[group.id] = element; }} data-group={group.id} stroke={group.color} visibility="hidden" /><circle ref={element => { sourceRefs.current[group.id] = element; }} r="2.5" fill={group.color} visibility="hidden" /></g>)}</g>
      <g className="design-flow-arrows" markerEnd={`url(#${arrowId})`}><path ref={element => { arrowRefs.current.nnModel = element; }} /><path ref={element => { arrowRefs.current.modelOptimizer = element; }} /><path ref={element => { arrowRefs.current.optimizerPareto = element; }} /></g>
      <path ref={element => { arrowRefs.current.feedback = element; }} className="design-feedback-arrow" markerEnd={`url(#${feedbackId})`} />
    </svg>
  </section>;
});
