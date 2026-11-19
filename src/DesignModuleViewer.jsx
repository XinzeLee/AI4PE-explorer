import { useEffect, useId, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { Box, Move, RotateCcw, Scan } from 'lucide-react';
import { makeDesignWirePoints, resolveDesignEndpoint } from './designNN';

export const DESIGN_NET_COLORS = {
  DC_MINUS: '#ba6c4b', SW: '#c79751', GATE_LOW: '#79a28a',
  GATE_HIGH: '#6b94ac', DC_PLUS: '#cd8c67', FLOATING_BACKPLANE: '#b98459',
};
const NET_NAMES = { DC_MINUS: 'DC−', SW: 'Switch node', GATE_LOW: 'Low gate', GATE_HIGH: 'High gate', DC_PLUS: 'DC+' };
const topRegions = design => design.regions.filter(region => design.layers.find(layer => layer.id === region.layer)?.patterned !== false);
const format = value => Number(value).toFixed(3);

function disposeGroup(group) {
  if (!group) return;
  const geometries = new Set(), materials = new Set(), textures = new Set();
  group.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : object.material ? [object.material] : []) {
      materials.add(material);
      if (material.map) textures.add(material.map);
    }
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
  textures.forEach(texture => texture.dispose());
}

function makeModule(design) {
  const group = new THREE.Group(), [width, height] = design.board_mm;
  const layers = new Map(design.layers.map(layer => [layer.id, layer]));
  const regions = new Map(design.regions.map(region => [region.id, region]));
  const point = ([x, y, z]) => new THREE.Vector3(x - width / 2, z, height / 2 - y);
  const material = (color, metallic = false) => new THREE.MeshStandardMaterial({ color, metalness: metallic ? .55 : .08, roughness: metallic ? .38 : .7 });
  const copper = new Map(Object.entries(DESIGN_NET_COLORS).map(([net, color]) => [net, material(color, true)]));
  const ceramic = material('#e7e6dc'), dieMaterial = material('#36434b'), leadMaterial = material('#c7cdce', true);
  const padMaterial = material('#acb9c1', true), wireMaterial = material('#c5cbd1', true);
  function box(name, rect, bottom, thickness, mat, description) {
    const [x, y, w, h] = rect;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, thickness, h), mat);
    mesh.position.copy(point([x + w / 2, y + h / 2, bottom + thickness / 2]));
    mesh.name = name; mesh.userData.description = description || name; group.add(mesh);
    const outline = new THREE.LineSegments(new THREE.EdgesGeometry(mesh.geometry), new THREE.LineBasicMaterial({ color: '#34433f', transparent: true, opacity: .2 }));
    outline.position.copy(mesh.position); group.add(outline);
    return mesh;
  }
  const back = design.layers.find(layer => layer.patterned === false);
  const top = design.layers.find(layer => layer.patterned !== false);
  const ceramicBottom = back ? back.z_mm + back.thickness_mm : 0;
  if (top.z_mm > ceramicBottom) box('Ceramic', [0, 0, width, height], ceramicBottom, top.z_mm - ceramicBottom, ceramic, 'Ceramic · 0.835 mm gap between copper layers');
  for (const region of design.regions) {
    const layer = layers.get(region.layer);
    box(region.id, region.rect_mm, layer.z_mm, layer.thickness_mm, copper.get(region.net) || copper.get('SW'), `${region.id} · ${region.net} · ${region.rect_mm[2]} × ${region.rect_mm[3]} mm`);
  }
  for (const component of design.components) {
    const layer = layers.get(regions.get(component.parent).layer), bottom = layer.z_mm + layer.thickness_mm;
    box(component.id, component.rect_mm, bottom, component.height_mm, component.kind === 'die' ? dieMaterial : leadMaterial,
      `${component.id} · ${component.kind} · on ${component.parent}`);
    if (component.kind === 'die') for (const pin of component.pins.filter(pin => !pin.contact_region)) {
      const endpoint = resolveDesignEndpoint(design, `${component.id}.${pin.id}`);
      const p = Array.isArray(endpoint) ? endpoint : endpoint.point;
      box(`${component.id}.${pin.id}`, [p[0] - pin.pad_mm[0] / 2, p[1] - pin.pad_mm[1] / 2, ...pin.pad_mm], p[2], .008, padMaterial, `${component.id}.${pin.id} · bond pad`);
    }
  }
  for (const terminal of design.terminals) {
    const endpoint = resolveDesignEndpoint(design, terminal.id), p = Array.isArray(endpoint) ? endpoint : endpoint.point;
    const layer = layers.get(regions.get(terminal.region)?.layer);
    box(terminal.id, [p[0] - terminal.pad_mm[0] / 2, p[1] - terminal.pad_mm[1] / 2, ...terminal.pad_mm], (layer?.z_mm || p[2]) + (layer?.thickness_mm || 0) + .003, .008, padMaterial, `${terminal.id} · landing on ${terminal.region}`);
  }
  for (const wire of [...design.bond_wires, ...(design.paths || [])]) {
    const points = makeDesignWirePoints(design, wire).map(point);
    for (let index = 1; index < points.length; index++) {
      const delta = points[index].clone().sub(points[index - 1]), length = delta.length();
      if (!length) continue;
      const mesh = new THREE.Mesh(new THREE.CylinderGeometry(wire.diameter_mm / 2, wire.diameter_mm / 2, length, 8), wireMaterial);
      mesh.position.copy(points[index]).add(points[index - 1]).multiplyScalar(.5);
      mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), delta.normalize());
      mesh.name = `${wire.id}:${index}`; mesh.userData.description = `${wire.id} · ${wire.source} → ${wire.target} · Ø${wire.diameter_mm} mm`;
      group.add(mesh);
    }
  }
  return group;
}

function Module3D({ design }) {
  const host = useRef(null), api = useRef(null), firstGeometry = useRef(true);
  const [error, setError] = useState(''), [inspection, setInspection] = useState('Drag to orbit · Scroll to zoom · Select a part to identify it');
  useEffect(() => {
    const container = host.current;
    let renderer, controls, observer, module;
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#f3f5ef');
    const camera = new THREE.PerspectiveCamera(35, 1, .05, 700);
    const fit = () => { camera.position.set(62, 74, 71); controls.target.set(0, .8, 0); controls.update(); render(); };
    const render = () => renderer?.render(scene, camera);
    const update = next => {
      const replacement = makeModule(next);
      if (module) { scene.remove(module); disposeGroup(module); }
      module = replacement; scene.add(module); render();
    };
    const raycaster = new THREE.Raycaster(); let down;
    const pointerDown = event => { down = [event.clientX, event.clientY]; };
    const pointerUp = event => {
      if (!down || Math.hypot(event.clientX - down[0], event.clientY - down[1]) > 5) return;
      const rect = renderer.domElement.getBoundingClientRect();
      raycaster.setFromCamera(new THREE.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2), camera);
      const hit = raycaster.intersectObject(module).find(item => item.object.userData.description);
      if (hit) setInspection(hit.object.userData.description);
      down = null;
    };
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2)); renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.domElement.setAttribute('aria-hidden', 'true'); container.appendChild(renderer.domElement);
      scene.add(new THREE.HemisphereLight('#ffffff', '#8e9a87', 2.6));
      const key = new THREE.DirectionalLight('#ffffff', 3); key.position.set(-25, 75, 30); scene.add(key);
      controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = false;
      controls.minDistance = 24; controls.maxDistance = 200; controls.maxPolarAngle = Math.PI * .85;
      controls.addEventListener('change', render);
      renderer.domElement.addEventListener('pointerdown', pointerDown); renderer.domElement.addEventListener('pointerup', pointerUp);
      observer = new ResizeObserver(() => {
        const width = container.clientWidth, height = container.clientHeight;
        if (!width || !height) return;
        camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height, false); render();
      });
      observer.observe(container); api.current = { update, fit }; fit(); setError('');
    } catch {
      setError('The 3D module could not be displayed. Open the dimensioned top view to inspect the same geometry.');
    }
    return () => {
      api.current = null; observer?.disconnect();
      controls?.removeEventListener('change', render); controls?.dispose();
      renderer?.domElement.removeEventListener('pointerdown', pointerDown); renderer?.domElement.removeEventListener('pointerup', pointerUp);
      disposeGroup(module); renderer?.dispose(); renderer?.forceContextLoss(); renderer?.domElement.remove();
    };
  // Keep the orbit while input changes rebuild only the module geometry.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => { if (api.current) { api.current.update(design); if (firstGeometry.current) firstGeometry.current = false; else setInspection('Geometry updated · Orbit is preserved'); } }, [design]);
  return <div className="design-module-3d"><div ref={host} className="design-module-canvas" role="img" aria-label="Rotatable 45 by 50 millimeter DBC power module. Copper, ceramic, four dies, five leads and eight bond wires preserve source dimensions. A dimensioned top view provides a keyboard accessible alternative." />
    <button className="design-fit-button" onClick={() => api.current?.fit()} aria-label="Reset module camera"><RotateCcw size={13} />Reset camera</button>
    {error ? <p className="design-viewer-error" role="status">{error}</p> : <p className="design-module-inspection" aria-live="polite">{inspection}</p>}
  </div>;
}

export function DesignModulePlan({ design, inputs }) {
  const id = useId().replace(/:/g, ''), [width, height] = design.board_mm;
  const y = value => height - value;
  const regions = topRegions(design);
  const bar = regions.find(region => region.id === 'T1').rect_mm, shelf = regions.find(region => region.id === 'T2').rect_mm;
  const fourInputs = Number.isFinite(inputs.barHeight), barHeight = inputs.barHeight ?? bar[3], dieOffset = inputs.dieOffset ?? 0;
  const gapBottom = bar[1] + bar[3], gapTop = shelf[1];
  return <figure className="design-module-plan"><svg viewBox="-8 -8 63 66" role="img" aria-labelledby={`${id}-title ${id}-desc`}>
    <title id={`${id}-title`}>Dimensioned source module layout</title><desc id={`${id}-desc`}>A 45 by 50 millimeter DBC substrate. T3 spine width w is {format(inputs.spineWidth)} millimeters. Gap g from T1 to T2 is {format(inputs.gap)} millimeters. {fourInputs ? `In-plane T1 bar height h is ${format(barHeight)} millimeters. D1 and D2 are translated together horizontally by ${format(dieOffset)} millimeters relative to the source; their spacing stays fixed. Height h is not the 0.2 millimeter copper thickness.` : ''} Copper, die and lead footprints, and bond-wire landing coordinates follow the source geometry mapping.</desc>
    <defs><marker id={`${id}-arrow`} markerWidth="3" markerHeight="3" refX="1.5" refY="1.5" orient="auto-start-reverse"><path d="M0 0L3 1.5L0 3" fill="none" stroke="currentColor" strokeWidth=".5" /></marker></defs>
    <rect x="0" y="0" width={width} height={height} rx=".35" fill="#edeee5" stroke="#9ca993" strokeWidth=".2" />
    {regions.map(region => { const [x, bottom, w, h] = region.rect_mm; const shortNet = { DC_MINUS: 'DC−', DC_PLUS: 'DC+', SW: 'SW', GATE_LOW: 'G_LO', GATE_HIGH: 'G_HI' }[region.net] || region.net; return <g key={region.id}><rect x={x} y={y(bottom + h)} width={w} height={h} fill={DESIGN_NET_COLORS[region.net]} stroke="#725d3e" strokeWidth=".1" /><text x={x + .55} y={y(bottom + h) + 1.8} className="design-plan-region-label">{region.id}<tspan className="design-plan-net-label"> · {shortNet}</tspan></text></g>; })}
    {design.components.map(component => { const [x, bottom, w, h] = component.rect_mm, small = w < 2; return <g key={component.id}><rect x={x} y={y(bottom + h)} width={w} height={h} fill={component.kind === 'die' ? '#344751' : '#c3cbca'} stroke={component.kind === 'die' ? '#f1f4ee' : '#71817a'} strokeWidth=".12" />{component.kind === 'die' ? component.pins.filter(pin => !pin.contact_region).map(pin => <rect key={pin.id} x={x + pin.offset_mm[0] - pin.pad_mm[0] / 2} y={y(bottom + pin.offset_mm[1] + pin.pad_mm[1] / 2)} width={pin.pad_mm[0]} height={pin.pad_mm[1]} fill={pin.id === 'G' ? '#e8edf1' : '#91a6b1'} stroke="#c4d1d7" strokeWidth=".07" />) : null}<text x={small ? x + w + .5 : x + w / 2} y={y(bottom + h / 2) + .5} textAnchor={small ? 'start' : 'middle'} className={`design-plan-part-label ${component.kind === 'die' ? 'is-die' : ''}`}>{component.id}</text></g>; })}
    {[...design.bond_wires, ...(design.paths || [])].map(wire => <polyline key={wire.id} points={makeDesignWirePoints(design, wire).map(point => `${point[0]},${y(point[1])}`).join(' ')} fill="none" stroke="#eef2f1" strokeWidth={Math.max(.15, wire.diameter_mm)} />)}
    <g className="design-plan-dimensions" style={{ color: '#397d68' }}><path d={`M${42 - inputs.spineWidth} -1V-5M42 -1V-5M${42 - inputs.spineWidth} -3H42`} /><path d={`M${42 - inputs.spineWidth} -3H42`} markerStart={`url(#${id}-arrow)`} markerEnd={`url(#${id}-arrow)`} /><text x={42 - inputs.spineWidth / 2} y="-4.2" textAnchor="middle">w = {format(inputs.spineWidth)} mm</text><path d={`M0 ${y(gapBottom)}H-4M0 ${y(gapTop)}H-4M-2 ${y(gapBottom)}V${y(gapTop)}`} /><path d={`M-2 ${y((gapBottom + gapTop) / 2)}H-5V37`} /><text x="-5" y="35.5" textAnchor="middle">g</text>{fourInputs ? <><path d={`M43 ${y(bar[1])}H49M43 ${y(gapBottom)}H49M47 ${y(bar[1])}V${y(gapBottom)}`} /><path d={`M47 ${y(bar[1])}V${y(gapBottom)}`} markerStart={`url(#${id}-arrow)`} markerEnd={`url(#${id}-arrow)`} /><text x="50" y={y(bar[1] + barHeight / 2) + .5}>h</text><path d={`M8 51V55M${8 + dieOffset} 51V55M8 53H${8 + dieOffset}`} /><path d={`M${8 + dieOffset / 2} 53L12 55`} /><text x="14" y="55.5">Δx</text></> : <text x="22.5" y="54">45 × 50 mm · g = {format(inputs.gap)} mm</text>}</g>
    <g className="design-plan-loop-points">{[design.loop.source, design.loop.sink].map((ref, i) => { const endpoint = resolveDesignEndpoint(design, ref), p = Array.isArray(endpoint) ? endpoint : endpoint.point; return <g key={ref}><circle cx={p[0]} cy={y(p[1])} r=".6" fill={i ? '#397ba3' : '#9e5142'} stroke="white" strokeWidth=".15" /><text x={p[0] + 1} y={y(p[1]) + 1.7}>{ref}</text></g>; })}</g>
  </svg>{fourInputs ? <div className="design-plan-parameter-key" aria-label="Four geometry dimensions in millimeters"><span><b>w</b>{format(inputs.spineWidth)} mm</span><span><b>g</b>{format(inputs.gap)} mm</span><span><b>h</b>{format(barHeight)} mm</span><span><b>Δx</b>{format(dieOffset)} mm</span></div> : null}<figcaption>{fourInputs ? 'h is in plane · Δx moves the low die pair · Cu thickness 0.2 mm' : 'Top view · dimensions in mm · wire paths project straight onto the layout'}</figcaption></figure>;
}

export default function DesignModuleViewer({ design, inputs }) {
  const [view, setView] = useState('3d'), id = useId();
  const tabs = [{ id: '3d', label: '3D module', icon: Box }, { id: 'plan', label: 'Dimensioned top view', icon: Scan }];
  function keydown(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? '3d' : event.key === 'End' ? 'plan' : view === '3d' ? 'plan' : '3d';
    setView(next); document.getElementById(`${id}-${next}`)?.focus();
  }
  return <section className="design-module-viewer" aria-label="Source power-module geometry"><div className="design-card-heading"><div><span className="design-step">01 / THE LAYOUT</span><h2>A small change in copper.</h2></div><span className="design-dimension-badge">45 × 50 mm</span></div>
    <div className="design-view-tabs" role="tablist" aria-label="Geometry view">{tabs.map(tab => <button key={tab.id} id={`${id}-${tab.id}`} role="tab" aria-selected={view === tab.id} aria-controls={`${id}-panel`} tabIndex={view === tab.id ? 0 : -1} onClick={() => setView(tab.id)} onKeyDown={keydown}><tab.icon size={13} />{tab.label}</button>)}</div>
    <div id={`${id}-panel`} role="tabpanel" aria-labelledby={`${id}-${view}`} className="design-geometry-panel">{view === '3d' ? <Module3D design={design} /> : <DesignModulePlan design={design} inputs={inputs} />}</div>
    <div className="design-module-legend" aria-label="Illustrative net colors">{Object.entries(NET_NAMES).map(([net, name]) => <span key={net}><i style={{ background: DESIGN_NET_COLORS[net] }} />{name}</span>)}<span><i style={{ background: '#36434b' }} />Dies</span></div>
    <p className="design-geometry-note"><Move size={12} />Source dimensions and wire profiles · net colors aid identification</p>
  </section>;
}
