import test from 'node:test';
import assert from 'node:assert/strict';
import { components, categories } from '../src/data.js';
import { AI_SOURCE, AI_PHASES, aiOpportunities, getFilteredOpportunities, opportunitiesForPart } from '../src/aiData.js';

test('every physical component has an AI mapping and every target exists', () => {
  const physical = new Set(components.map(part => part.id));
  for (const opportunity of aiOpportunities) {
    assert.ok(opportunity.partIds.length, `${opportunity.id} has no physical target`);
    assert.equal(new Set(opportunity.partIds).size, opportunity.partIds.length, `${opportunity.id} duplicates targets`);
    for (const id of opportunity.partIds) assert.ok(physical.has(id), `${opportunity.id} targets missing hardware ${id}`);
  }
  for (const part of components) assert.ok(opportunitiesForPart(part.id).length, `No application for ${part.id}`);
  for (const category of categories) assert.ok(components.some(part => part.category === category.id && opportunitiesForPart(part.id).length));
});

test('lifecycle and part filters compose without unrelated or duplicate results', () => {
  for (const part of components) {
    const all = getFilteredOpportunities({ partId: part.id });
    const acrossPhases = AI_PHASES.flatMap(phase => getFilteredOpportunities({ phase: phase.id, partId: part.id }));
    assert.deepEqual(new Set(acrossPhases.map(item => item.id)), new Set(all.map(item => item.id)));
    assert.equal(acrossPhases.length, all.length);
    for (const phase of AI_PHASES) {
      const filtered = getFilteredOpportunities({ phase: phase.id, partId: part.id });
      assert.ok(filtered.every(item => item.phase === phase.id && item.partIds.includes(part.id)));
    }
  }
  assert.deepEqual(getFilteredOpportunities({ partId: 'missing-part' }), []);
  assert.deepEqual(getFilteredOpportunities({ phase: 'missing-phase' }), []);
});

test('mapped applications carry What/Which/How evidence and deployment distinctions', () => {
  assert.equal(new Set(aiOpportunities.map(item => item.id)).size, aiOpportunities.length);
  for (const phase of AI_PHASES) assert.ok(aiOpportunities.some(item => item.phase === phase.id));
  for (const item of aiOpportunities) {
    for (const field of ['task', 'modality', 'rationale', 'training', 'runtime']) assert.ok(item[field]?.trim(), `${item.id}: missing ${field}`);
    for (const field of ['algorithms', 'inputs', 'outputs', 'how', 'validation']) assert.ok(item[field]?.length && item[field].every(value => value.trim()), `${item.id}: missing ${field}`);
    assert.ok(item.reference.section && item.reference.url === AI_SOURCE.url);
  }
});
