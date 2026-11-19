import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BrainCircuit, Info, PanelLeft } from 'lucide-react';
import { ModelRepositoryLink } from './ModelRepositoryLink';
import { Viewer } from './Viewer';
import { Assembly } from './Assembly';
import { Inspector } from './Inspector';
import { PowerPath } from './PowerPath';
import { Controls } from './Controls';
import { AboutDialog } from './AboutDialog';
import { ConverterDesignOverview } from './ConverterDesignOverview';
import { ConverterControlOverview } from './ConverterControlOverview';
import { ConverterMaintenanceOverview } from './ConverterMaintenanceOverview';
import { DESIGN_GROUPS, DESIGN_TARGETS } from './converterDesignData';
import { CONTROL_GROUPS, CONTROL_TARGETS } from './converterControlData';
import { MAINTENANCE_GROUPS, MAINTENANCE_TARGETS } from './converterMaintenanceData';
import { byId, components, steps } from './data';
import { pageUrl, readPageRoute, sitePath } from './controlLabNavigation';

const ControlNNLab = lazy(() => import('./ControlNNLab.jsx'));
const RULLab = lazy(() => import('./RULLab.jsx'));
const DesignNNLab = lazy(() => import('./DesignNNLab.jsx'));
const LABS = {
  'geometry-nn': { mode: 'design', component: DesignNNLab, link: '.design-nn-link', loading: 'Opening the geometry playground…' },
  'modulation-nn': { mode: 'control', component: ControlNNLab, link: '.control-nn-link', loading: 'Opening the modulation playground…' },
  'rul-nn': { mode: 'maintenance', component: RULLab, link: '.maintenance-nn-link', loading: 'Opening the remaining life playground…' },
};
const STORY_LABS = { design: 'geometry-nn', control: 'modulation-nn', maintenance: 'rul-nn' };

const EMPTY_TARGETS = [];
const EMPTY_GROUPS = [];
const STORY_MODES = {
  design: { component: ConverterDesignOverview, groups: DESIGN_GROUPS, targets: DESIGN_TARGETS, footer: 'Conceptual design workflow · Illustrative candidates.' },
  control: { component: ConverterControlOverview, groups: CONTROL_GROUPS, targets: CONTROL_TARGETS, footer: 'Illustrative control workflow.' },
  maintenance: { component: ConverterMaintenanceOverview, groups: MAINTENANCE_GROUPS, targets: MAINTENANCE_TARGETS, footer: 'Illustrative maintenance outputs.' },
};
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
  const [tab, setTab] = useState('overview');
  const [step, setStep] = useState(0);
  const [maintenanceAssessment, setMaintenanceAssessment] = useState(false);
  const [labId, setLabId] = useState(() => readPageRoute(window.location.search).labId);
  const labOpen = labId !== null;
  const activeLab = LABS[labId];
  const ActiveLab = activeLab?.component;
  const labSnapshot = useRef(null);
  const wasLabOpen = useRef(null);
  const routeHandler = useRef(null);
  const navigationReady = useRef(false);
  const explorerSnapshot = useRef(null);
  const pendingCameraRestore = useRef(null);
  const storyOverlay = useRef(null);
  const projectedAnchors = useRef({});
  const viewer = useRef(null);
  const designOpen = tab === 'design';
  const controlOpen = tab === 'control';
  const maintenanceOpen = tab === 'maintenance';
  const activeStory = STORY_MODES[tab] || null;
  const StoryOverview = activeStory?.component;
  const storyOpen = !!activeStory;

  const highlightedIds = activeStory ? activeStory.targets : EMPTY_TARGETS;
  const updateProjectedAnchors = useCallback(anchors => {
    projectedAnchors.current = anchors;
    storyOverlay.current?.setAnchors(anchors);
  }, []);

  const closeStory = useCallback(nextTab => {
    const snapshot = explorerSnapshot.current;
    if (!snapshot) return;
    setSelected(snapshot.selected); setExplosion(snapshot.explosion); setHidden(snapshot.hidden);
    setExtracted(snapshot.extracted); setIsolated(snapshot.isolated); setRotate(snapshot.rotate);
    setLabels(snapshot.labels); setView(snapshot.view); setDrawer(false);
    setMaintenanceAssessment(false);
    setTab(typeof nextTab === 'string' ? nextTab : snapshot.tab);
    pendingCameraRestore.current = { camera: snapshot.camera, focusSelector: typeof nextTab !== 'string' ? `.nav-${tab}` : null };
    explorerSnapshot.current = null;
  }, [tab]);
  const openStory = type => {
    if (!STORY_MODES[type] || tab === type) return;
    if (!storyOpen) explorerSnapshot.current = { selected, explosion, hidden: new Set(hidden), extracted: new Set(extracted), isolated, rotate, labels, view, tab, camera: viewer.current?.captureView() };
    projectedAnchors.current = {};
    setTab(type); setAbout(false); setDrawer(false);
    setMaintenanceAssessment(false);
    if (type === 'control') setSelected('CTRL1');
    if (type === 'maintenance') setSelected('J2');
    setExplosion(0); setHidden(new Set()); setExtracted(new Set()); setIsolated(null); setRotate(false); setView('iso');
  };
  const openDesign = () => openStory('design');
  const openControl = () => openStory('control');
  const openMaintenance = () => openStory('maintenance');
  const rememberStory = mode => ({
    mode,
    camera: viewer.current?.captureView(), windowScroll: [window.scrollX, window.scrollY],
    scroll: [...document.querySelectorAll(`.workspace, .explorer, .converter-${mode}-workflow`)].map(element => ({ element, top: element.scrollTop, left: element.scrollLeft })),
  });
  const openNNLab = event => {
    if (event && (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)) return;
    const nextLabId = STORY_LABS[tab];
    if (!nextLabId) return;
    event?.preventDefault();
    labSnapshot.current = rememberStory(tab);
    window.history.replaceState({ ...window.history.state, fluxRoute: true }, '', pageUrl(tab, false, window.location.href));
    window.history.pushState({ fluxRoute: true, labReturn: nextLabId, ...(tab === 'control' ? { controlLabReturn: true } : {}) }, '', pageUrl(tab, nextLabId, window.location.href));
    setLabId(nextLabId);
  };
  const backFromLab = useCallback(() => {
    const mode = LABS[labId]?.mode;
    if (!mode) return;
    if (window.history.state?.labReturn === labId || (labId === 'modulation-nn' && window.history.state?.controlLabReturn)) window.history.back();
    else {
      window.history.replaceState({ fluxRoute: true }, '', pageUrl(mode, false, window.location.href));
      setLabId(null);
    }
  }, [labId]);
  routeHandler.current = route => {
    if (route.lab && !labOpen && tab === route.mode) labSnapshot.current = rememberStory(route.mode);
    if (STORY_MODES[route.mode]) openStory(route.mode);
    else if (storyOpen) closeStory(route.mode === 'ai' ? 'overview' : route.mode);
    else setTab(route.mode === 'ai' ? 'overview' : route.mode);
    setLabId(route.labId);
  };
  useEffect(() => {
    const pop = () => routeHandler.current(readPageRoute(window.location.search));
    window.addEventListener('popstate', pop);
    return () => window.removeEventListener('popstate', pop);
  }, []);
  useEffect(() => {
    if (!navigationReady.current) {
      navigationReady.current = true;
      routeHandler.current(readPageRoute(window.location.search));
      return;
    }
    const route = readPageRoute(window.location.search);
    if (route.mode !== tab || route.labId !== labId) window.history.pushState({ fluxRoute: true }, '', pageUrl(tab, labId, window.location.href));
  }, [tab, labId]);
  useLayoutEffect(() => {
    const previousLab = LABS[wasLabOpen.current];
    wasLabOpen.current = labId;
    if (!previousLab || labOpen) return;
    const snapshot = labSnapshot.current;
    labSnapshot.current = null;
    if (tab !== previousLab.mode || (snapshot && snapshot.mode !== tab)) return;
    let secondFrame;
    const firstFrame = requestAnimationFrame(() => {
      secondFrame = requestAnimationFrame(() => {
        if (snapshot?.camera) viewer.current?.restoreView(snapshot.camera);
        else viewer.current?.preset('iso');
        for (const entry of snapshot?.scroll || []) entry.element.scrollTo(entry.left, entry.top);
        if (snapshot?.windowScroll) window.scrollTo(...snapshot.windowScroll);
        document.querySelector(previousLab.link)?.focus({ preventScroll: true });
      });
    });
    return () => { cancelAnimationFrame(firstFrame); cancelAnimationFrame(secondFrame); };
  }, [labId, labOpen, tab]);
  useEffect(() => {
    if (!storyOpen && pendingCameraRestore.current) {
      if (pendingCameraRestore.current.camera) viewer.current?.restoreView(pendingCameraRestore.current.camera);
      else viewer.current?.preset(view);
      if (pendingCameraRestore.current.focusSelector) document.querySelector(pendingCameraRestore.current.focusSelector)?.focus();
      pendingCameraRestore.current = null;
    }
    if (storyOpen) storyOverlay.current?.setAnchors(projectedAnchors.current);
  }, [storyOpen, tab]);

  const select = useCallback(id => {
    setSelected(id); setDrawer(false);
    if (storyOpen) return;
    setHidden(current => reveal(current, [id]));
    setIsolated(current => current && current !== id ? id : current);
  }, [storyOpen]);
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
  const startTour = () => { if (storyOpen) closeStory('path'); setAbout(false); setTab('path'); setStage(0); };

  useEffect(() => {
    const key = event => {
      if (labOpen) return;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName) || about || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key === 'Escape') { if (storyOpen) closeStory(); else { setDrawer(false); setIsolated(null); } return; }
      if (storyOpen) return;
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
  }, [selected, reset, about, storyOpen, closeStory, labOpen]);
  return <><div hidden={labOpen} inert={labOpen ? true : undefined} className={`app ${storyOpen ? 'design-active' : ''} ${controlOpen ? 'control-active' : ''} ${maintenanceOpen ? 'maintenance-active' : ''}`}>
    <header className="topbar">
      <a className="brand brand-astra" href={sitePath()} aria-label="Astra Lab home"><span className="brand-copy"><strong><u>ASTRA</u> Lab</strong><small><span>Next-generation <u>A</u>I for <u>S</u>emiconductors and power elec<u>T</u>ronics</span><span>- <u>R</u>esearch and <u>A</u>dvancements</span></small></span></a>
      <nav aria-label="Main navigation">
        <button className={!storyOpen ? 'nav-active nav-explorer' : 'nav-explorer'} onClick={() => { setAbout(false); if (storyOpen) closeStory('overview'); else setTab('overview'); }}>Explorer</button>
        <button aria-label="AI for converter design" className={`nav-ai nav-design ${designOpen ? 'nav-active' : ''}`} onClick={openDesign}><BrainCircuit size={15} /><span className="nav-full-label">AI for converter design</span><span className="nav-compact-label">Design</span></button>
        <button aria-label="AI for converter control" className={`nav-ai nav-control ${controlOpen ? 'nav-active' : ''}`} onClick={openControl}><BrainCircuit size={15} /><span className="nav-full-label">AI for converter control</span><span className="nav-compact-label">Control</span></button>
        <button aria-label="AI for converter maintenance" className={`nav-ai nav-maintenance ${maintenanceOpen ? 'nav-active' : ''}`} onClick={openMaintenance}><BrainCircuit size={15} /><span className="nav-full-label">AI for converter maintenance</span><span className="nav-compact-label">Maintenance</span></button>
        <button className="nav-about" onClick={() => setAbout(true)}>How it works</button>
        <ModelRepositoryLink />
      </nav>
    </header>

    <div className="workspace">
      <Assembly selected={selected} onSelect={select} hidden={hidden} extracted={extracted} open={drawer} onClose={() => setDrawer(false)} onReset={reset} />
      {drawer ? <button className="drawer-backdrop" onClick={() => setDrawer(false)} aria-label="Close component drawer" /> : null}
      <main className={`explorer ${tab === 'path' ? 'with-path' : ''} ${storyOpen ? 'design-mode' : ''} ${controlOpen ? 'control-mode' : ''} ${maintenanceOpen ? 'maintenance-mode' : ''}`}>
        <div className="canvas-heading">
          <div><button className="mobile-assembly" onClick={() => setDrawer(true)}><PanelLeft size={16} />Assembly</button>
            <h1>Power, taken apart.</h1>
            <p>Explore the hardware behind isolated power conversion.</p>
          </div>
          <div className="concept-rating"><strong>400 V ↔ 48 V</strong><span>Concept architecture</span></div>
        </div>
        <div className="hardware-stage"><Viewer ref={viewer} selected={selected} explosion={explosion} hidden={hidden} extracted={extracted} isolated={isolated} rotate={rotate} labels={labels} onSelect={select} highlightedIds={highlightedIds} designGroups={activeStory?.groups || EMPTY_GROUPS} onProjectedAnchors={updateProjectedAnchors} assessmentActive={maintenanceOpen && maintenanceAssessment} suspended={labOpen} /></div>
        {storyOpen ? <StoryOverview ref={storyOverlay} onClose={() => closeStory()} onResetView={() => viewer.current?.preset('iso')} selectedPart={byId[selected]} onAssessmentChange={setMaintenanceAssessment} onOpenNNLab={openNNLab} active={!labOpen} /> : <div className="inspector-wrap"><Inspector key={selected} part={byId[selected]} hidden={hidden.has(selected)} extracted={extracted.has(selected)} isolated={isolated === selected}
            onHide={() => setHidden(current => toggleSet(current, selected))} onExtract={() => setExtracted(current => toggleSet(current, selected))}
            onIsolate={toggleIsolation} onFocus={() => viewer.current?.focus()} /></div>}

        <div className="scene-status"><span className="status-dot" />{isolated ? (hidden.has(isolated) ? 'Isolated part hidden' : '1 part isolated') : `${components.length - hidden.size} of ${components.length} parts visible`}{extracted.size > 0 ? <span> · {extracted.size} pulled out</span> : null}</div>
        <div className="axis" aria-hidden="true"><span className="axis-y">Y</span><span className="axis-z">Z</span><span className="axis-x">X</span><svg width="60" height="60"><path d="M20 40V7M20 40l29-11M20 40l25 14" fill="none" strokeWidth="2" stroke="#7d9990" /><circle cx="20" cy="40" r="3" fill="#117766" /></svg></div>
        <Controls explosion={explosion} onExplosion={setExplosion} rotate={rotate} onRotate={() => setRotate(!rotate)} labels={labels} onLabels={() => setLabels(!labels)} view={view} onView={changeView} onReset={reset} onFit={() => viewer.current?.preset(view)} />
        {tab === 'path' ? <PowerPath step={step} onStep={setStage} onClose={() => setTab('overview')} /> : null}
      </main>
    </div>

    <footer className="app-footer">
      <div role="tablist" aria-label="Explorer mode">
        <button role="tab" aria-selected={tab === 'overview'} className={tab === 'overview' ? 'selected' : ''} onClick={() => { if (storyOpen) closeStory('overview'); else setTab('overview'); }}>Overview</button>
        <button role="tab" aria-selected={tab === 'path'} className={tab === 'path' ? 'selected' : ''} onClick={() => { if (storyOpen) closeStory('path'); setAbout(false); setTab('path'); setStage(step); }}>Power path</button>
      </div>
      <p><span>Created by Xinze Li</span><span className="footer-description"> · {activeStory ? activeStory.footer : 'Illustrative model · Not a fabrication design.'}</span></p>
      <button className="footer-info icon-button" onClick={() => setAbout(true)} aria-label="About this model"><Info size={17} /></button>
    </footer>
    {about ? <AboutDialog onClose={closeAbout} onTour={startTour} /> : null}
  </div>{ActiveLab ? <Suspense fallback={<main className="nn-lab-loading" role="status">{activeLab.loading}</main>}><ActiveLab onBack={backFromLab} /></Suspense> : null}</>;
}
