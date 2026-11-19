import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { components } from '../src/data.js';
import { opportunitiesForPart } from '../src/aiData.js';
import { ConverterScene } from '../src/scene.js';
import { createRogowskiSensor, disposeRogowskiSensor } from '../src/rogowskiSensor.js';
import {
  applyStoryVisual, BASE_STORY_VISUAL, buildAssembly, cloneCanonicalAssembly,
  disposeAssembly, resetStoryVisual, sanitizeStoryVisual,
} from '../src/geometry.js';

// CPU geometry needs a canvas only to attach label/PCB textures. No DOM, image
// encoding, renderer or WebGL context is used by these tests.
const originalDocument = globalThis.document;
before(() => {
  globalThis.document = { createElement(tag) {
    assert.equal(tag, 'canvas');
    const noop = () => {};
    const context = Object.fromEntries(['fillRect', 'strokeRect', 'fillText', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'arc', 'fill'].map(key => [key, noop]));
    return { width: 0, height: 0, getContext: kind => { assert.equal(kind, '2d'); return context; } };
  } };
});
after(() => {
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
});

function withAssembly(check) {
  const assembly = buildAssembly();
  try { return check(assembly); } finally { disposeAssembly(assembly.root); }
}
const bounds = part => new THREE.Box3().setFromObject(part.group);
const allFactors = value => Object.fromEntries(Object.keys(BASE_STORY_VISUAL).map(key => [key, value]));
const approximately = (actual, expected) => Math.abs(actual - expected) < 1e-5;

function transforms(root) {
  const result = [];
  const visit = (node, path) => {
    result.push({ path, position: node.position.toArray(), scale: node.scale.toArray(), quaternion: node.quaternion.toArray(), visible: node.visible });
    node.children.forEach((child, index) => visit(child, `${path}/${index}`));
  };
  visit(root, 'root');
  return result;
}
function materialState(root) {
  const materials = new Set();
  root.traverse(node => { for (const material of Array.isArray(node.material) ? node.material : [node.material]) if (material) materials.add(material); });
  return [...materials].map(material => [material.uuid, material.color?.getHex(), material.metalness, material.roughness, material.opacity, material.map?.uuid]);
}

test('assembly has 31 unique selectable roots including two separately mapped busbars', () => withAssembly(({ root, parts }) => {
  const ids = root.children.map(node => node.userData.componentId);
  assert.equal(root.children.length, 31);
  assert.equal(parts.size, 31);
  assert.equal(new Set(ids).size, 31);
  assert.deepEqual(new Set(ids), new Set(components.map(part => part.id)));
  for (const id of ['BB1', 'BB2']) {
    const part = parts.get(id);
    assert.equal(part.group.parent, root);
    assert.equal(part.group.userData.componentId, id);
    assert.equal(part.data.type, 'busbar');
    assert.ok(part.group.name.startsWith(id));
    assert.ok(opportunitiesForPart(id).length, `${id} has no AI mapping`);
    let meshes = 0;
    part.visual.traverse(node => { if (node.isMesh) meshes++; });
    assert.ok(meshes > 0, `${id} is not physical geometry`);
  }
  assert.notEqual(parts.get('BB1').group, parts.get('BB2').group);

  // Regress the two old decorative strips that crossed the conceptual regions.
  let duplicateStrips = 0;
  parts.get('PCB1').visual.traverse(node => {
    assert.notEqual(node.userData.previewRole, 'busbar');
    if (!node.geometry) return;
    node.geometry.computeBoundingBox();
    const size = node.geometry.boundingBox.getSize(new THREE.Vector3());
    if (approximately(size.x, .28) && approximately(size.y, .022) && approximately(size.z, 3.3)) duplicateStrips++;
  });
  assert.equal(duplicateStrips, 0, 'PCB still contains the old decorative busbar strips');
}));

test('all rendered and exported mesh normals are finite unit vectors', () => withAssembly(({root}) => {
  root.traverse(mesh=>{
    const normals=mesh.geometry?.attributes.normal;if(!normals)return;
    for(let index=0;index<normals.count;index++) {
      const length=Math.hypot(normals.getX(index),normals.getY(index),normals.getZ(index));
      assert.ok(Number.isFinite(length)&&Math.abs(length-1)<1e-5,`${mesh.name||mesh.geometry.type} has an invalid shading normal`);
    }
  });
}));

test('preview extrema keep HV rails separate and the filter clear of rails and terminal', () => withAssembly(({ root, parts }) => {
  for (const factor of [.6, 1, 1.4]) {
    applyStoryVisual(parts, allFactors(factor));
    root.updateMatrixWorld(true);
    const positive = bounds(parts.get('BB1'));
    const negative = bounds(parts.get('BB2'));
    const transformer = bounds(parts.get('T1'));
    assert.ok(positive.max.x < negative.min.x, `HV rail pair overlaps at ${factor}`);
    assert.ok(negative.max.x < transformer.min.x, `HV rail pair reaches isolation region at ${factor}`);
    const board = bounds(parts.get('EMI1'));
    assert.ok(!board.intersectsBox(bounds(parts.get('J1'))), `Filter board overlaps HV terminal at ${factor}`);
    for (const id of ['EMI1', 'LCM1', 'CX1', 'CX2']) {
      const filter = bounds(parts.get(id));
      assert.ok(filter.max.x < positive.min.x, `${id} reaches HV rails at ${factor}`);
      if (id !== 'EMI1') assert.ok(filter.min.z >= board.min.z && filter.max.z <= board.max.z, `${id} leaves filter board at ${factor}`);
    }
  }
}));

test('candidate cues change inner hardware while preserving root homes and shared materials', () => withAssembly(({ root, parts }) => {
  const original = transforms(root);
  const materials = materialState(root);
  const homes = new Map([...parts].map(([id, part]) => [id, part.home.toArray()]));
  const baseplate = parts.get('HS1').visual.children[0];
  const baseplateTransform = [baseplate.position.toArray(), baseplate.scale.toArray()];
  for (const factor of [.6, 1.4]) {
    applyStoryVisual(parts, allFactors(factor));
    for (const [id, part] of parts) {
      assert.deepEqual(part.home.toArray(), homes.get(id), `${id} home changed`);
      assert.deepEqual(part.group.position.toArray(), homes.get(id), `${id} root moved`);
      assert.deepEqual(part.group.scale.toArray(), [1, 1, 1], `${id} root scaled`);
    }
    assert.equal(parts.get('Q1').previewNodes.find(node=>node.userData.previewRole==='device').scale.x, factor);
    assert.equal(parts.get('BB1').previewNodes.find(node=>node.userData.previewRole==='busbar').scale.x, factor);
    assert.equal(parts.get('BB2').previewNodes.find(node=>node.userData.previewRole==='busbar').scale.y, factor);
    const fins = parts.get('HS1').previewNodes.find(node => node.userData.previewRole === 'fins');
    assert.equal(fins.scale.y, factor);
    assert.equal(fins.position.y, .2, 'Fin top anchor moved away from baseplate');
    assert.deepEqual([baseplate.position.toArray(), baseplate.scale.toArray()], baseplateTransform);
    for (const id of ['EMI1', 'LCM1', 'CX1', 'CX2']) {
      assert.equal(parts.get(id).visual.scale.x, factor);
      assert.equal(parts.get(id).visual.scale.z, factor);
    }
    assert.notDeepEqual(transforms(root), original, 'Candidate preview did not change geometry');
    assert.deepEqual(materialState(root), materials, 'Preview mutated shared materials');
  }
  resetStoryVisual(root);
  assert.deepEqual(transforms(root), original, 'Visual reset failed to restore exact baseline');
}));

test('canonical export preparation removes preview/extraction/hiding without changing the live scene', () => withAssembly(({ root, parts }) => {
  const baseline = transforms(root);
  const scene = new THREE.Scene();
  const annotation = new THREE.Group(); annotation.name = 'Transient design coupling annotations';
  scene.add(root, annotation);
  applyStoryVisual(parts, allFactors(1.4));
  for (const [id, part] of parts) {
    part.group.position.add(part.offset);
    if (id === 'BB1' || id === 'HS1') part.group.visible = false;
  }
  const livePreview = transforms(root);
  const clone = cloneCanonicalAssembly(root, parts);
  assert.notEqual(clone, root);
  assert.equal(clone.children.length, 31);
  assert.deepEqual(transforms(clone), baseline, 'Export does not use canonical assembled baseline');
  assert.deepEqual(transforms(root), livePreview, 'Preparing export changed the live candidate');
  clone.traverse(node => {
    assert.notEqual(node.name, annotation.name, 'Scene annotation entered exported assembly');
    assert.equal(node.userData.previewRole, undefined, 'Preview metadata leaked into export');
  });
  assert.equal(scene.children.length, 2);
}));

test('invalid visual factors fall back safely and finite values remain bounded', () => {
  const values = sanitizeStoryVisual({ deviceScale: NaN, busbarWidth: -Infinity, busbarThickness: 5, sinkFinDepth: .1, filterScale: '1.2', edgeSpeed: 1.2 });
  assert.deepEqual(values, { deviceScale: 1, busbarWidth: 1, busbarThickness: 1.4, sinkFinDepth: .6, filterScale: 1, edgeSpeed: 1.2 });
});

const designGroups = [
  { id: 'semiconductor', partIds: Array.from({ length: 8 }, (_, index) => `Q${index + 1}`), anchorId: 'Q4', color: '#537c9e' },
  { id: 'magnetic', partIds: ['T1', 'L1'], anchorId: 'T1', color: '#bd763b' },
  { id: 'thermal', partIds: ['HS1'], anchorId: 'HS1', color: '#b46b44' },
  { id: 'emi', partIds: ['EMI1', 'LCM1', 'CX1', 'CX2'], anchorId: 'LCM1', color: '#8b7e3e' },
];
function cpuScene(root, parts) {
  const scene = Object.create(ConverterScene.prototype);
  Object.assign(scene, {
    root, parts, scene: new THREE.Scene(), host: { dataset: {}, clientWidth: 900 },
    designGroups, designActive: true, anchorRay: new THREE.Raycaster(),
    aiHighlights: new Map(), highlightedIds: designGroups.flatMap(group => group.partIds),
    highlightColor: '#ff0000', storyPreview: null, explosion: 0,
    camera: new THREE.PerspectiveCamera(34, 1.4, .1, 150),
    motionQuery: { matches: true },
  });
  scene.camera.position.set(10.8, 9.4, 13.9);
  scene.camera.lookAt(0, 0, 0); scene.camera.updateMatrixWorld();
  root.updateMatrixWorld(true);
  return scene;
}

test('design leaders project designated physical parts and exposed heatsink fins', () => withAssembly(({ root, parts }) => {
  const scene = cpuScene(root, parts);
  const maps = []; scene.onProjectedAnchors = anchors => maps.push(anchors);
  const anchors = scene.projectDesignAnchors();
  assert.deepEqual(Object.keys(anchors), designGroups.map(group => group.id));
  for (const group of designGroups) {
    const anchor = anchors[group.id];
    assert.equal(anchor.partId, group.anchorId);
    assert.equal(anchor.visible, true, `${group.id} anchor is not visible from the design view`);
    assert.ok(anchor.u > 0 && anchor.u < 1 && anchor.v > 0 && anchor.v < 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(anchor.u * 2 - 1, 1 - anchor.v * 2), scene.camera);
    assert.ok(ray.intersectObject(parts.get(group.anchorId).group, true).length, `${group.id} leader misses its designated physical part`);
  }
  const cooling = scene.designAttachment('HS1');
  assert.ok(cooling.z > 3.5 && cooling.y < 0, 'Cooling leader points into the PCB-covered center instead of exposed fins');
  scene.projectDesignAnchors();
  assert.equal(maps.length, 1, 'Unchanged projection emitted redundant callbacks');
  const oldU = anchors.magnetic.u;
  parts.get('T1').group.position.x += 1;
  root.updateMatrixWorld(true);
  assert.notEqual(scene.projectDesignAnchors().magnetic.u, oldU, 'Leader did not track its actual moving part');
  parts.get('LCM1').group.visible = false;
  assert.equal(scene.projectDesignAnchors().emi.visible, false, 'Hidden hardware retains a visible leader');
  scene.camera.lookAt(30, 0, -50); scene.camera.updateMatrixWorld();
  assert.ok(Object.values(scene.projectDesignAnchors()).every(anchor => !anchor.visible), 'Offscreen leaders remain visible');
  scene.camera.lookAt(40, 30, 40); scene.camera.updateMatrixWorld();
  assert.ok(Object.values(scene.projectDesignAnchors()).every(anchor => !anchor.visible), 'Behind-camera leaders remain visible');
  scene.designGroups = [];
  assert.deepEqual(scene.projectDesignAnchors(), {});
  assert.deepEqual(maps.at(-1), {}, 'Leaving design mode did not clear projected anchors');
}));

test('design highlights use distinct group colors and design camera framing preserves export geometry', () => withAssembly(({ root, parts }) => {
  const scene = cpuScene(root, parts);
  const baseline = transforms(root);
  try {
    scene.updateAIHighlights();
    const colors = JSON.parse(scene.host.dataset.highlightColors);
    for (const group of designGroups) for (const id of group.partIds) {
      assert.equal(colors[id], group.color);
      assert.equal(`#${scene.aiHighlights.get(id).material.color.getHexString()}`, group.color);
    }
    scene.controls = { target: new THREE.Vector3(1, 2, 3), update() {}, enableDamping: false, autoRotate: false };
    const snapshot = scene.captureView();
    scene.preset('iso');
    assert.deepEqual(scene.controls.target.toArray(), [0, 0, 0]);
    assert.equal(scene.cameraTween, null, 'Reduced-motion framing should complete immediately');
    scene.designActive = false; scene.designGroups = [];
    scene.restoreView(snapshot);
    assert.deepEqual(scene.camera.position.toArray(), snapshot.position);
    assert.deepEqual(scene.controls.target.toArray(), snapshot.target);
    assert.deepEqual(transforms(root), baseline, 'Overview highlighting/framing mutated physical geometry');
    assert.deepEqual(transforms(cloneCanonicalAssembly(root, parts)), baseline);
  } finally {
    for (const helper of scene.aiHighlights.values()) { helper.geometry.dispose(); helper.material.dispose(); }
  }
}));

test('top view keeps the board axes aligned and the full assembly inside desktop and portrait frames', () => withAssembly(({root,parts}) => {
  const scene=cpuScene(root,parts);scene.designActive=false;scene.designGroups=[];
  scene.controls={target:new THREE.Vector3(),autoRotate:false,enableDamping:false,update(){scene.camera.lookAt(this.target);scene.camera.updateMatrixWorld();}};
  for(const [width,aspect] of [[1200,1.65],[390,.65]]) {
    scene.host.clientWidth=width;scene.camera.aspect=aspect;scene.camera.updateProjectionMatrix();
    scene.preset('top',false);
    assert.equal(scene.camera.position.x,scene.controls.target.x,'Top view retains an off-axis roll');
    const right=new THREE.Vector3(1,0,0).transformDirection(scene.camera.matrixWorldInverse);
    assert.ok(right.x>.999,'The board X axis is not horizontal in top view');
    const bounds=new THREE.Box3().setFromObject(root);
    for(const x of[bounds.min.x,bounds.max.x])for(const y of[bounds.min.y,bounds.max.y])for(const z of[bounds.min.z,bounds.max.z]) {
      const point=new THREE.Vector3(x,y,z).project(scene.camera);
      assert.ok(Math.abs(point.x)<.98&&Math.abs(point.y)<.98,`Top view clips the assembly at aspect ${aspect}`);
    }
  }
}));

const controlGroups = [
  { id:'voltage', partIds:['J2'], anchorId:'J2', attachmentRole:'output-voltage', color:'#397ca4' },
  { id:'current', partIds:['J2'], anchorId:'J2', attachmentRole:'output-current', color:'#b57a28' },
  { id:'controller', partIds:['CTRL1'], anchorId:'CTRL1', attachmentRole:'control-card', color:'#8264b0' },
  { id:'drivers', partIds:['GD1','GD2','GD3','GD4'], anchorId:'GD3', color:'#168b6b' },
  { id:'power', partIds:Array.from({length:8},(_,i)=>`Q${i+1}`), anchorId:'Q6', color:'#71917d' },
];

test('story-only Rogowski sensor surrounds one output conductor and anchors its leader without entering export', () => withAssembly(({ root, parts }) => {
  const scene=cpuScene(root,parts),sensor=createRogowskiSensor();
  scene.currentSensor=sensor; scene.scene.add(sensor);
  parts.get('J2').group.getWorldPosition(sensor.position);
  parts.get('J2').group.getWorldQuaternion(sensor.quaternion);
  sensor.updateMatrixWorld(true);
  try {
    const conductor=sensor.getObjectByName('Single output conductor through sensing loop');
    const former=sensor.getObjectByName('Rogowski coil former');
    const winding=sensor.getObjectByName('Fine copper sensing winding');
    assert.ok(conductor?.isMesh&&former?.isMesh&&winding?.isMesh);
    assert.equal(sensor.parent,scene.scene);
    assert.equal(new THREE.Box3().setFromObject(sensor).isEmpty(),false);
    const cableBounds=new THREE.Box3().setFromObject(conductor);
    assert.ok(cableBounds.min.x < parts.get('J2').home.x+.4,'Cable does not reach the J2 barrel');
    assert.ok(cableBounds.max.x > parts.get('J2').home.x+1.5,'Cable does not pass through the coil');
    const point=scene.designAttachment('J2',controlGroups[1]);
    assert.ok(point.distanceTo(sensor.localToWorld(new THREE.Vector3(...sensor.userData.anchorLocal)))<1e-10);
    const canonical=cloneCanonicalAssembly(root,parts);
    assert.equal(canonical.children.length,31);
    assert.equal(canonical.getObjectByName(sensor.name),undefined);
    parts.get('J2').group.visible=false;
    assert.equal(scene.designAttachment('J2',controlGroups[1]),null);
  } finally {scene.scene.remove(sensor);disposeRogowskiSensor(sensor);}
}));

test('control roles attach distinct Vout/Iout markers to J2 and a visible CTRL1 surface', () => withAssembly(({ root, parts }) => {
  const scene=cpuScene(root,parts); scene.designGroups=controlGroups;
  const baseline=transforms(root);
  const anchors=scene.projectDesignAnchors();
  assert.deepEqual(Object.keys(anchors),controlGroups.map(group=>group.id));
  for(const group of controlGroups) {
    assert.equal(anchors[group.id].partId,group.anchorId);
    assert.equal(anchors[group.id].visible,true, `${group.id} control anchor is not visible in the default view`);
    assert.ok(anchors[group.id].u>=0&&anchors[group.id].u<=1&&anchors[group.id].v>=0&&anchors[group.id].v<=1);
  }
  assert.ok(Math.hypot(anchors.voltage.u-anchors.current.u,anchors.voltage.v-anchors.current.v)>.005, 'Voltage and current markers collapse onto one output point');
  const voltage=scene.designAttachment('J2',controlGroups[0]);
  const current=scene.designAttachment('J2',controlGroups[1]);
  assert.ok(voltage.distanceTo(current)>.3, 'Output markers do not use distinct terminal connection areas');
  assert.ok(voltage.y>parts.get('J2').home.y+.72&&current.y>parts.get('J2').home.y+.72, 'Output markers miss the top connection/screw surfaces');
  const explicit=scene.designAttachment('J2',{attachmentLocal:[0,.78,.24]});
  assert.ok(explicit.distanceTo(current)<1e-8, 'Explicit local attachment differs from the matching named role');
  assert.deepEqual(transforms(root),baseline,'Conceptual sensing anchors changed physical geometry');
  assert.deepEqual(transforms(cloneCanonicalAssembly(root,parts)),baseline);
  parts.get('J2').group.visible=false;
  const hidden=scene.projectDesignAnchors();
  assert.equal(hidden.voltage.visible,false); assert.equal(hidden.current.visible,false);
}));

test('switching design to control refreshes framing, colors and anchors without deactivating or altering export', () => withAssembly(({ root, parts }) => {
  const scene=cpuScene(root,parts);
  const baseline=transforms(root);
  Object.assign(scene,{
    hidden:new Set(),extracted:new Set(),isolated:null,rotate:false,
    storyKey:'',storyVisual:{...BASE_STORY_VISUAL},
    controls:{target:new THREE.Vector3(),enableDamping:false,autoRotate:false,update(){scene.camera.lookAt(this.target);scene.camera.updateMatrixWorld();}},
  });
  const maps=[];scene.onProjectedAnchors=anchors=>maps.push(anchors);
  try {
    scene.updateAIHighlights();
    scene.projectDesignAnchors();
    scene.camera.position.set(-10,7,-13);scene.camera.lookAt(0,0,0);scene.camera.updateMatrixWorld();
    scene.update({designGroups:controlGroups,highlightedIds:[...new Set(controlGroups.flatMap(group=>group.partIds))]});
    assert.equal(scene.designActive,true);
    assert.deepEqual(scene.controls.target.toArray(),[0,0,0]);
    assert.ok(scene.camera.position.x>0&&scene.camera.position.z>0,'Control entry retained the prior reverse orbit');
    assert.equal(scene.host.dataset.designGroups,'voltage current controller drivers power');
    const anchors=scene.projectDesignAnchors();
    assert.deepEqual(Object.keys(anchors),controlGroups.map(group=>group.id));
    assert.ok(!('magnetic' in maps.at(-1))&&!('thermal' in maps.at(-1))&&!('emi' in maps.at(-1)), 'Old design anchors survived the group switch');
    const colors=JSON.parse(scene.host.dataset.highlightColors);
    const groupColors=JSON.parse(scene.host.dataset.highlightGroupColors);
    assert.equal(colors.J2,controlGroups[0].color,'Shared terminal should retain first signal group outline color');
    for(const group of controlGroups)assert.equal(groupColors[group.id],group.color);
    for(const id of ['T1','L1','HS1','EMI1','LCM1','CX1','CX2'])assert.equal(scene.aiHighlights.has(id),false,`${id} retained stale design highlighting`);
    assert.deepEqual(transforms(root),baseline);
    assert.deepEqual(transforms(cloneCanonicalAssembly(root,parts)),baseline);
  } finally {
    for(const helper of scene.aiHighlights.values()){helper.geometry.dispose();helper.material.dispose();}
  }
}));

test('rapid design/control/design switching emits a fresh identical anchor map for the remounted overlay', () => withAssembly(({ root, parts }) => {
  const scene=cpuScene(root,parts);
  Object.assign(scene,{
    hidden:new Set(),extracted:new Set(),isolated:null,rotate:false,
    storyKey:'',storyVisual:{...BASE_STORY_VISUAL},
    controls:{target:new THREE.Vector3(),enableDamping:false,autoRotate:false,update(){scene.camera.lookAt(this.target);scene.camera.updateMatrixWorld();}},
  });
  const maps=[];scene.onProjectedAnchors=anchors=>maps.push(anchors);
  try {
    const initial=scene.projectDesignAnchors();
    assert.equal(maps.length,1);
    scene.update({designGroups:controlGroups,highlightedIds:[...new Set(controlGroups.flatMap(group=>group.partIds))]});
    // No intervening projection/frame: App has already remounted its overlay
    // and cleared the consumer map by the time we return to design.
    scene.update({designGroups,highlightedIds:designGroups.flatMap(group=>group.partIds)});
    const returned=scene.projectDesignAnchors();
    assert.deepEqual(returned,initial,'This regression requires unchanged final screen coordinates');
    assert.equal(maps.length,2,'Remounted overlay did not receive a fresh map');
    assert.deepEqual(maps.at(-1),initial);
    scene.projectDesignAnchors();
    assert.equal(maps.length,2,'Stable frames should still avoid redundant callbacks');
  } finally {
    for(const helper of scene.aiHighlights.values()){helper.geometry.dispose();helper.material.dispose();}
  }
}));

test('maintenance assessment adds one static scene outline, preserves sensing anchors and stays out of canonical export', () => withAssembly(({ root, parts }) => {
  const scene=cpuScene(root,parts);
  const baseline=transforms(root),materials=materialState(root);
  scene.designGroups=controlGroups.slice(0,2);
  scene.highlightedIds=['J2'];
  const maps=[];scene.onProjectedAnchors=anchors=>maps.push(anchors);
  try {
    scene.updateAIHighlights();
    const before=scene.projectDesignAnchors();
    scene.assessmentActive=false;scene.updateAssessmentOutline();
    assert.equal(scene.host.dataset.assessmentActive,'false');
    assert.ok(!scene.assessmentOutline,'Inactive assessment should not allocate a whole-assembly helper');

    scene.assessmentActive=true;scene.updateAssessmentOutline();
    const outline=scene.assessmentOutline;
    assert.equal(scene.host.dataset.assessmentActive,'true');
    assert.equal(outline.visible,true);
    assert.equal(outline.parent,scene.scene);
    assert.equal(outline.material.opacity,.28);
    assert.equal(scene.aiHighlights.size,1,'Assessment should not add a box for every physical part');
    const fullBounds=new THREE.Box3().setFromObject(root).expandByScalar(.12);
    assert.ok(outline.box.equals(fullBounds),'Assessment outline does not cover the complete assembly');
    assert.deepEqual(scene.projectDesignAnchors(),before,'Assessment changed physical sensing anchors');
    assert.equal(maps.length,1,'Static assessment caused redundant projection callbacks');
    assert.deepEqual(transforms(root),baseline);
    assert.deepEqual(materialState(root),materials);
    const canonical=cloneCanonicalAssembly(root,parts);
    assert.equal(canonical.children.length,31);
    assert.deepEqual(transforms(canonical),baseline);
    canonical.traverse(node=>assert.notEqual(node.name,outline.name,'Assessment helper leaked into exported root'));

    scene.assessmentActive=false;scene.updateAssessmentOutline();
    assert.equal(scene.assessmentOutline.visible,false);
    assert.equal(scene.host.dataset.assessmentActive,'false');
    scene.assessmentActive=true;scene.updateAssessmentOutline();
    assert.equal(scene.assessmentOutline,outline,'Toggling should reuse one whole-assembly helper');
    let geometryDisposed=false,materialDisposed=false;
    outline.geometry.addEventListener('dispose',()=>{geometryDisposed=true;});
    outline.material.addEventListener('dispose',()=>{materialDisposed=true;});
    scene.disposeAssessmentOutline();
    assert.equal(outline.parent,null);
    assert.ok(geometryDisposed&&materialDisposed,'Assessment helper resources were not disposed');
    scene.disposeAssessmentOutline();
  } finally {
    scene.disposeAssessmentOutline();
    for(const helper of scene.aiHighlights.values()){helper.geometry.dispose();helper.material.dispose();}
  }
}));
