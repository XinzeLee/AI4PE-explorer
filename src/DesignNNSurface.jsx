import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RotateCcw } from 'lucide-react';

const label = (text, position, scale = 1) => {
  const canvas = document.createElement('canvas'), context = canvas.getContext('2d');
  const font = '600 48px Arial'; context.font = font;
  canvas.width = Math.ceil(context.measureText(text).width) + 24; canvas.height = 76;
  context.font = font;
  context.textAlign = 'center'; context.textBaseline = 'middle';
  context.fillStyle = '#f8fbf4'; context.fillRect(0, 0, canvas.width, canvas.height);
  context.strokeStyle = '#d4ddcf'; context.lineWidth = 2; context.strokeRect(1, 1, canvas.width - 2, canvas.height - 2);
  context.fillStyle = '#243c2f'; context.fillText(text, canvas.width / 2, canvas.height / 2 + 1);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false, depthWrite: false, toneMapped: false }));
  const height = 1.05 * scale;
  sprite.position.set(...position); sprite.scale.set(height * canvas.width / canvas.height, height, 1); sprite.renderOrder = 2; return sprite;
};
const dispose = group => {
  if (!group) return;
  const geometries = new Set(), materials = new Set(), textures = new Set();
  group.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) {
      materials.add(material); if (material.map) textures.add(material.map);
    }
  });
  geometries.forEach(item => item.dispose()); materials.forEach(item => item.dispose()); textures.forEach(item => item.dispose());
};
const nearest = (values, selected) => values.reduce((best, value) => Math.abs(value - selected) < Math.abs(best - selected) ? value : best, values[0]);

/** Dedicated, event-driven renderer. Grid changes replace geometry, preserving the orbit. */
export default function DesignNNSurface({ rows, inputs, selectedInductance, xField, yField, min, max, onSelect }) {
  const host = useRef(null), api = useRef(null), select = useRef(onSelect);
  select.current = onSelect;
  const [error, setError] = useState('');
  useEffect(() => {
    const container = host.current;
    let renderer, controls, observer, chart, surface, marker, ring, slice, down, framingScale = 1;
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#f5f7f0');
    const camera = new THREE.PerspectiveCamera(38, 1, .1, 100);
    const render = () => renderer?.render(scene, camera);
    const reset = () => { framingScale = Math.max(1, 1.12 / camera.aspect); camera.position.set(12.8 * framingScale, 2.2 + 8.3 * framingScale, 14 * framingScale); controls.target.set(0, 2.2, 0); controls.update(); render(); };
    const point = row => new THREE.Vector3(
      (row[slice.xField.key] - slice.xField.min) / (slice.xField.max - slice.xField.min) * 8 - 4,
      1 + (row.inductanceNH - slice.min) / Math.max(1e-9, slice.max - slice.min) * 4.5,
      4 - (row[slice.yField.key] - slice.yField.min) / (slice.yField.max - slice.yField.min) * 8,
    );
    const updateSelection = (next, value) => {
      if (!slice || !marker) return;
      marker.position.copy(point({ ...next, inductanceNH: value })); ring.position.copy(marker.position); render();
    };
    const updateSlice = next => {
      const nextChart = new THREE.Group();
      slice = { ...next, xValues: [...new Set(next.rows.map(row => row[next.xField.key]))].sort((a, b) => a - b), yValues: [...new Set(next.rows.map(row => row[next.yField.key]))].sort((a, b) => a - b) };
      const positions = [], colors = [], indices = [];
      next.rows.forEach(row => {
        const p = point(row), t = Math.max(0, Math.min(1, (row.inductanceNH - next.min) / Math.max(1e-9, next.max - next.min)));
        const color = new THREE.Color().setHSL((174 - 131 * t) / 360, .4 + .1 * t, .29 + .4 * t, THREE.SRGBColorSpace);
        positions.push(p.x, p.y, p.z); colors.push(color.r, color.g, color.b);
      });
      const index = new Map(next.rows.map((row, i) => [`${row[next.xField.key]}:${row[next.yField.key]}`, i]));
      for (let x = 0; x < slice.xValues.length - 1; x++) for (let y = 0; y < slice.yValues.length - 1; y++) {
        const at = (a, b) => index.get(`${slice.xValues[a]}:${slice.yValues[b]}`);
        const a = at(x, y), b = at(x + 1, y), c = at(x, y + 1), d = at(x + 1, y + 1);
        if ([a, b, c, d].every(Number.isInteger)) indices.push(a, b, c, b, d, c);
      }
      const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.setIndex(indices);
      surface = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 }));
      surface.name = 'design-nn-response-surface'; nextChart.add(surface);
      nextChart.add(new THREE.LineSegments(new THREE.WireframeGeometry(geometry), new THREE.LineBasicMaterial({ color: '#335d43', transparent: true, opacity: .14 })));
      const axisPoints = [-4, 1, 4, 4, 1, 4, 4, 1, 4, 4, 1, -4, -4, 1, 4, -4, 5.7, 4];
      nextChart.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(axisPoints, 3)), new THREE.LineBasicMaterial({ color: '#859a7a' })));
      const gridPoints = [];
      for (let n = 0; n <= 4; n++) { const v = -4 + n * 2; gridPoints.push(v, .99, -4, v, .99, 4, -4, .99, v, 4, .99, v); }
      nextChart.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(gridPoints, 3)), new THREE.LineBasicMaterial({ color: '#dfe7d6' })));
      [0, .5, 1].forEach(t => {
        nextChart.add(label((next.xField.min + t * (next.xField.max - next.xField.min)).toFixed(2), [-4 + 8 * t, .1, 5.2], .68));
        nextChart.add(label((next.yField.min + t * (next.yField.max - next.yField.min)).toFixed(2), [5.2, .2, 4 - 8 * t], .68));
        nextChart.add(label((next.min + t * (next.max - next.min)).toFixed(2), [-4.9, 1 + t * 4.5, 4.45], .68));
      });
      nextChart.add(label(`${next.xField.symbol} (mm) →`, [0, -.8, 6.3], .85));
      nextChart.add(label(`${next.yField.symbol} (mm) →`, [6.3, -.6, -.2], .85));
      nextChart.add(label('L (nH) ↑', [-3.2, 7, 4.3], .9));
      marker = new THREE.Mesh(new THREE.SphereGeometry(.13, 16, 10), new THREE.MeshBasicMaterial({ color: '#234732', depthTest: false })); marker.name = 'design-selected-prediction'; marker.renderOrder = 4;
      ring = new THREE.Mesh(new THREE.SphereGeometry(.2, 16, 10), new THREE.MeshBasicMaterial({ color: '#fff', side: THREE.BackSide, depthTest: false })); ring.renderOrder = 3;
      nextChart.add(marker, ring);
      if (chart) { scene.remove(chart); dispose(chart); } chart = nextChart; scene.add(chart);
      updateSelection(next.inputs, next.selectedInductance);
    };
    const pointerDown = event => { down = [event.clientX, event.clientY]; };
    const pointerUp = event => {
      if (!down || !slice || !surface || Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect(), ray = new THREE.Raycaster();
      ray.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2), camera);
      const hit = ray.intersectObject(surface)[0]; down = null;
      if (!hit) return;
      const x = slice.xField.min + (hit.point.x + 4) / 8 * (slice.xField.max - slice.xField.min);
      const y = slice.yField.min + (4 - hit.point.z) / 8 * (slice.yField.max - slice.yField.min);
      select.current({ [slice.xField.key]: nearest(slice.xValues, x), [slice.yField.key]: nearest(slice.yValues, y) });
    };
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.domElement.setAttribute('aria-hidden', 'true'); container.appendChild(renderer.domElement);
      controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = false; controls.enablePan = false; controls.minDistance = 12; controls.maxDistance = 32; controls.maxPolarAngle = Math.PI * .49;
      controls.addEventListener('change', render); renderer.domElement.addEventListener('pointerdown', pointerDown); renderer.domElement.addEventListener('pointerup', pointerUp);
      observer = new ResizeObserver(() => {
        const width = container.clientWidth, height = container.clientHeight; if (!width || !height) return;
        camera.aspect = width / height;
        const nextScale = Math.max(1, 1.12 / camera.aspect);
        camera.position.sub(controls.target).multiplyScalar(nextScale / framingScale).add(controls.target); framingScale = nextScale;
        camera.updateProjectionMatrix(); renderer.setSize(width, height, false); render();
      });
      observer.observe(container); api.current = { updateSlice, updateSelection, reset }; reset(); setError('');
    } catch { setError('The 3D landscape could not be displayed. The heatmap, input controls and sample table remain available.'); }
    return () => {
      api.current = null; observer?.disconnect(); controls?.removeEventListener('change', render); controls?.dispose();
      renderer?.domElement.removeEventListener('pointerdown', pointerDown); renderer?.domElement.removeEventListener('pointerup', pointerUp);
      dispose(chart); renderer?.dispose(); renderer?.forceContextLoss(); renderer?.domElement.remove();
    };
  }, []);
  useEffect(() => { api.current?.updateSlice({ rows, inputs, selectedInductance, xField, yField, min, max }); }, [rows, xField, yField, min, max]); // Selection updates preserve the surface and orbit.
  useEffect(() => { api.current?.updateSelection(inputs, selectedInductance); }, [inputs, selectedInductance]);
  return <div className="design-response-surface"><div ref={host} className="design-response-canvas" role="img" aria-label={`Rotatable neural-network loop-inductance landscape. ${xField.name} increases rightward: ${xField.min} to ${xField.max} millimeters. ${yField.name} increases in depth: ${yField.min} to ${yField.max} millimeters. Loop inductance increases upward: ${min.toFixed(2)} to ${max.toFixed(2)} nanohenries. Use the input controls, heatmap or sample table for keyboard selection.`} /><button className="design-fit-button" onClick={() => api.current?.reset()}><RotateCcw size={12} />Reset plot camera</button><div className="design-surface-scales"><span><b>{xField.symbol} →</b> {xField.min} → {xField.max} mm</span><span><b>{yField.symbol} →</b> {yField.min} → {yField.max} mm</span><span><b>L ↑</b> {min.toFixed(2)} → {max.toFixed(2)} nH</span></div><p className={error ? 'design-viewer-error' : 'design-surface-hint'} role={error ? 'status' : undefined}>{error || 'Drag to orbit · Scroll to zoom · Click selects the nearest grid setting'}</p></div>;
}
