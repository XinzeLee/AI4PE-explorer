import test from 'node:test';
import assert from 'node:assert/strict';
import { LAB_URL, pageUrl, readPageRoute } from '../src/controlLabNavigation.js';

test('direct lab URLs resolve to the Control playground', () => {
  assert.equal(LAB_URL, '/?mode=control&lab=modulation-nn');
  assert.deepEqual(readPageRoute(new URL(LAB_URL, 'https://example.com').search), { mode: 'control', lab: true, labId: 'modulation-nn' });
  assert.equal(pageUrl('control', true), LAB_URL);
});

test('supported story and explorer modes survive route parsing', () => {
  for (const mode of ['overview', 'path', 'ai', 'design', 'control', 'maintenance']) {
    assert.deepEqual(readPageRoute(`?mode=${mode}`), { mode, lab: false, labId: null });
    assert.deepEqual(readPageRoute(new URL(pageUrl(mode), 'https://example.com').search), { mode, lab: false, labId: null });
  }
  assert.deepEqual(readPageRoute('?mode=ai'), { mode: 'ai', lab: false, labId: null }, 'Legacy AI deep links still open AI opportunities');
});

test('missing and unknown modes return to the explorer', () => {
  for (const search of ['', '?lab=modulation-nn', '?mode=unknown', '?mode=CONTROL&lab=modulation-nn']) {
    assert.deepEqual(readPageRoute(search), { mode: 'overview', lab: false, labId: null });
  }
  assert.equal(pageUrl('unknown', true, 'https://example.com/?mode=control&lab=modulation-nn'), '/');
  assert.equal(pageUrl('overview'), '/');
});

test('the modulation lab is enabled only for its exact Control route', () => {
  for (const mode of ['overview', 'path', 'ai', 'design', 'maintenance']) {
    assert.deepEqual(readPageRoute(`?mode=${mode}&lab=modulation-nn`), { mode, lab: false, labId: null });
    assert.equal(new URL(pageUrl(mode, true), 'https://example.com').searchParams.has('lab'), false);
  }
  assert.deepEqual(readPageRoute('?mode=control&lab=unknown'), { mode: 'control', lab: false, labId: null });
  assert.deepEqual(readPageRoute('?mode=control&lab='), { mode: 'control', lab: false, labId: null });
});

test('root routes preserve unrelated query parameters and the fragment', () => {
  const href = 'https://example.com/nested/path?source=lecture&tag=a&tag=b&mode=design&lab=other#notes';
  const lab = new URL(pageUrl('control', true, href), 'https://example.com');
  assert.equal(lab.pathname, '/');
  assert.equal(lab.hash, '#notes');
  assert.equal(lab.searchParams.get('source'), 'lecture');
  assert.deepEqual(lab.searchParams.getAll('tag'), ['a', 'b']);
  assert.equal(lab.searchParams.get('mode'), 'control');
  assert.equal(lab.searchParams.get('lab'), 'modulation-nn');
  const explorer = new URL(pageUrl('overview', false, lab.href), 'https://example.com');
  assert.equal(explorer.searchParams.has('mode'), false);
  assert.equal(explorer.searchParams.has('lab'), false);
  assert.equal(explorer.searchParams.get('source'), 'lecture');
  assert.equal(explorer.hash, '#notes');
});

test('returning from a lab deletes stale lab parameters and preserves relative URL context', () => {
  assert.equal(pageUrl('control', false, LAB_URL), '/?mode=control');
  assert.equal(pageUrl('ai', false, '/?mode=control&lab=modulation-nn&source=course#unit2'), '/?mode=ai&source=course#unit2');
  const parsed = new URL(pageUrl('control', true, '/?mode=design&mode=ai&lab=old&lab=other'), 'https://example.com');
  assert.deepEqual(parsed.searchParams.getAll('mode'), ['control']);
  assert.deepEqual(parsed.searchParams.getAll('lab'), ['modulation-nn']);
});
