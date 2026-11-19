import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { applyStoryVisual, BASE_STORY_VISUAL, buildAssembly, disposeAssembly } from '../src/geometry.js';

// Placement checks run against actual mesh transforms without a renderer.
const originalDocument = globalThis.document;
before(() => {
  globalThis.document = { createElement(tag) {
    assert.equal(tag, 'canvas');
    const noop = () => {};
    const context = Object.fromEntries(['fillRect', 'strokeRect', 'fillText', 'beginPath', 'moveTo', 'lineTo', 'stroke', 'arc', 'fill'].map(key => [key, noop]));
    return { width: 0, height: 0, getContext: () => context };
  } };
});
after(() => {
  if (originalDocument === undefined) delete globalThis.document;
  else globalThis.document = originalDocument;
});

const EPSILON = 1e-5;
const qIds = Array.from({ length: 8 }, (_, index) => `Q${index + 1}`);
const driverIds = Array.from({ length: 4 }, (_, index) => `GD${index + 1}`);
const bounds = object => new THREE.Box3().setFromObject(object.group ?? object);
const named = (part, name) => {
  const matches = [];
  part.visual.traverse(node => { if (node.name === name) matches.push(node); });
  assert.ok(matches.length, `${part.data.id} is missing ${name}`);
  return matches;
};
const one = (part, name) => {
  const matches = named(part, name);
  assert.equal(matches.length, 1, `${part.data.id} has duplicate ${name}`);
  return matches[0];
};
const overlap = (a, b, axis) => Math.min(a.max[axis], b.max[axis]) - Math.max(a.min[axis], b.min[axis]);
const solidOverlap = (a, b) => ['x', 'y', 'z'].every(axis => overlap(a, b, axis) > EPSILON);
function close(actual, expected, message) {
  assert.ok(Math.abs(actual - expected) < EPSILON, `${message}: ${actual} versus ${expected}`);
}
function withAssembly(check) {
  const assembly = buildAssembly();
  assembly.root.updateMatrixWorld(true);
  try { return check(assembly); } finally { disposeAssembly(assembly.root); }
}
function forEachPreview(assembly, check) {
  for (const factor of [.6, 1, 1.4]) {
    applyStoryVisual(assembly.parts, Object.fromEntries(Object.keys(BASE_STORY_VISUAL).map(key => [key, factor])));
    assembly.root.updateMatrixWorld(true);
    check(factor);
  }
}

test('terminals clear switch packages and driver boards at every preview size', () => withAssembly(assembly => {
  const { parts } = assembly;
  forEachPreview(assembly, factor => {
    for (const terminalId of ['J1', 'J2']) {
      const terminal = bounds(parts.get(terminalId));
      for (const otherId of [...qIds, ...driverIds]) {
        assert.ok(!solidOverlap(terminal, bounds(parts.get(otherId))), `${terminalId} overlaps ${otherId} at ${factor}`);
      }
    }
    for (let index = 1; index < qIds.length; index++) {
      assert.ok(bounds(parts.get(qIds[index - 1])).max.x < bounds(parts.get(qIds[index])).min.x,
        `${qIds[index - 1]} touches ${qIds[index]} at ${factor}`);
    }
  });
}));

test('each switch has a contacting package, tab, insulating pad and matching thermal rail', () => withAssembly(assembly => {
  const { parts } = assembly;
  const heatsink = parts.get('HS1');
  forEachPreview(assembly, factor => {
    for (const id of qIds) {
      const part = parts.get(id);
      const packageBox = bounds(one(part, 'Semiconductor package'));
      const tab = bounds(one(part, 'Drain heat-spreader tab'));
      const pad = bounds(one(part, 'Electrical isolation pad'));
      const rail = bounds(one(heatsink, `${part.data.side} mounting rail`));
      close(packageBox.min.z, tab.max.z, `${id} package loses its tab at ${factor}`);
      close(tab.min.z, pad.max.z, `${id} tab loses its insulating pad at ${factor}`);
      close(pad.min.z, rail.max.z, `${id} pad loses its rail at ${factor}`);
      for (const axis of ['x', 'y']) {
        assert.ok(overlap(packageBox, tab, axis) > .05, `${id} package/tab have no contact area on ${axis}`);
        assert.ok(overlap(tab, pad, axis) > .05, `${id} tab/pad have no contact area on ${axis}`);
        assert.ok(overlap(pad, rail, axis) > .05, `${id} pad/rail have no contact area on ${axis}`);
      }
      assert.ok(pad.min.x >= rail.min.x - EPSILON && pad.max.x <= rail.max.x + EPSILON,
        `${id} grows past its rail at ${factor}`);
      assert.ok(tab.min.z > rail.max.z + .02, `${id} metal tab bypasses its insulating layer`);
    }
  });
}));

test('raised thermal rails stay connected to the baseplate and clear returning leads', () => withAssembly(assembly => {
  const { parts } = assembly;
  const heatsink = parts.get('HS1');
  const plate = heatsink.visual.children[0];
  forEachPreview(assembly, factor => {
    const plateBox = bounds(plate);
    const shelf = bounds(one(heatsink, 'Front thermal shelf'));
    assert.ok(solidOverlap(plateBox, shelf), `Thermal shelf detaches from baseplate at ${factor}`);
    const rails = ['HV mounting rail', 'LV mounting rail'].map(name => bounds(one(heatsink, name)));
    const supports = named(heatsink, 'Thermal rail support').map(bounds);
    assert.ok(supports.length >= 4, 'Raised rails need supports on both bridges');
    for (const support of supports) {
      assert.ok(solidOverlap(support, shelf), `Rail support detaches from shelf at ${factor}`);
      assert.ok(rails.some(rail => solidOverlap(support, rail)), `Rail support detaches from upper rail at ${factor}`);
      assert.ok(support.min.z > 3.5, 'Thermal support passes through the main PCB');
    }
    for (const id of qIds) for (const lead of named(parts.get(id), 'Terminal lead')) {
      const leadBox = bounds(lead);
      for (const metal of [...rails, ...supports]) {
        assert.ok(!solidOverlap(leadBox, metal), `${id} lead touches thermal rail metal at ${factor}`);
      }
    }
    const fins = bounds(one(heatsink, 'Anchored heatsink fins'));
    assert.ok(fins.max.y > plateBox.min.y && fins.max.y < plateBox.max.y, `Fins detach from baseplate at ${factor}`);
    for (const ear of named(heatsink, 'Baseplate mounting ear')) {
      assert.ok(solidOverlap(bounds(ear), plateBox), `Mounting ear floats when fin depth is ${factor}`);
    }
  });
}));

test('through-board leads enter their mounting boards within the board outlines', () => withAssembly(assembly => {
  const { parts } = assembly;
  const mainBoard = bounds(one(parts.get('PCB1'), 'Drilled FR4 substrate'));
  const mainPins = [
    ...Array.from({ length: 6 }, (_, index) => [`C${index + 1}`, 'Capacitor lead', 2]),
    ...driverIds.map(id => [id, 'Driver header pin', 5]),
    ['CTRL1', 'Control connector pin', 20], ['J1', 'Terminal pin', 2], ['J2', 'Terminal pin', 2],
  ];
  const reachesBoard = (pin, board, label) => {
    const pinBox = bounds(pin);
    assert.ok(pinBox.min.y < board.min.y && pinBox.max.y > board.max.y, `${label} does not pass through its board`);
    for (const axis of ['x', 'z']) {
      assert.ok(pinBox.min[axis] >= board.min[axis] - EPSILON && pinBox.max[axis] <= board.max[axis] + EPSILON,
        `${label} lands outside the board on ${axis}`);
    }
  };
  forEachPreview(assembly, () => {
    for (const [id, name, count] of mainPins) {
      const pins = named(parts.get(id), name);
      assert.equal(pins.length, count, `${id} has an incorrect lead count`);
      pins.forEach(pin => reachesBoard(pin, mainBoard, `${id} ${name}`));
    }
    for (const id of qIds) {
      const landingLeads = named(parts.get(id), 'Terminal lead').filter(lead => bounds(lead).min.y < mainBoard.max.y);
      assert.equal(landingLeads.length, 3, `${id} does not have three leads returning to the board`);
      landingLeads.forEach(pin => reachesBoard(pin, mainBoard, `${id} bent lead`));
    }
    const filterBoard = bounds(parts.get('EMI1').visual.children[0]);
    for (const id of ['CX1', 'CX2']) for (const pin of named(parts.get(id), 'Film capacitor lead')) {
      reachesBoard(pin, filterBoard, `${id} filter-board lead`);
    }
  });
}));

test('driver boards are supported beside their assigned two-device bridge legs', () => withAssembly(({ parts }) => {
  const mainBoard = bounds(one(parts.get('PCB1'), 'Drilled FR4 substrate'));
  for (let index = 0; index < driverIds.length; index++) {
    const driver = parts.get(driverIds[index]);
    const pair = [parts.get(qIds[index * 2]), parts.get(qIds[index * 2 + 1])];
    close(driver.home.x, (pair[0].home.x + pair[1].home.x) / 2, `${driver.data.id} is not centered on its bridge leg`);
    assert.ok(pair.every(part => part.home.z > driver.home.z), `${driver.data.id} sits beyond its switch pair`);
    const board = bounds(one(driver, 'Gate driver PCB'));
    const posts = named(driver, 'Driver mounting post');
    assert.equal(posts.length, 2);
    for (const post of posts) {
      const postBox = bounds(post);
      close(postBox.min.y, mainBoard.max.y, `${driver.data.id} post floats above the main board`);
      close(postBox.max.y, board.min.y, `${driver.data.id} post stops below its daughterboard`);
      assert.ok(overlap(postBox, board, 'x') > 0 && overlap(postBox, board, 'z') > 0);
    }
    for (const pin of named(driver, 'Driver header pin')) {
      assert.ok(bounds(pin).max.y >= board.min.y, `${driver.data.id} header does not enter its daughterboard`);
    }
  }
}));

test('main-board mounting axes have real holes and contacting standoffs', () => withAssembly(({ parts }) => {
  const main = parts.get('PCB1');
  const substrate = one(main, 'Drilled FR4 substrate');
  const mask = one(main, 'Clean solder mask and silkscreen');
  const board = bounds(substrate);
  const plate = bounds(parts.get('HS1').visual.children[0]);
  const ray = new THREE.Raycaster();
  for (const x of [-5.35, 5.35]) for (const z of [-3.2, 3.2]) {
    ray.set(new THREE.Vector3(x, 1, z), new THREE.Vector3(0, -1, 0));
    assert.equal(ray.intersectObject(substrate, false).length, 0, 'FR-4 fills a mounting screw axis');
    assert.equal(ray.intersectObject(mask, false).length, 0, 'Solder-mask artwork closes a mounting hole');
    ray.set(new THREE.Vector3(x + .12, 1, z), new THREE.Vector3(0, -1, 0));
    assert.ok(ray.intersectObject(substrate, false).length, 'Mounting hole removed surrounding substrate');
  }
  const standoffs = named(main, 'Board mounting standoff');
  assert.equal(standoffs.length, 4);
  for (const standoff of standoffs) {
    const standoffBox = bounds(standoff);
    close(standoffBox.max.y, board.min.y, 'PCB standoff misses the board underside');
    assert.ok(standoffBox.min.y <= plate.max.y && standoffBox.max.y > plate.max.y, 'PCB standoff floats above the heatsink');
  }
}));

test('insulating bushings fit the tab bores and keep clamp heads off the metal tabs', () => withAssembly(assembly => {
  const { parts } = assembly;
  const ray = new THREE.Raycaster();
  forEachPreview(assembly, factor => {
    for (const id of qIds) {
      const part = parts.get(id);
      const tab = one(part, 'Drain heat-spreader tab');
      const tabBox = bounds(tab);
      const barrel = one(part, 'Insulating shoulder bushing');
      const flange = bounds(one(part, 'Insulating bushing flange'));
      const head = bounds(one(part, 'Clamp screw head'));
      close(flange.min.z, tabBox.max.z, `${id} bushing flange enters its tab at ${factor}`);
      close(head.min.z, flange.max.z, `${id} clamp head bypasses the insulating flange at ${factor}`);
      const positions = barrel.geometry.attributes.position;
      const checked = new Set();
      for (let index = 0; index < positions.count; index++) {
        const point = new THREE.Vector3().fromBufferAttribute(positions, index).applyMatrix4(barrel.matrixWorld);
        const key = `${point.x.toFixed(6)},${point.y.toFixed(6)}`;
        if (checked.has(key)) continue;
        checked.add(key);
        ray.set(new THREE.Vector3(point.x, point.y, tabBox.max.z + .1), new THREE.Vector3(0, 0, -1));
        assert.equal(ray.intersectObject(tab, false).length, 0, `${id} bushing barrel intersects the metal tab at ${factor}`);
      }
    }
  });
}));

test('filter film leads stay clear of the mounting screws throughout filter previews', () => withAssembly(assembly => {
  const { parts } = assembly;
  // The only unnamed cylinders on the filter board are its two screw heads.
  const screwHeads = parts.get('EMI1').visual.children.filter(node => node.geometry?.type === 'CylinderGeometry' && !node.name);
  assert.equal(screwHeads.length, 2, 'Filter mounting screw geometry is missing');
  forEachPreview(assembly, factor => {
    for (const id of ['CX1', 'CX2']) for (const lead of named(parts.get(id), 'Film capacitor lead')) {
      for (const head of screwHeads) {
        assert.ok(!solidOverlap(bounds(lead), bounds(head)), `${id} lead intersects an EMI board screw at ${factor}`);
      }
    }
  });
}));

test('busbar, filter and baseplate mounting hardware remains seated at preview extrema', () => withAssembly(assembly => {
  const { parts } = assembly;
  const mainBoard = bounds(one(parts.get('PCB1'), 'Drilled FR4 substrate'));
  const heatsink = parts.get('HS1');
  forEachPreview(assembly, factor => {
    for (const id of ['BB1', 'BB2']) {
      const part = parts.get(id);
      const conductor = one(part, 'HV busbar conductor');
      const copperBar = bounds(conductor.children[0]);
      for (const support of named(part, 'Busbar insulating support')) {
        const supportBox = bounds(support);
        close(supportBox.min.y, mainBoard.max.y, `${id} support leaves the PCB at ${factor}`);
        close(supportBox.max.y, copperBar.min.y, `${id} conductor leaves its support at ${factor}`);
        assert.ok(overlap(supportBox, copperBar, 'x') > 0 && overlap(supportBox, copperBar, 'z') > 0);
      }
    }
    const filterBoard = bounds(parts.get('EMI1').visual.children[0]);
    for (const spacer of named(parts.get('EMI1'), 'Filter board spacer')) {
      const spacerBox = bounds(spacer);
      assert.ok(spacerBox.min.y <= mainBoard.max.y && spacerBox.max.y > mainBoard.max.y, 'Filter spacer floats over main PCB');
      close(spacerBox.max.y, filterBoard.min.y, 'Filter spacer misses the daughterboard');
    }
    const plate = bounds(heatsink.visual.children[0]);
    const boreParts = [one(heatsink, 'Drilled aluminum baseplate'), ...named(heatsink, 'Baseplate mounting ear')];
    const ray = new THREE.Raycaster();
    for (const washer of named(heatsink, 'Mounting ear washer')) {
      const washerBox = bounds(washer);
      close(washerBox.min.y, plate.max.y, `Baseplate washer is buried or floating at ${factor}`);
      const center = washerBox.getCenter(new THREE.Vector3());
      ray.set(new THREE.Vector3(center.x, 1, center.z), new THREE.Vector3(0, -1, 0));
      assert.equal(ray.intersectObjects([...boreParts, washer], false).length, 0, 'Heatsink mounting axis is closed by solid geometry');
    }
  });
}));

test('the control socket and retaining supports contact the card and main board', () => withAssembly(({ parts }) => {
  const part = parts.get('CTRL1');
  const main = bounds(one(parts.get('PCB1'), 'Drilled FR4 substrate'));
  const card = bounds(one(part, 'Control card PCB'));
  const edgeConnector = bounds(one(part, 'Card edge connector'));
  const socket = bounds(one(part, 'Board-mounted control socket'));
  close(socket.min.y, main.max.y, 'Control socket floats above the main PCB');
  assert.ok(solidOverlap(socket, edgeConnector), 'Control card connector misses its main-board socket');
  assert.ok(solidOverlap(edgeConnector, card), 'Control card connector does not hold the card');
  for (const support of named(part, 'Control card retaining support')) {
    const supportBox = bounds(support);
    close(supportBox.min.y, main.max.y, 'Control retaining support floats over main PCB');
    assert.ok(solidOverlap(supportBox, card), 'Control retaining support stops below the card');
  }
}));

test('lead landing footprints stay drilled at their actual positions throughout previews', () => withAssembly(assembly => {
  const { parts } = assembly;
  const main = parts.get('PCB1');
  const substrate = one(main, 'Drilled FR4 substrate');
  const mask = one(main, 'Clean solder mask and silkscreen');
  const pins = [];
  for (const id of qIds) pins.push(...named(parts.get(id), 'Terminal lead').filter(lead => bounds(lead).min.y < .535));
  for (let index = 1; index <= 6; index++) pins.push(...named(parts.get(`C${index}`), 'Capacitor lead'));
  for (const id of driverIds) pins.push(...named(parts.get(id), 'Driver header pin'));
  pins.push(...named(parts.get('CTRL1'), 'Control connector pin'));
  for (const id of ['J1', 'J2']) pins.push(...named(parts.get(id), 'Terminal pin'));
  assert.equal(pins.length, 80);
  const ray = new THREE.Raycaster();
  const clearPinFootprint = (pin, board, label) => {
    const coordinates = pin.geometry.attributes.position;
    const checked = new Set();
    for (let index = 0; index < coordinates.count; index++) {
      const point = new THREE.Vector3().fromBufferAttribute(coordinates, index).applyMatrix4(pin.matrixWorld);
      const key = `${point.x.toFixed(6)},${point.z.toFixed(6)}`;
      if (checked.has(key)) continue;
      checked.add(key);
      ray.set(new THREE.Vector3(point.x, 1, point.z), new THREE.Vector3(0, -1, 0));
      assert.equal(ray.intersectObject(board, false).length, 0, `${label} pin boundary enters undrilled board material`);
    }
  };
  forEachPreview(assembly, factor => {
    for (const pin of pins) {
      clearPinFootprint(pin, substrate, `${pin.name} at ${factor}`);
      clearPinFootprint(pin, mask, `${pin.name} solder mask at ${factor}`);
    }
    const filterBoard = one(parts.get('EMI1'), 'Drilled EMI filter PCB');
    const filterPins = [
      ...parts.get('LCM1').visual.children.filter(node => node.name.startsWith('LCM1 board pin')),
      ...named(parts.get('CX1'), 'Film capacitor lead'), ...named(parts.get('CX2'), 'Film capacitor lead'),
    ];
    assert.equal(filterPins.length, 8);
    for (const pin of filterPins) clearPinFootprint(pin, filterBoard, `${pin.name} filter preview at ${factor}`);
  });
}));

test('capacitor cases, terminal feet and film collars sit on their supporting boards', () => withAssembly(assembly => {
  const { parts } = assembly;
  const main = bounds(one(parts.get('PCB1'), 'Drilled FR4 substrate'));
  forEachPreview(assembly, factor => {
    for (let index = 1; index <= 6; index++) {
      const part = parts.get(`C${index}`);
      const gasket = bounds(one(part, 'Seated capacitor gasket'));
      close(gasket.min.y, main.max.y, `${part.data.id} case floats above its PCB at ${factor}`);
      assert.ok(solidOverlap(gasket, bounds(one(part, 'Capacitor sleeve'))), `${part.data.id} sleeve detaches from its gasket`);
    }
    for (const id of ['J1', 'J2']) {
      const part = parts.get(id);
      const housing = bounds(one(part, 'Bored two-pole terminal housing'));
      for (const foot of named(part, 'Terminal seating foot')) {
        const footBox = bounds(foot);
        close(footBox.min.y, main.max.y, `${id} seating foot floats over PCB`);
        close(footBox.max.y, housing.min.y, `${id} housing floats over its foot`);
        assert.ok(overlap(footBox, housing, 'x') > 0 && overlap(footBox, housing, 'z') > 0);
      }
    }
    const filter = bounds(one(parts.get('EMI1'), 'Drilled EMI filter PCB'));
    for (const id of ['CX1', 'CX2']) {
      const part = parts.get(id), housing = bounds(part.visual.children[0]);
      for (const collar of named(part, 'Film capacitor seating collar')) {
        const collarBox = bounds(collar);
        close(collarBox.min.y, filter.max.y, `${id} collar floats over filter PCB`);
        close(collarBox.max.y, housing.min.y, `${id} case floats over seating collar`);
        assert.ok(overlap(collarBox, housing, 'x') > 0 && overlap(collarBox, housing, 'z') > 0);
      }
    }
  });
}));

test('DC-link rails and their supports stay clear of seated capacitor cases', () => withAssembly(assembly => {
  const { parts } = assembly;
  forEachPreview(assembly, factor => {
    for (const id of ['BB1', 'BB2']) {
      const busbar = bounds(parts.get(id));
      for (let index = 1; index <= 6; index++) {
        const capacitor = parts.get(`C${index}`);
        for (const name of ['Capacitor sleeve', 'Seated capacitor gasket']) {
          assert.ok(!solidOverlap(busbar, bounds(one(capacitor, name))), `${id} intersects C${index} ${name} at ${factor}`);
        }
      }
    }
  });
}));
