import { useEffect, useRef } from 'react';
import { ArrowUpRight, X } from 'lucide-react';
import { AI_SOURCE } from './aiData';

export function AboutDialog({ onClose, onTour, onAI }) {
  const closeButton = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    closeButton.current?.focus();
    const key = event => {
      if (event.key === 'Escape') onClose();
      if (event.key !== 'Tab') return;
      const elements = [...document.querySelectorAll('.about-dialog button,.about-dialog a')];
      if (event.shiftKey && document.activeElement === elements[0]) {
        event.preventDefault(); elements.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === elements.at(-1)) {
        event.preventDefault(); elements[0]?.focus();
      }
    };
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('keydown', key); previous?.focus(); };
  }, [onClose]);
  return <div className="modal-backdrop" onClick={event => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="about-dialog" role="dialog" aria-modal="true" aria-labelledby="about-title">
      <button ref={closeButton} className="icon-button modal-close" aria-label="Close explanation" onClick={onClose}><X /></button>
      <div className="about-mark">F</div>
      <h2 id="about-title">A closer look at conversion.</h2>
      <p>This conceptual 3 kW dual active bridge (DAB) links a 400 V DC bus and a 48 V DC bus through a high-frequency transformer.</p>
      <div className="about-diagram"><span>400 V<br /><b>HV bridge</b></span><span>↔</span><span>Transfer L<br /><b>Transformer</b></span><span>↔</span><span>48 V<br /><b>LV bridge</b></span></div>
      <p>Both bridges switch actively. Their relative phase shift controls transferred power and its direction. Four dual-channel driver boards represent eight gate channels. A separate control card coordinates switching.</p>
      <h3>From physical parts to AI applications.</h3>
      <p>AI opportunities connects this hardware to proposed design, control and maintenance tasks. Each application follows the TIE paper’s What–Which–How framework: define the PE problem and data, compare suitable methods, then plan implementation and validation. The physical target and the computer running an algorithm can be different.</p>
      <a href={AI_SOURCE.url} target="_blank" rel="noreferrer">{AI_SOURCE.title}<ArrowUpRight size={15} /></a>
      <small className="reference-note">Li et al. · IEEE TIE · 2026 · DOI {AI_SOURCE.doi}</small>
      <h3>Make it your own view.</h3>
      <div className="shortcut-grid"><span><kbd>E</kbd> Explode / assemble</span><span><kbd>X</kbd> Pull out selected part</span><span><kbd>I</kbd> Isolate selected part</span><span><kbd>H</kbd> Hide / show part</span><span><kbd>R</kbd> Reset assembly</span><span>Right-drag to pan</span></div>
      <p className="model-note">Hardware dimensions, routing and thermal interfaces are illustrative. AI applications are proposals: there are no trained models, sensor streams, performance predictions or validated safety, thermal or EMI results in this explorer.</p>
      <a href="https://www.ti.com/tool/TIDA-010054" target="_blank" rel="noreferrer">Read TI’s DAB topology reference<ArrowUpRight size={15} /></a>
      <small className="reference-note">A separate 10 kW reference design; this model does not reproduce it.</small>
      <div className="about-start-actions"><button onClick={onTour}>Explore the power path<ArrowUpRight size={16} /></button><button className="primary" onClick={onAI}>Explore AI opportunities<ArrowUpRight size={16} /></button></div>
    </section>
  </div>;
}
