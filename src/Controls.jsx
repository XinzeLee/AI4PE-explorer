import { Mouse, RotateCcw, RotateCw, Tag } from 'lucide-react';

export function Controls({ explosion, onExplosion, rotate, onRotate, labels, onLabels, view, onView, onReset, onFit }) {
  return <div className="bottom-controls">
    <div className="control-dock">
      <div className="explosion-control">
        <button className={!explosion ? 'active-text' : ''} onClick={() => onExplosion(0)}>Assembled</button>
        <input type="range" min="0" max="1" step="0.01" value={explosion}
          onChange={event => onExplosion(Number(event.target.value))}
          onPointerUp={onFit} onKeyUp={onFit} aria-label="Explode assembly"
          style={{ '--progress': `${explosion * 100}%` }} />
        <button className={explosion === 1 ? 'active-text' : ''} onClick={() => onExplosion(1)}>Exploded</button>
      </div>
      <span className="dock-divider" />
      <button className={`dock-button ${rotate ? 'active' : ''}`} onClick={onRotate} aria-pressed={rotate} title="Auto rotate"><RotateCw size={18} /><span>Rotate</span></button>
      <button className={`icon-button label-toggle ${labels ? 'active' : ''}`} onClick={onLabels} aria-pressed={labels} title="Toggle component labels" aria-label="Toggle component labels"><Tag size={17} /></button>
      <span className="dock-divider" />
      <div className="view-presets" aria-label="Camera views">
        {[['iso', '3D'], ['top', 'Top'], ['front', 'Front']].map(([id, name]) => <button key={id} className={view === id ? 'selected' : ''} onClick={() => onView(id)} aria-pressed={view === id}>{name}</button>)}
      </div>
      <button className="icon-button reset-button" onClick={onReset} title="Reset assembly (R)" aria-label="Reset assembly"><RotateCcw size={17} /></button>
    </div>
    <div className="orbit-hint"><Mouse size={16} /><span>Drag to orbit <i>·</i> Scroll to zoom <i>·</i> Click to inspect</span></div>
  </div>;
}
