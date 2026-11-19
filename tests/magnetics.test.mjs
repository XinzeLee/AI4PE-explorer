import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { buildAssembly, disposeAssembly } from '../src/geometry.js';

const originalDocument = globalThis.document;
before(() => {
  globalThis.document = { createElement() {
    const noop = () => {};
    const context = Object.fromEntries(['fillRect','strokeRect','fillText','beginPath','moveTo','lineTo','stroke','arc','fill'].map(key => [key,noop]));
    return { width:0, height:0, getContext:() => context };
  } };
});
after(() => {
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
});
const withAssembly = check => {
  const assembly = buildAssembly();
  try { assembly.root.updateMatrixWorld(true); return check(assembly); }
  finally { disposeAssembly(assembly.root); }
};
const named = (part, pattern) => {
  const meshes = [];
  part.visual.traverse(node => { if (node.isMesh && pattern.test(node.name)) meshes.push(node); });
  return meshes;
};
function vertices(mesh, visit) {
  const position = mesh.geometry.getAttribute('position');
  mesh.updateMatrix();
  for (let index=0;index<position.count;index++) visit(new THREE.Vector3().fromBufferAttribute(position,index).applyMatrix4(mesh.matrix));
}

test('toroid turns wrap the core cross-section and have tangent normals all around the ring', () => withAssembly(({ parts }) => {
  for (const id of ['L1','LCM1']) {
    const part = parts.get(id);
    const core = named(part,/toroidal core$/)[0];
    const { radius, tube } = core.geometry.parameters;
    const turns = named(part,/ winding(?: [AB])? turn /);
    assert.ok(turns.length >= 24);
    for (const turn of turns) {
      const radial = turn.position.clone().sub(core.position).normalize();
      const tangent = new THREE.Vector3(-radial.y,radial.x,0);
      const normal = new THREE.Vector3(0,0,1).applyQuaternion(turn.quaternion);
      assert.ok(normal.dot(tangent) > .99999, `${turn.name} is not in a radial/axial plane`);
      // Actual surface vertices stay outside the ferrite tube. This catches
      // an apparently circular coil whose wrong orientation cuts the core.
      vertices(turn, point => {
        point.sub(core.position);
        const distance = Math.hypot(Math.hypot(point.x,point.y)-radius,point.z);
        assert.ok(distance >= tube+.009, `${turn.name} penetrates the ferrite`);
      });
    }
  }
}));

test('the common-mode choke has separate winding sectors, four terminals and leads clear of its core', () => withAssembly(({ parts }) => {
  const part = parts.get('LCM1');
  const a = named(part,/LCM1 winding A turn /), b = named(part,/LCM1 winding B turn /);
  assert.ok(a.length > 1 && b.length > 1);
  assert.notEqual(a[0].material.color.getHex(),b[0].material.color.getHex());
  assert.ok(a.every(turn => turn.position.x > 0), 'Winding A crosses into the other winding sector');
  assert.ok(b.every(turn => turn.position.x < 0), 'Winding B crosses into the other winding sector');
  for (const turns of [a,b]) assert.ok(turns.every(turn => turn.geometry.parameters.arc < Math.PI*2), 'A winding turn is an isolated closed ring');
  assert.equal(named(part,/inter-turn connection/).length,a.length+b.length-2);
  assert.equal(named(part,/^LCM1 board pin /).length,4);
  assert.equal(named(parts.get('L1'),/^L1 board pin /).length,2);
  const core = named(part,/shared toroidal core$/)[0];
  for (const lead of named(part,/inter-turn connection|winding board lead/)) vertices(lead,point => {
    point.sub(core.position);
    assert.ok(Math.hypot(Math.hypot(point.x,point.y)-.4,point.z) > .16, `${lead.name} crosses the ferrite`);
  });
}));

test('transformer sections surround a centered insulated core and their leads clear the ferrite frame', () => withAssembly(({ parts }) => {
  const part = parts.get('T1');
  const center = named(part,/ferrite center leg$/)[0];
  assert.equal(center.position.x,0); assert.equal(center.position.z,0);
  const primary = named(part,/^T1 primary winding$/)[0], secondary = named(part,/^T1 secondary winding$/)[0];
  assert.ok(primary && secondary);
  assert.ok(new THREE.Box3().setFromObject(primary).max.y < new THREE.Box3().setFromObject(secondary).min.y, 'Transformer winding sections overlap');
  assert.ok(named(part,/bobbin sleeve/).length >= 4);
  assert.equal(named(part,/insulating bobbin flange/).length,3);
  const ferrites = named(part,/ferrite/).map(mesh => {
    mesh.geometry.computeBoundingBox();
    return mesh.geometry.boundingBox.clone().applyMatrix4(mesh.matrix);
  });
  for (const mesh of [...named(part,/^T1 (?:primary|secondary) winding$/), ...named(part,/^T1 (?:primary|secondary) lead /)]) {
    vertices(mesh,point => {
      for (const ferrite of ferrites) assert.ok(!ferrite.clone().expandByScalar(-.001).containsPoint(point), `${mesh.name} penetrates ferrite`);
    });
  }
  const envelope = new THREE.Box3().setFromObject(part.visual).getSize(new THREE.Vector3());
  assert.ok(envelope.x <= 2.64 && envelope.z <= 2.5 && envelope.y <= 2.21, 'Transformer no longer fits its reserved mechanical envelope');
}));

test('magnetic board pins enter their supporting boards and insulating feet reach the board surface', () => withAssembly(({ parts }) => {
  const mainTop = parts.get('PCB1').home.y+.065;
  const filterTop = parts.get('EMI1').home.y+.02+.075/2;
  for (const [id,boardTop] of [['T1',mainTop],['L1',mainTop],['LCM1',filterTop]]) {
    const part = parts.get(id), pins = named(part,/ board pin /);
    assert.equal(pins.length,id==='L1'?2:4);
    for (const pin of pins) {
      const box = new THREE.Box3().setFromObject(pin);
      assert.ok(box.min.y < boardTop && box.max.y > boardTop, `${pin.name} does not enter its PCB`);
    }
    const feet = named(part,id==='T1'?/terminal foot/:id==='L1'?/PCB support foot/:/insulating cradle/);
    for (const foot of feet) assert.ok(Math.abs(new THREE.Box3().setFromObject(foot).min.y-boardTop)<.006, `${foot.name} floats above its PCB`);
  }
}));
