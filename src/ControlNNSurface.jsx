import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const valueColor = (value, min, max) => new THREE.Color().setHSL(.51 - .32 * Math.max(0, Math.min(1, (value - min) / Math.max(1e-9, max - min))), .48, .29 + .35 * (value - min) / Math.max(1e-9, max - min));

function label(text, position, size = 1.1) {
  const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 96;
  const context = canvas.getContext('2d');
  context.font = '500 48px Arial'; context.textAlign = 'center'; context.textBaseline = 'middle';
  // A small paper backing keeps axis text legible from every orbit angle.
  const textWidth = context.measureText(text).width;
  context.fillStyle = '#f8faf7'; context.fillRect(256 - textWidth / 2 - 9, 18, textWidth + 18, 60);
  context.fillStyle = '#314a3f'; context.fillText(text, 256, 48);
  const material = new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material); sprite.position.set(...position); sprite.scale.set(size * 4.3, size * .8, 1); return sprite;
}

/** A separate, on-demand renderer. It never shares the hardware viewer's scene. */
export function ControlNNSurface({ landscape, selected, onSelect, min, max }) {
  const host = useRef(null), api = useRef(null), onSelectRef = useRef(onSelect);
  const [error, setError] = useState('');
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!host.current || !landscape.length) return;
    const container = host.current;
    let renderer, controls, observer;
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#f8faf7');
    const point = row => new THREE.Vector3((row.D1 - .6) * 20 - 4, 1 + (row.stress - min) / Math.max(1e-9, max - min) * 4.5, 4 - (row.D2 - .6) * 20);
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.domElement.setAttribute('aria-hidden', 'true');
      container.appendChild(renderer.domElement);
      const camera = new THREE.PerspectiveCamera(38, 1, .1, 100); camera.position.set(12, 10, 14);
      controls = new OrbitControls(camera, renderer.domElement); controls.target.set(0, 2.3, 0); controls.enablePan = false;
      controls.minDistance = 13; controls.maxDistance = 32; controls.maxPolarAngle = Math.PI * .49; controls.enableDamping = false;
      const render = () => renderer.render(scene, camera);
      const geometry = new THREE.BufferGeometry(), positions = [], colors = [], indices = [];
      landscape.forEach(row => { const p = point(row), color = valueColor(row.stress, min, max); positions.push(p.x, p.y, p.z); colors.push(color.r, color.g, color.b); });
      // Lookup by input values: the runtime's row ordering is not a mesh contract.
      const index = new Map(landscape.map((row, i) => [`${row.D1.toFixed(2)}:${row.D2.toFixed(2)}`, i]));
      for (let a = 0; a < 20; a++) for (let b = 0; b < 20; b++) {
        const at = (i, j) => index.get(`${(.6 + i * .02).toFixed(2)}:${(.6 + j * .02).toFixed(2)}`);
        const i = at(a, b), j = at(a + 1, b), k = at(a, b + 1), l = at(a + 1, b + 1);
        if ([i, j, k, l].every(Number.isInteger)) indices.push(i, j, k, j, l, k);
      }
      geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3)); geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.setIndex(indices); geometry.computeVertexNormals();
      const surface = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })); scene.add(surface);
      const wire = new THREE.LineSegments(new THREE.WireframeGeometry(geometry), new THREE.LineBasicMaterial({ color: '#245b4c', transparent: true, opacity: .16 })); scene.add(wire);
      const axisPositions = [-4, 1, 4, 4, 1, 4, -4, 1, 4, -4, 1, -4, -4, 1, 4, -4, 5.7, 4];
      const axes = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(axisPositions, 3)), new THREE.LineBasicMaterial({ color: '#72887b' })); scene.add(axes);
      const gridPositions = [];
      for (let n = 0; n <= 4; n++) { const v = -4 + n * 2; gridPositions.push(v, .99, -4, v, .99, 4, -4, .99, v, 4, .99, v); }
      scene.add(new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(gridPositions, 3)), new THREE.LineBasicMaterial({ color: '#dce5dc' })));
      [.6, .8, 1].forEach(v => { scene.add(label(v.toFixed(2), [(v - .6) * 20 - 4, .45, 4.8], .75)); scene.add(label(v.toFixed(2), [-5.1, .45, 4 - (v - .6) * 20], .75)); });
      [min, (min + max) / 2, max].forEach(v => scene.add(label(v.toFixed(1), [-5.1, 1 + (v - min) / Math.max(1e-9, max - min) * 4.5, 4.45], .75)));
      scene.add(label('D1 →', [0, -.25, 5.9], 1)); scene.add(label('D2 →', [-6.7, .3, -.4], 1)); scene.add(label('ipk2pk ↑', [-4.2, 6.4, 4], 1));
      const marker = new THREE.Mesh(new THREE.SphereGeometry(.14, 18, 12), new THREE.MeshBasicMaterial({ color: '#172e27', depthTest: false })); marker.renderOrder = 4; scene.add(marker);
      const ring = new THREE.Mesh(new THREE.SphereGeometry(.21, 18, 12), new THREE.MeshBasicMaterial({ color: '#fff', side: THREE.BackSide, depthTest: false })); ring.renderOrder = 3; scene.add(ring);
      const updateSelection = value => { const row = landscape.find(item => Math.abs(item.D1 - value.D1) < .001 && Math.abs(item.D2 - value.D2) < .001); if (row) { marker.position.copy(point(row)); ring.position.copy(marker.position); } render(); };
      const raycaster = new THREE.Raycaster(); let down = null;
      const pointerDown = event => { down = { x: event.clientX, y: event.clientY }; };
      const pointerUp = event => {
        if (!down || Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5) return;
        const rect = renderer.domElement.getBoundingClientRect(); raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
        const hit = raycaster.intersectObject(surface)[0];
        if (hit) onSelectRef.current({ D1: Math.max(.6, Math.min(1, Number((.6 + Math.round((hit.point.x + 4) / 8 * 20) * .02).toFixed(2)))), D2: Math.max(.6, Math.min(1, Number((.6 + Math.round((4 - hit.point.z) / 8 * 20) * .02).toFixed(2)))) });
      };
      renderer.domElement.addEventListener('pointerdown', pointerDown); renderer.domElement.addEventListener('pointerup', pointerUp);
      controls.addEventListener('change', render);
      observer = new ResizeObserver(() => { const width = container.clientWidth, height = container.clientHeight; if (!width || !height) return; camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height, false); render(); }); observer.observe(container);
      api.current = { updateSelection, render }; updateSelection(selected); controls.update(); setError('');
      return () => {
        api.current = null; observer.disconnect(); controls.removeEventListener('change', render); controls.dispose(); renderer.domElement.removeEventListener('pointerdown', pointerDown); renderer.domElement.removeEventListener('pointerup', pointerUp);
        const geometries = new Set(), materials = new Set(), textures = new Set(); scene.traverse(object => { if (object.geometry) geometries.add(object.geometry); for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) { materials.add(material); if (material.map) textures.add(material.map); } });
        geometries.forEach(item => item.dispose()); textures.forEach(item => item.dispose()); materials.forEach(item => item.dispose()); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove();
      };
    } catch {
      observer?.disconnect(); controls?.dispose(); renderer?.dispose(); renderer?.domElement.remove(); setError('The 3D surface could not be displayed. The heatmap, predictions and sample table remain available.');
    }
  // Selection is updated independently so changing one input does not reset the orbit.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [landscape, min, max]);

  useEffect(() => { api.current?.updateSelection(selected); }, [selected]);
  return <div className="nn-surface-wrap"><div ref={host} className="nn-surface-host" role="img" aria-label={`Rotatable predicted current-stress surface. D1 and D2 range from 0.60 to 1.00. ipk2pk ranges from ${min.toFixed(2)} to ${max.toFixed(2)} source units. Use the input controls or sample table for keyboard selection.`} /><div className="nn-surface-axis-key" aria-label="Surface axis scales"><span><b>D1</b> 0.60 → 1.00</span><span><b>D2</b> 0.60 → 1.00</span><span><b>ipk2pk</b> {min.toFixed(2)} → {max.toFixed(2)} <small>source units</small></span></div>{error ? <p role="status" className="nn-surface-error">{error}</p> : <p className="nn-surface-hint">Drag to orbit · Scroll to zoom · Click the surface to select</p>}</div>;
}
