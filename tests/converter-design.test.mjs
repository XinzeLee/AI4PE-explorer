import test from 'node:test';
import assert from 'node:assert/strict';
import { components } from '../src/data.js';
import { DESIGN_GROUPS, DESIGN_TARGETS, DESIGN_INSIGHTS, DESIGN_NOTICE, DESIGN_DETAIL, PARETO_CANDIDATES, getDesignParetoFront } from '../src/converterDesignData.js';
const ids = candidates => candidates.map(candidate => candidate.id);
const point = (id, efficiency, density, feasible = true) => ({ id, efficiency, density, feasible });

test('diagram has five trade-offs and twelve dominated feasible candidates', () => {
  assert.equal(PARETO_CANDIDATES.length, 17);
  assert.equal(new Set(ids(PARETO_CANDIDATES)).size, 17);
  assert.ok(PARETO_CANDIDATES.every(candidate => candidate.feasible && candidate.efficiency >= 0 && candidate.efficiency <= 1 && candidate.density >= 0 && candidate.density <= 1));
  const front = getDesignParetoFront(PARETO_CANDIDATES);
  assert.deepEqual(ids(front), ['F1', 'F2', 'F3', 'F4', 'F5']);
  for (let index = 1; index < front.length; index++) {
    assert.ok(front[index].efficiency > front[index - 1].efficiency);
    assert.ok(front[index].density < front[index - 1].density);
  }
  for (const candidate of PARETO_CANDIDATES.filter(candidate => !front.includes(candidate))) {
    assert.ok(front.some(other => other.efficiency >= candidate.efficiency && other.density >= candidate.density && (other.efficiency > candidate.efficiency || other.density > candidate.density)), `${candidate.id} has no dominator`);
  }
});

test('dominance maximizes both objectives and requires a strict improvement', () => {
  const a = point('a', 0.8, 0.4), b = point('b', 0.4, 0.8);
  const lower = point('lower', 0.3, 0.3), sameEfficiency = point('same-efficiency', 0.8, 0.3), sameDensity = point('same-density', 0.3, 0.8), tie = point('tie', 0.8, 0.4);
  assert.deepEqual(ids(getDesignParetoFront([a, b, lower, sameEfficiency, sameDensity, tie])), ['a', 'b', 'tie']);
  assert.deepEqual(ids(getDesignParetoFront([point('perfect', 1, 1), a, b, lower])), ['perfect']);
  assert.deepEqual(getDesignParetoFront([]), []);
});

test('infeasible and nonfinite records never remove a feasible front point', () => {
  const feasible = point('feasible', 0.6, 0.6);
  const invalid = [point('infeasible', 1, 1, false), point('missing-feasibility', 1, 1), point('nan', NaN, 1), point('infinity', 1, Infinity), null];
  delete invalid[1].feasible;
  assert.deepEqual(ids(getDesignParetoFront([feasible, ...invalid])), ['feasible']);
  assert.deepEqual(getDesignParetoFront(invalid), []);
});

test('filtering preserves caller order without mutating input records', () => {
  const a = Object.freeze(point('a', 0.8, 0.4)), b = Object.freeze(point('b', 0.4, 0.8));
  const candidates = Object.freeze([b, a, Object.freeze(point('lower', 0.2, 0.2))]);
  const result = getDesignParetoFront(candidates);
  assert.deepEqual(ids(result), ['b', 'a']);
  assert.equal(result[0], b);
  assert.equal(result[1], a);
  assert.equal(candidates.length, 3);
});

test('a dominated proposal leaves the front unchanged while a stronger trade-off replaces a point', () => {
  const front = getDesignParetoFront(PARETO_CANDIDATES);
  assert.deepEqual(getDesignParetoFront([...front, point('extra', 0.1, 0.1)]), front);
  assert.deepEqual(ids(getDesignParetoFront([...front, point('new-trade-off', 0.65, 0.72)])), ['F1', 'F2', 'F4', 'F5', 'new-trade-off']);
});

test('four conceptual input groups map to the retained 31-part hardware', () => {
  assert.equal(components.length, 31);
  const physicalIds = new Set(components.map(component => component.id));
  assert.equal(physicalIds.size, 31);
  assert.deepEqual(DESIGN_GROUPS.map(group => group.id), ['semiconductor', 'magnetic', 'thermal', 'emi']);
  assert.deepEqual(DESIGN_TARGETS, [...Array.from({ length: 8 }, (_, index) => `Q${index + 1}`), 'T1', 'L1', 'HS1', 'EMI1', 'LCM1', 'CX1', 'CX2']);
  assert.equal(new Set(DESIGN_TARGETS).size, DESIGN_TARGETS.length);
  for (const group of DESIGN_GROUPS) {
    assert.ok(group.partIds.includes(group.anchorId));
    assert.ok(/^#[\da-f]{6}$/i.test(group.color));
    for (const id of group.partIds) assert.ok(physicalIds.has(id), `${group.id} targets missing part ${id}`);
  }
  for (const id of ['BB1', 'BB2']) assert.ok(physicalIds.has(id));
});

test('entry IDs and explanation retain the conceptual-result boundary', () => {
  assert.deepEqual(DESIGN_INSIGHTS, ['switch-loss', 'thermal-design', 'emi-design', 'magnetic-design']);
  assert.equal(DESIGN_NOTICE, 'Conceptual workflow · illustrative feasible candidates');
  assert.match(DESIGN_DETAIL, /No model, physics solver or optimizer was executed/);
  assert.match(DESIGN_DETAIL, /not a proven global optimum/);
  assert.match(DESIGN_DETAIL, /operating conditions/);
});
