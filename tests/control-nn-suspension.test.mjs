import test from 'node:test';
import assert from 'node:assert/strict';
import { ConverterScene } from '../src/scene.js';

function browserClock(t, initial = 0) {
  let time = initial;
  const cancelled = [];
  const performanceDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'performance');
  const cancelDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'cancelAnimationFrame');
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => time } });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', { configurable: true, value: frame => cancelled.push(frame) });
  t.after(() => {
    if (performanceDescriptor) Object.defineProperty(globalThis, 'performance', performanceDescriptor);
    else delete globalThis.performance;
    if (cancelDescriptor) Object.defineProperty(globalThis, 'cancelAnimationFrame', cancelDescriptor);
    else delete globalThis.cancelAnimationFrame;
  });
  return { cancelled, set: value => { time = value; } };
}

function suspensionScene() {
  const view = { position: [10, 8, 12], target: [1, 0.5, 0], view: 'iso' };
  const calls = { captured: 0, restored: [], resized: 0, animated: 0 };
  const scene = Object.assign(Object.create(ConverterScene.prototype), {
    suspended: false, host: { dataset: {} }, controls: { enabled: true }, down: [10, 10], frame: 73,
    parts: new Map([['moving', { positionTween: { start: 25 } }], ['still', { positionTween: null }]]),
    previewTween: { start: 50 },
    captureView() { calls.captured++; return structuredClone(view); },
    restoreView(snapshot) { calls.restored.push(snapshot); },
    resize() { calls.resized++; },
    animate() { calls.animated++; },
  });
  return { scene, calls, view };
}

test('opening the lab cancels rendering and preserves a single inspection snapshot', t => {
  const clock = browserClock(t);
  const { scene, calls, view } = suspensionScene();
  scene.setSuspended(true);
  assert.equal(scene.suspended, true);
  assert.equal(scene.host.dataset.suspended, 'true');
  assert.equal(scene.controls.enabled, false);
  assert.equal(scene.down, null, 'A drag cannot continue after suspension');
  assert.deepEqual(scene.suspendedView, view);
  assert.deepEqual(clock.cancelled, [73]);
  assert.equal(calls.captured, 1);
  scene.setSuspended(true);
  assert.equal(calls.captured, 1, 'Repeated suspended renders must not replace the return camera');
  assert.deepEqual(clock.cancelled, [73]);
  assert.equal(calls.resized, 0);
  assert.equal(calls.animated, 0);
});

test('returning resumes once, restores framing and excludes lab time from hardware transitions', t => {
  const clock = browserClock(t, 0);
  const { scene, calls, view } = suspensionScene();
  scene.setSuspended(true);
  clock.set(5000);
  scene.setSuspended(false);
  assert.equal(scene.suspended, false);
  assert.equal(scene.controls.enabled, true);
  assert.equal(scene.host.dataset.suspended, 'false');
  assert.equal(scene.parts.get('moving').positionTween.start, 5025);
  assert.equal(scene.parts.get('still').positionTween, null);
  assert.equal(scene.previewTween.start, 5050);
  assert.deepEqual(calls.restored, [view]);
  assert.equal(calls.resized, 1);
  assert.equal(calls.animated, 1);
  assert.equal(scene.anchorProjectionDirty, true);
  scene.setSuspended(false);
  assert.equal(calls.animated, 1, 'Repeated resumes must not create additional render loops');
  assert.equal(scene.parts.get('moving').positionTween.start, 5025);
});

test('paused resize notifications cannot measure hidden layout or replace the camera', () => {
  const scene = Object.assign(Object.create(ConverterScene.prototype), {
    suspended: true,
    host: { getBoundingClientRect() { assert.fail('A paused scene must not measure its hidden host'); } },
  });
  assert.doesNotThrow(() => scene.resize());
});

function resizeScene(width, height) {
  const calls = { projection: 0, sizes: [], capturedViews: [], presets: [] };
  const scene = Object.assign(Object.create(ConverterScene.prototype), {
    suspended: false, host: { getBoundingClientRect: () => ({ width, height }) },
    camera: { aspect: 1.5, updateProjectionMatrix() { calls.projection++; } },
    renderer: { setSize(...size) { calls.sizes.push(size); } },
    didInitialFit: true, wasMobile: false, previousAspect: 1.5, view: 'iso',
    applyCapturedView(snapshot) { calls.capturedViews.push(snapshot); },
    preset(...args) { calls.presets.push(args); },
  });
  return { scene, calls };
}

test('zero-size notifications do not overwrite the last measurable layout or fit', () => {
  for (const [width, height] of [[0, 0], [800, 0], [0, 600]]) {
    const { scene, calls } = resizeScene(width, height);
    scene.resize();
    assert.equal(scene.camera.aspect, 1.5);
    assert.equal(scene.previousAspect, 1.5);
    assert.equal(scene.wasMobile, false);
    assert.equal(calls.projection, 0);
    assert.deepEqual(calls.sizes, []);
    assert.deepEqual(calls.presets, []);
  }
});

test('a restored Control camera survives the first responsive resize after returning', t => {
  browserClock(t, 100);
  const { scene, calls } = resizeScene(390, 600);
  const snapshot = { position: [7, 4, 8], target: [1, 1, 0], view: 'iso' };
  scene.designActive = true;
  scene.restoredView = { snapshot, until: 1100 };
  scene.resize();
  assert.equal(scene.camera.aspect, 390 / 600);
  assert.deepEqual(calls.capturedViews, [snapshot]);
  assert.deepEqual(calls.presets, [], 'A mobile breakpoint must preserve the inspection camera during return');
  assert.deepEqual(calls.sizes, [[390, 600]]);
  assert.equal(scene.wasMobile, true);
});
