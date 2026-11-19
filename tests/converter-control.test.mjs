import test from 'node:test';
import assert from 'node:assert/strict';
import { components } from '../src/data.js';
import {
  CONTROL_GROUPS, CONTROL_TARGETS, CONTROL_INSIGHTS, CONTROL_NOTICE, CONTROL_DETAILS,
  CONTROL_TPS_PHASES, getControlTPSPattern, makeControlTPSPattern, CONTROL_LOAD_EVENT, CONTROL_REFERENCE,
  CONTROL_RESPONSE_CURVES, getControlResponseValue, getControlResponsePoints,
} from '../src/converterControlData.js';
const near = (a, b, tolerance = 1e-12) => Math.abs(a - b) <= tolerance;

test('TPS bridge voltages are three-level, half-wave symmetric, and have zero signed area', () => {
  for (let phase = 0; phase < CONTROL_TPS_PHASES.length; phase++) {
    const pattern = getControlTPSPattern(phase);
    for (const [bridge, normalizedWidth] of [[pattern.primary, pattern.D1], [pattern.secondary, pattern.D2]]) {
      const [ps, pe] = bridge.positive, [ns, ne] = bridge.negative;
      assert.ok(ps >= 0 && pe <= .5 && ns >= .5 && ne <= 1);
      assert.ok(near(pe - ps, normalizedWidth / 2));
      assert.ok(near(ne - ns, normalizedWidth / 2));
      assert.ok(near(ns - ps, .5) && near(ne - pe, .5));
      assert.ok(ps < pe && pe <= ns && ns < ne);
      assert.ok(near((pe - ps) - (ne - ns), 0));
      const level = t => t >= ps && t < pe ? 1 : t >= ns && t < ne ? -1 : 0;
      assert.deepEqual(new Set([level(0), level((ps + pe) / 2), level((ns + ne) / 2)]), new Set([0, 1, -1]));
    }
    assert.ok(near(pattern.secondary.positive[0] - pattern.primary.positive[0], pattern.D0));
  }
  assert.deepEqual(getControlTPSPattern(-1), getControlTPSPattern(0));
  assert.deepEqual(getControlTPSPattern(Infinity), getControlTPSPattern(0));
  assert.deepEqual(getControlTPSPattern(99), getControlTPSPattern(2));
});

test('TPS outer and inner shifts affect the intended bridge timing independently', () => {
  const baseline = makeControlTPSPattern({ D0: .06, D1: .50, D2: .50 });
  const outer = makeControlTPSPattern({ D0: .08, D1: .50, D2: .50 });
  const inner1 = makeControlTPSPattern({ D0: .06, D1: .60, D2: .50 });
  const inner2 = makeControlTPSPattern({ D0: .06, D1: .50, D2: .60 });
  assert.deepEqual(outer.primary, baseline.primary);
  assert.ok(near(outer.secondary.positive[0] - baseline.secondary.positive[0], .02));
  assert.deepEqual(inner1.secondary, baseline.secondary);
  assert.ok(near(inner1.primary.positive[1] - baseline.primary.positive[1], .05));
  assert.deepEqual(inner2.primary, baseline.primary);
  assert.ok(near(inner2.secondary.positive[1] - baseline.secondary.positive[1], .05));
  assert.throws(() => makeControlTPSPattern({ D0: .5, D1: .5, D2: .5 }), RangeError);
});

test('responses share the load event and initial/final reference with continuous joins', () => {
  for (const curve of CONTROL_RESPONSE_CURVES) {
    const end = CONTROL_LOAD_EVENT + curve.recovery;
    assert.ok(end < 1);
    for (const time of [0, CONTROL_LOAD_EVENT, end, 1]) assert.ok(near(getControlResponseValue(curve.id, time), CONTROL_REFERENCE));
    for (const join of [CONTROL_LOAD_EVENT, end]) {
      assert.ok(near(getControlResponseValue(curve.id, join - 1e-8), getControlResponseValue(curve.id, join + 1e-8), 1e-6));
    }
    const points = getControlResponsePoints(curve.id);
    assert.equal(points[0].time, 0);
    assert.equal(points.at(-1).time, 1);
    assert.ok(points.some(point => point.time === CONTROL_LOAD_EVENT));
    assert.ok(points.some(point => point.time === end));
    assert.ok(points.every(point => Number.isFinite(point.time) && Number.isFinite(point.value) && point.value <= CONTROL_REFERENCE));
    for (let i = 1; i < points.length; i++) assert.ok(points[i].time > points[i - 1].time);
  }
});

test('authored NN curve has a smaller dip and shorter recovery than authored PI', () => {
  const nn = CONTROL_RESPONSE_CURVES.find(curve => curve.id === 'nn');
  const pi = CONTROL_RESPONSE_CURVES.find(curve => curve.id === 'pi');
  const minimum = curve => getControlResponseValue(curve.id, CONTROL_LOAD_EVENT + curve.recovery / 4);
  assert.ok(nn.amplitude < pi.amplitude);
  assert.ok(nn.recovery < pi.recovery);
  assert.ok(near(CONTROL_REFERENCE - minimum(nn), nn.amplitude));
  assert.ok(near(CONTROL_REFERENCE - minimum(pi), pi.amplitude));
  assert.ok(minimum(nn) > minimum(pi));
  const nnRecovered = CONTROL_LOAD_EVENT + nn.recovery;
  assert.equal(getControlResponseValue('nn', nnRecovered), CONTROL_REFERENCE);
  assert.ok(getControlResponseValue('pi', nnRecovered) < CONTROL_REFERENCE);
  assert.throws(() => getControlResponseValue('unknown', 0), RangeError);
  assert.throws(() => getControlResponsePoints('unknown'), RangeError);
});

test('feedback, controller and actuation groups use existing hardware without adding terminals', () => {
  assert.equal(components.length, 31);
  const physical = new Set(components.map(part => part.id));
  assert.equal(physical.size, 31);
  assert.deepEqual(CONTROL_GROUPS.map(group => group.id), ['voltage', 'current', 'controller', 'drivers', 'power']);
  assert.equal(new Set(CONTROL_TARGETS).size, CONTROL_TARGETS.length);
  assert.equal(CONTROL_TARGETS.length, 14);
  for (const group of CONTROL_GROUPS) {
    assert.ok(group.partIds.includes(group.anchorId));
    for (const id of group.partIds) assert.ok(physical.has(id));
  }
  const voltage = CONTROL_GROUPS.find(group => group.id === 'voltage');
  const current = CONTROL_GROUPS.find(group => group.id === 'current');
  assert.deepEqual(voltage.partIds, ['J2']);
  assert.deepEqual(current.partIds, ['J2']);
  assert.notEqual(voltage.attachmentRole, current.attachmentRole);
  assert.notEqual(voltage.color, current.color);
});

test('control notice describes authored comparison and correct logical implementation boundary', () => {
  assert.deepEqual(CONTROL_INSIGHTS, ['dab-modulation']);
  assert.equal(CONTROL_NOTICE, 'Illustrative AI for PE control/modulation');
  assert.match(CONTROL_DETAILS, /No trained NN, circuit simulation or real-time controller executes/);
  assert.match(CONTROL_DETAILS, /Rogowski coil senses the AC component/);
  assert.match(CONTROL_DETAILS, /separate sensor or estimate is needed for its DC component/);
  assert.match(CONTROL_DETAILS, /D0 is the outer interbridge shift/);
  assert.match(CONTROL_DETAILS, /do not establish general superiority/);
});
