import { ProjectCredit } from './ProjectCredit';
import { useEffect, useRef } from 'react';
import { ArrowUpRight, X } from 'lucide-react';

export function AboutDialog({ onClose, onTour }) {
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
      <h2 id="about-title">A closer look at conversion.</h2>
      <p>This conceptual 3 kW dual active bridge (DAB) links a 400 V DC bus and a 48 V DC bus through a high-frequency transformer.</p>
      <div className="about-diagram"><span>400 V<br /><b>HV bridge</b></span><span>↔</span><span>Transfer L<br /><b>Transformer</b></span><span>↔</span><span>48 V<br /><b>LV bridge</b></span></div>
      <p>Four dual-channel driver boards represent eight gate channels. A separate control card coordinates switching.</p>
      <p>The switch banks sit on separate mounting rails with insulating pads between their metal tabs and the heatsink. Bent leads return to the PCB beneath the rails. The transformer has two winding sections, and the common-mode choke has two windings and four terminals.</p>
      <h3>From physical parts to AI applications.</h3>
      <p>Explore how neural networks can support converter design, control and maintenance using the three workflows in the main navigation.</p>
      <h3>Make it your own view.</h3>
      <div className="shortcut-grid"><span><kbd>E</kbd> Explode / assemble</span><span><kbd>X</kbd> Pull out selected part</span><span><kbd>I</kbd> Isolate selected part</span><span><kbd>H</kbd> Hide / show part</span><span><kbd>R</kbd> Reset assembly</span><span>Right-drag to pan</span></div>
      <p className="model-note">Hardware dimensions, routing and thermal interfaces are illustrative. Design shows an optimization workflow; control shows NN feedback and triple-phase-shift bridge-voltage waveforms. Maintenance shows signal inputs, three NN heads and an inspection/service recommendation. The Design NN card opens a four-input geometry-to-inductance playground based on a separate PowerSynth module, with a network figure and 2D/3D response views. The Control NN card opens a separate ECCE2025 modulation playground with fixed trained models and simulation references. The Maintenance NN card opens an IGBT remaining-life playground with a recurrent-network figure, recorded waveforms, mean estimates and 90% prediction intervals.</p>
      <h3>Creator and neural-network resources.</h3>
      <ProjectCredit />
      <div className="about-start-actions"><button onClick={onTour}>Explore the power path<ArrowUpRight size={16} /></button></div>
    </section>
  </div>;
}
