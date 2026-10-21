import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BrainCircuit, Check, Download, Info, PanelLeft } from 'lucide-react';
import { Viewer } from './Viewer';
import { Assembly } from './Assembly';
import { Inspector } from './Inspector';
import { PowerPath } from './PowerPath';
import { Controls } from './Controls';
import { AboutDialog } from './AboutDialog';
import { AIExplorer } from './AIExplorer';
import { AI_PHASES, getFilteredOpportunities } from './aiData';
import { byId, components, steps } from './data';

const EMPTY_TARGETS = [];
const toggleSet = (set, id) => {
  const next = new Set(set);
  if (next.has(id)) next.delete(id); else next.add(id);
  return next;
};
const reveal = (set, ids) => new Set([...set].filter(id => !ids.includes(id)));

export default function App() {
  const [selected, setSelected] = useState('T1');
  const [explosion, setExplosion] = useState(0);
  const [hidden, setHidden] = useState(new Set());
  const [extracted, setExtracted] = useState(new Set());
  const [isolated, setIsolated] = useState(null);
  const [rotate, setRotate] = useState(false);
  const [labels, setLabels] = useState(true);
  const [view, setView] = useState('iso');
  const [drawer, setDrawer] = useState(false);
  const [about, setAbout] = useState(false);
  const [tab, setTab] = useState(() => new URLSearchParams(window.location.search).get('mode') === 'ai' ? 'ai' : 'overview');
  const [step, setStep] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState('');
  const [aiActiveId, setAIActiveId] = useState('magnetic-model');
  const [aiPhase, setAIPhase] = useState('all');
  const [aiScope, setAIScope] = useState('part');
  const viewer = useRef(null);
  const aiMode = tab === 'ai';

  // Resolve the active application from exactly the same scope as the panel.
  // Empty filters produce no highlights; an obsolete active ID cannot linger.
  const aiChoices = useMemo(() => getFilteredOpportunities({ phase: aiPhase, partId: aiScope === 'part' ? selected : null }), [aiPhase, aiScope, selected]);
  const activeAI = aiChoices.find(item => item.id === aiActiveId) || aiChoices[0] || null;
  const aiColor = AI_PHASES.find(item => item.id === activeAI?.phase)?.color || '#397ca4';
  const highlightedIds = aiMode && activeAI ? activeAI.partIds : EMPTY_TARGETS;

  const select = useCallback(id => {
    setSelected(id); setDrawer(false);
    setHidden(current => reveal(current, [id]));
    if (aiMode) { setAIScope('part'); setIsolated(null); }
    else setIsolated(current => current && current !== id ? id : current);
  }, [aiMode]);

  const chooseAI = useCallback(opportunity => {
    setAIActiveId(opportunity.id);
    setSelected(current => opportunity.partIds.includes(current) ? current : opportunity.partIds[0]);
    setHidden(current => reveal(current, opportunity.partIds));
    setIsolated(null);
  }, []);

  const changeAIPhase = phase => {
    setAIPhase(phase);
    const choices = getFilteredOpportunities({ phase, partId: aiScope === 'part' ? selected : null });
    const next = choices.find(item => item.id === aiActiveId) || choices[0];
    if (next) chooseAI(next); else setAIActiveId('');
  };
  const changeAIScope = scope => {
    setAIScope(scope);
    const choices = getFilteredOpportunities({ phase: aiPhase, partId: scope === 'part' ? selected : null });
    const next = choices.find(item => item.id === aiActiveId) || choices[0];
    if (next) chooseAI(next); else setAIActiveId('');
  };
  const enterAI = useCallback(() => {
    setAbout(false); setTab('ai'); setIsolated(null);
    setHidden(current => reveal(current, [selected]));
  }, [selected]);
  const closeAbout = useCallback(() => setAbout(false), []);
  const reset = useCallback(() => {
    setExplosion(0); setHidden(new Set()); setExtracted(new Set());
    setIsolated(null); setRotate(false); setView('iso');
    requestAnimationFrame(() => viewer.current?.preset('iso'));
  }, []);
  const changeView = next => { setView(next); viewer.current?.preset(next); };
  const setStage = index => {
    setStep(index); setSelected(steps[index].part);
    setHidden(new Set()); setIsolated(null); setExtracted(new Set());
  };
  const toggleIsolation = () => {
    setHidden(current => reveal(current, [selected]));
    setIsolated(current => current ? null : selected);
  };
  const focusAI = () => {
    if (!activeAI) return;
    setHidden(current => reveal(current, activeAI.partIds)); setIsolated(null);
    requestAnimationFrame(() => viewer.current?.focusParts(activeAI.partIds));
  };
  const startTour = () => { setAbout(false); setTab('path'); setStage(0); };

  useEffect(() => {
    const key = event => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || about || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Escape') { setDrawer(false); setIsolated(null); return; }
      switch (event.key.toLowerCase()) {
        case 'x': setExtracted(current => toggleSet(current, selected)); break;
        case 'h': setHidden(current => toggleSet(current, selected)); break;
        case 'i': setHidden(current => reveal(current, [selected])); setIsolated(current => current ? null : selected); break;
        case 'r': reset(); break;
        case 'e': setExplosion(current => current > .5 ? 0 : 1); break;
        default: break;
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [selected, reset, about]);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(''), 4500);
    return () => clearTimeout(timer);
  }, [notice]);

  async function exportModel() {
    setExporting(true);
    try {
      const data = await viewer.current.exportModel();
      const url = URL.createObjectURL(new Blob([data], { type: 'model/gltf-binary' }));
      const link = document.createElement('a'); link.href = url; link.download = 'flux-dab-converter.glb'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      setNotice(`GLB exported with all ${components.length} named components.`);
    } catch (error) {
      console.error(error); setNotice('Model export failed. Please reload the viewer and try again.');
    } finally { setExporting(false); }
  }

  const highlightedVisible = highlightedIds.filter(id => !hidden.has(id) && (!isolated || isolated === id)).length;
  return <div className="app">
    <header className="topbar">
      <a className="brand" href="/" aria-label="FLUX Hardware Lab home"><svg width="25" height="30" viewBox="0 0 25 30" aria-hidden="true"><path d="M2 2h23l-5 6H8v5h12l-5 6H8v9H2Z" fill="currentColor" /></svg><b>FLUX</b><span>/</span><small>Hardware Lab</small></a>
      <nav aria-label="Main navigation">
        <button className={!aiMode ? 'nav-active' : ''} onClick={() => { setAbout(false); setTab('overview'); }}>Explorer</button>
        <button className={`nav-ai ${aiMode ? 'nav-active' : ''}`} onClick={enterAI}><BrainCircuit size={15} /><span>AI opportunities</span></button>
        <button className="nav-about" onClick={() => setAbout(true)}>How it works</button>
        <button className="export-button" aria-label={exporting ? 'Exporting model' : 'Export model'} disabled={exporting} onClick={exportModel}><Download size={16} /><span>{exporting ? 'Exporting…' : 'Export model'}</span></button>
      </nav>
    </header>

    <div className="workspace">
      <Assembly selected={selected} onSelect={select} hidden={hidden} extracted={extracted} open={drawer} onClose={() => setDrawer(false)} onReset={reset} aiMode={aiMode} />
      {drawer ? <button className="drawer-backdrop" onClick={() => setDrawer(false)} aria-label="Close component drawer" /> : null}
      <main className={`explorer ${tab === 'path' ? 'with-path' : ''} ${aiMode ? 'ai-mode' : ''}`}>
        <div className="canvas-heading">
          <div><button className="mobile-assembly" onClick={() => setDrawer(true)}><PanelLeft size={16} />Assembly</button>
            <h1>{aiMode ? 'Where AI meets hardware.' : 'Power, taken apart.'}</h1>
            <p>{aiMode ? 'Define the task. Match a method. Plan the implementation.' : 'Explore the hardware behind isolated power conversion.'}</p>
          </div>
          <div className="concept-rating"><strong>400 V ↔ 48 V</strong><span>Concept architecture</span></div>
        </div>
        <Viewer ref={viewer} selected={selected} explosion={explosion} hidden={hidden} extracted={extracted} isolated={isolated} rotate={rotate} labels={labels} onSelect={select} highlightedIds={highlightedIds} highlightColor={aiColor} />
        {aiMode ? <AIExplorer selectedPart={byId[selected]} activeId={activeAI?.id} phase={aiPhase} scope={aiScope}
          onPhaseChange={changeAIPhase} onScopeChange={changeAIScope} onOpportunitySelect={chooseAI} onPartSelect={select}
          onFocus={focusAI} onIsolate={toggleIsolation} onExit={() => setTab('overview')} />
          : <div className="inspector-wrap"><Inspector key={selected} part={byId[selected]} hidden={hidden.has(selected)} extracted={extracted.has(selected)} isolated={isolated === selected}
            onHide={() => setHidden(current => toggleSet(current, selected))} onExtract={() => setExtracted(current => toggleSet(current, selected))}
            onIsolate={toggleIsolation} onFocus={() => viewer.current?.focus()} /></div>}

        {aiMode ? <div className="ai-model-legend" role="status" style={{ '--phase-color': aiColor }}><i /><span>{activeAI ? `${highlightedVisible} / ${highlightedIds.length} application targets visible` : 'Select a phase or another component'}<small>{activeAI ? `${AI_PHASES.find(item => item.id === activeAI.phase)?.label} · ${activeAI.title}` : 'No targets for the current filter'}</small></span></div> : null}
        <div className="scene-status"><span className="status-dot" />{isolated ? (hidden.has(isolated) ? 'Isolated part hidden' : '1 part isolated') : `${components.length - hidden.size} of ${components.length} parts visible`}{extracted.size > 0 ? <span> · {extracted.size} pulled out</span> : null}</div>
        <div className="axis" aria-hidden="true"><span className="axis-y">Y</span><span className="axis-z">Z</span><span className="axis-x">X</span><svg width="60" height="60"><path d="M20 40V7M20 40l29-11M20 40l25 14" fill="none" strokeWidth="2" stroke="#7d9990" /><circle cx="20" cy="40" r="3" fill="#117766" /></svg></div>
        <Controls explosion={explosion} onExplosion={setExplosion} rotate={rotate} onRotate={() => setRotate(!rotate)} labels={labels} onLabels={() => setLabels(!labels)} view={view} onView={changeView} onReset={reset} onFit={() => viewer.current?.preset(view)} />
        {tab === 'path' ? <PowerPath step={step} onStep={setStage} onClose={() => setTab('overview')} /> : null}
      </main>
    </div>

    <footer className="app-footer">
      <div role="tablist" aria-label="Explorer mode">
        <button role="tab" aria-selected={tab === 'overview'} className={tab === 'overview' ? 'selected' : ''} onClick={() => setTab('overview')}>Overview</button>
        <button role="tab" aria-selected={tab === 'path'} className={tab === 'path' ? 'selected' : ''} onClick={() => { setTab('path'); setStage(step); }}>Power path</button>
        <button role="tab" aria-selected={aiMode} className={aiMode ? 'selected' : ''} onClick={enterAI}><BrainCircuit size={13} />AI opportunities</button>
      </div>
      <p>{aiMode ? 'Framework-based proposals · No trained AI models.' : 'Illustrative model · Not a fabrication design.'}</p>
      <button className="footer-info icon-button" onClick={() => setAbout(true)} aria-label="About this model"><Info size={17} /></button>
    </footer>
    {notice ? <div className="toast" role="status"><Check size={17} />{notice}</div> : null}
    {about ? <AboutDialog onClose={closeAbout} onTour={startTour} onAI={enterAI} /> : null}
  </div>;
}
