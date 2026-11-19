import test from 'node:test';
import assert from 'node:assert/strict';
import { components } from '../src/data.js';
import { aiOpportunities } from '../src/aiData.js';
import {
  MAINTENANCE_GROUPS, MAINTENANCE_TARGETS, MAINTENANCE_INSIGHTS, MAINTENANCE_NOTICE, MAINTENANCE_DETAILS,
  MAINTENANCE_SIGNAL_STYLES, MAINTENANCE_FAULT_CLASSES, MAINTENANCE_HEALTH_SERIES,
  getMaintenanceWaveform, getMaintenanceRulData, getMaintenanceHealthData, getMaintenanceFaultState,
} from '../src/converterMaintenanceData.js';
const near = (a, b, tolerance = 1e-12) => Math.abs(a - b) <= tolerance;
const range = values => Math.max(...values) - Math.min(...values);

test('waveforms stay bounded with comparable means and growing ripple', () => {
  for (const signal of ['voltage', 'current']) {
    let priorRipple = 0;
    for (let phase = 0; phase <= 3; phase++) {
      const points = getMaintenanceWaveform(signal, phase);
      assert.equal(points[0].time, 0);
      assert.equal(points.at(-1).time, 1);
      assert.ok(points.every(point => point.value > 0 && point.value < 1));
      const mean = points.reduce((sum, point) => sum + point.value, 0) / points.length;
      assert.ok(near(mean, MAINTENANCE_SIGNAL_STYLES[signal].mean));
      const ripple = range(points.map(point => point.value));
      assert.ok(ripple > priorRipple);
      priorRipple = ripple;
      assert.ok(range(points.filter(point => point.time > 0.75).map(point => point.value)) > range(points.filter(point => point.time < 0.25).map(point => point.value)));
    }
  }
});

test('remaining-operation bands are positive, ordered and shorten across phases', () => {
  let priorRemaining = Infinity;
  for (let phase = 0; phase <= 3; phase++) {
    const points = getMaintenanceRulData(phase);
    assert.ok(points.every(point => point.lower > 0 && point.lower < point.estimate && point.estimate < point.upper && point.upper < 1));
    assert.ok(points.at(-1).estimate < priorRemaining);
    priorRemaining = points.at(-1).estimate;
    for (let index = 1; index < points.length; index++) {
      assert.ok(points[index].time > points[index - 1].time);
      assert.ok(points[index].estimate < points[index - 1].estimate);
    }
  }
});

test('hard-fault Normal coexists with worsening generic indicators and wear', () => {
  assert.deepEqual(MAINTENANCE_FAULT_CLASSES.map(item => item.label), ['Normal', 'Possible open circuit', 'Possible short circuit', 'Uncertain']);
  for (let phase = 0; phase <= 3; phase++) {
    const fault = getMaintenanceFaultState(phase);
    assert.equal(fault.classId, 'normal');
    assert.equal(fault.message, 'No open/short indication');
    const health = getMaintenanceHealthData(phase);
    for (const series of MAINTENANCE_HEALTH_SERIES) {
      assert.ok(health.every(point => point[series.id] > 0 && point[series.id] < 1));
      assert.ok(health.at(-1)[series.id] > health[0][series.id]);
      if (phase > 0) {
        assert.ok(fault.wearPresent);
        assert.ok(health.at(-1)[series.id] > getMaintenanceHealthData(phase - 1).at(-1)[series.id]);
      }
    }
  }
});

test('phase bounds and invalid inputs cannot produce unbounded or empty illustrations', () => {
  assert.deepEqual(getMaintenanceWaveform('voltage', -1), getMaintenanceWaveform('voltage', 0));
  assert.deepEqual(getMaintenanceRulData(100), getMaintenanceRulData(3));
  assert.deepEqual(getMaintenanceHealthData(NaN), getMaintenanceHealthData(0));
  assert.ok(getMaintenanceWaveform('current', 0, 0).length >= 65);
  assert.equal(getMaintenanceRulData(0, 0).length, 2);
  assert.throws(() => getMaintenanceWaveform('unknown'), RangeError);
});

test('maintenance uses distinct sensing roles at the existing terminal and retains all 31 parts', () => {
  assert.equal(components.length, 31);
  const physical = new Set(components.map(part => part.id));
  assert.equal(physical.size, 31);
  assert.deepEqual(MAINTENANCE_GROUPS.map(group => group.id), ['voltage', 'current']);
  assert.deepEqual(MAINTENANCE_TARGETS, ['J2']);
  for (const group of MAINTENANCE_GROUPS) {
    assert.equal(group.anchorId, 'J2');
    for (const id of group.partIds) assert.ok(physical.has(id));
  }
  assert.notEqual(MAINTENANCE_GROUPS[0].attachmentRole, MAINTENANCE_GROUPS[1].attachmentRole);
  assert.notEqual(MAINTENANCE_GROUPS[0].color, MAINTENANCE_GROUPS[1].color);
  assert.deepEqual(new Set(MAINTENANCE_INSIGHTS), new Set(aiOpportunities.filter(item => item.phase === 'maintenance').map(item => item.id)));
});

test('scientific boundary distinguishes wear, hard-fault diagnosis and maintenance scope', () => {
  assert.equal(MAINTENANCE_NOTICE, 'Illustrative maintenance outputs');
  assert.match(MAINTENANCE_DETAILS, /first modeled service-ending wear-out condition/);
  assert.match(MAINTENANCE_DETAILS, /under assumed future use and uncertainty/);
  assert.match(MAINTENANCE_DETAILS, /not demonstrated coverage/);
  assert.match(MAINTENANCE_DETAILS, /No live acquisition, trained NN/);
  assert.match(MAINTENANCE_DETAILS, /independent fast hardware protection/);
});
