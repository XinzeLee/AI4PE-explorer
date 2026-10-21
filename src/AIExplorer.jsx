import { useEffect, useId, useState } from 'react';
import { ArrowUpRight, BrainCircuit, ChevronDown, Eye, Focus, Scan, X } from 'lucide-react';
import { AI_PHASES, AI_SOURCE, aiOpportunities } from './aiData';
import { byId } from './data';
import './ai.css';

const detailTabs = [
  { id: 'what', label: 'What', subtitle: 'The task' },
  { id: 'which', label: 'Which', subtitle: 'AI methods' },
  { id: 'how', label: 'How', subtitle: 'Implementation' },
];

function TextList({ items, ordered = false }) {
  const List = ordered ? 'ol' : 'ul';
  return <List>{items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</List>;
}

export function AIExplorer({
  selectedPart, activeId, phase = 'all', scope = 'part',
  onPhaseChange, onScopeChange, onOpportunitySelect, onPartSelect,
  onFocus, onIsolate, onExit,
}) {
  const [detailTab, setDetailTab] = useState('what');
  const [collapsed, setCollapsed] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(() => typeof window === 'undefined' || !window.matchMedia('(max-width: 960px)').matches);
  const instanceId = useId();
  const scopedOpportunities = scope === 'part'
    ? aiOpportunities.filter(opportunity => opportunity.partIds.includes(selectedPart.id))
    : aiOpportunities;
  const visibleOpportunities = phase === 'all'
    ? scopedOpportunities
    : scopedOpportunities.filter(opportunity => opportunity.phase === phase);
  const active = visibleOpportunities.find(opportunity => opportunity.id === activeId);
  const activePhase = active && AI_PHASES.find(item => item.id === active.phase);
  const phaseLabel = phase === 'all' ? 'All phases' : AI_PHASES.find(item => item.id === phase)?.label || phase;

  useEffect(() => {
    const mobileLayout = window.matchMedia('(max-width: 960px)');
    const updateFilterLayout = event => setFiltersOpen(!event.matches);
    mobileLayout.addEventListener('change', updateFilterLayout);
    return () => mobileLayout.removeEventListener('change', updateFilterLayout);
  }, []);

  function changeDetailTab(event) {
    const currentIndex = detailTabs.findIndex(item => item.id === detailTab);
    let nextIndex;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % detailTabs.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex + detailTabs.length - 1) % detailTabs.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = detailTabs.length - 1;
    else return;
    event.preventDefault();
    setDetailTab(detailTabs[nextIndex].id);
    event.currentTarget.parentElement.querySelectorAll('[role="tab"]')[nextIndex]?.focus();
  }

  return <aside className={`ai-explorer ${collapsed ? 'is-collapsed' : ''}`} aria-label="AI opportunities for this converter">
    <div className="ai-panel-heading">
      <div className="ai-heading-title"><BrainCircuit size={19} /><div><h2>Where AI fits</h2><p>From hardware to an AI task.</p></div></div>
      <div className="ai-heading-actions">
        <button className="icon-button ai-collapse-button" onClick={() => setCollapsed(value => !value)} aria-expanded={!collapsed} aria-controls={`${instanceId}-content`} aria-label={collapsed ? 'Expand AI opportunities' : 'Collapse AI opportunities'}><ChevronDown size={17} /></button>
        <button className="icon-button" onClick={onExit} aria-label="Exit AI opportunities"><X size={16} /></button>
      </div>
    </div>

    <div className="ai-panel-content" id={`${instanceId}-content`}>
      <details className="ai-filter-menu" open={filtersOpen} onToggle={event => setFiltersOpen(event.currentTarget.open)}>
      <summary><span>Filters</span><small>{phaseLabel} · {scope === 'part' ? selectedPart.id : 'All hardware'}</small><ChevronDown size={13} /></summary>
      <div className="ai-introduction"><span>PROPOSED APPLICATIONS</span><p>The paper’s <strong>What–Which–How</strong> framework, applied to this hardware. No live AI inference.</p></div>

      <div className="ai-scope" role="group" aria-label="AI application scope">
        <button className={scope === 'part' ? 'selected' : ''} aria-pressed={scope === 'part'} onClick={() => onScopeChange('part')}>Selected part <code>{selectedPart.id}</code></button>
        <button className={scope === 'all' ? 'selected' : ''} aria-pressed={scope === 'all'} onClick={() => onScopeChange('all')}>All hardware</button>
      </div>

      <div className="ai-phase-filters" role="group" aria-label="Filter AI applications by lifecycle phase">
        {[{ id: 'all', label: 'All' }, ...AI_PHASES].map(item => {
          const count = item.id === 'all' ? scopedOpportunities.length : scopedOpportunities.filter(opportunity => opportunity.phase === item.id).length;
          return <button key={item.id} className={phase === item.id ? 'selected' : ''} onClick={() => onPhaseChange(item.id)} aria-pressed={phase === item.id} aria-label={`${item.label}: ${count} applications`} style={item.color ? { '--phase-color': item.color } : undefined}>{item.id !== 'all' ? <i /> : null}{item.label}<small>{count}</small></button>;
        })}
      </div>

      <div className="ai-results-heading"><span>{scope === 'part' ? selectedPart.name : 'The complete converter'}</span><small aria-live="polite">{visibleOpportunities.length} {visibleOpportunities.length === 1 ? 'application' : 'applications'}</small></div>
      </details>

      {visibleOpportunities.length ? <label className="ai-application-select"><span>Application <small>· proposed example</small></span><select aria-label="Choose AI application" title={active ? `${active.title}: ${active.summary}` : 'Choose an AI application'} value={activeId || ''} onChange={event => onOpportunitySelect(visibleOpportunities.find(item => item.id === event.target.value))}>
        {!active ? <option value="" disabled>Select an application</option> : null}
        {visibleOpportunities.map(opportunity => <option key={opportunity.id} value={opportunity.id}>{opportunity.title}</option>)}
      </select></label> : <div className="ai-empty-state"><strong>No matching applications.</strong><p>{scope === 'part' ? `There is no proposed ${phase === 'all' ? '' : `${phase} `}example linked to ${selectedPart.id} in this explorer.` : 'Try another lifecycle phase to explore the proposed applications.'}</p><div>{phase !== 'all' ? <button onClick={() => onPhaseChange('all')}>Show all phases</button> : null}{scope === 'part' ? <button onClick={() => onScopeChange('all')}>Explore all hardware</button> : null}</div></div>}

      {active ? <section className="ai-opportunity-detail" aria-label={`Application details: ${active.title}`}>
        <div className="ai-active-phase" style={{ '--phase-color': activePhase?.color || '#117766' }}><i />{activePhase?.label}<span>Illustrative use case</span></div>
        <h3>{active.title}</h3>
        <p className="ai-summary">{active.summary}</p>

        <div className="ai-detail-tabs" role="tablist" aria-label="What Which How framework">
          {detailTabs.map(item => <button key={item.id} id={`${instanceId}-${item.id}-tab`} role="tab" type="button" aria-selected={detailTab === item.id} aria-controls={`${instanceId}-${item.id}-panel`} tabIndex={detailTab === item.id ? 0 : -1} onClick={() => setDetailTab(item.id)} onKeyDown={changeDetailTab} className={detailTab === item.id ? 'selected' : ''}><strong>{item.label}</strong><small>{item.subtitle}</small></button>)}
        </div>

        <div className="ai-framework-detail" role="tabpanel" id={`${instanceId}-${detailTab}-panel`} aria-labelledby={`${instanceId}-${detailTab}-tab`} tabIndex={0}>
          {detailTab === 'what' ? <>
            <dl className="ai-task-meta"><div><dt>Task</dt><dd>{active.task}</dd></div><div><dt>Modality</dt><dd>{active.modality}</dd></div></dl>
            <h4>Physical targets</h4><p className="ai-field-hint">Select a target to inspect its hardware.</p>
            <div className="ai-part-chips">{active.partIds.map(id => <button key={id} onClick={() => onPartSelect(id)} aria-pressed={selectedPart.id === id} className={selectedPart.id === id ? 'selected' : ''} title={byId[id]?.name || id} aria-label={`Select ${id}: ${byId[id]?.name || 'hardware component'}`}><code>{id}</code><span>{byId[id]?.name || id}</span></button>)}</div>
            <h4>Inputs to the algorithm</h4><TextList items={active.inputs} />
            <h4>Outputs from the algorithm</h4><TextList items={active.outputs} />
          </> : detailTab === 'which' ? <>
            <h4>Candidate algorithms</h4><TextList items={active.algorithms} />
            <h4>Why these methods</h4><p>{active.rationale}</p>
            <p className="ai-method-note">These are candidates for evaluation, with no performance ranking implied.</p>
          </> : <>
            <h4>Training / development</h4><p>{active.training}</p>
            <h4>Where it runs</h4><p>{active.runtime}</p>
            <h4>Implementation path</h4><TextList items={active.how} ordered />
            <h4>Validation before use</h4><TextList items={active.validation} />
          </>}
        </div>

        <div className="ai-hardware-actions" aria-label="Inspect application hardware">
          <button onClick={onFocus}><Focus size={14} />Focus in 3D</button>
          <button onClick={() => onOpportunitySelect(active)}><Eye size={14} />Reveal targets</button>
          <button onClick={onIsolate} title={`Isolate the selected component, ${selectedPart.name}`}><Scan size={14} />Isolate {selectedPart.id}</button>
        </div>
        <div className="ai-application-reference"><span>Framework connection</span><a href={active.reference.url || AI_SOURCE.url} target="_blank" rel="noreferrer">{active.reference.label}<ArrowUpRight size={11} /></a><small>{active.reference.section}</small>{active.example ? <a className="ai-example-link" href={active.example.url} target="_blank" rel="noreferrer">{active.example.label}<ArrowUpRight size={11} /></a> : null}</div>
      </section> : visibleOpportunities.length ? <div className="ai-select-prompt"><BrainCircuit size={20} /><p>Select an application above to connect the hardware with its task, candidate methods and implementation.</p></div> : null}

      <div className="ai-source-note"><strong>Paper framework · proposed hardware mappings</strong><p>The source supplies the framework. The examples on this 3D converter are educational proposals, with no measured or simulated AI results.</p><div><a href={AI_SOURCE.url} target="_blank" rel="noreferrer" title={AI_SOURCE.title}>TIE paper<ArrowUpRight size={11} /></a>{AI_SOURCE.companionUrl ? <a href={AI_SOURCE.companionUrl} target="_blank" rel="noreferrer">Author companion<ArrowUpRight size={11} /></a> : null}{AI_SOURCE.selectorUrl ? <a href={AI_SOURCE.selectorUrl} target="_blank" rel="noreferrer">Algorithm selector<ArrowUpRight size={11} /></a> : null}</div></div>
    </div>
  </aside>;
}
