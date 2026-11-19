import test from 'node:test';
import assert from 'node:assert/strict';
import { DESIGN_LAB_URL, LAB_URL, RUL_LAB_URL, readPageRoute, pageUrl } from '../src/controlLabNavigation.js';

test('the geometry NN route belongs to Design and supports direct shared links', () => {
  assert.equal(DESIGN_LAB_URL, '/?mode=design&lab=geometry-nn');
  assert.deepEqual(readPageRoute('?mode=design&lab=geometry-nn'), { mode: 'design', lab: true, labId: 'geometry-nn' });
  assert.equal(pageUrl('design', 'geometry-nn'), DESIGN_LAB_URL);
});

test('geometry NN links cannot open under another story or an unknown mode', () => {
  for (const mode of ['control', 'maintenance', 'overview', 'path', 'ai', 'unknown']) {
    const expected = mode === 'unknown' ? 'overview' : mode;
    assert.deepEqual(readPageRoute(`?mode=${mode}&lab=geometry-nn`), { mode: expected, lab: false, labId: null });
    assert.equal(new URL(pageUrl(mode, 'geometry-nn'), 'https://example.com').searchParams.has('lab'), false);
  }
});

test('geometry navigation preserves share context and removes stale routing fields on return', () => {
  const href = 'https://example.com/nested?mode=control&mode=ai&lab=modulation-nn&lab=old&source=lecture&tag=a&tag=b#layout';
  const entered = new URL(pageUrl('design', 'geometry-nn', href), 'https://example.com');
  assert.equal(entered.pathname, '/');
  assert.deepEqual(entered.searchParams.getAll('mode'), ['design']);
  assert.deepEqual(entered.searchParams.getAll('lab'), ['geometry-nn']);
  assert.deepEqual(entered.searchParams.getAll('tag'), ['a', 'b']);
  assert.equal(entered.searchParams.get('source'), 'lecture');
  assert.equal(entered.hash, '#layout');
  const returned = new URL(pageUrl('design', false, entered.href), 'https://example.com');
  assert.deepEqual(readPageRoute(returned.search), { mode: 'design', lab: false, labId: null });
  assert.equal(returned.hash, '#layout');
});

test('Design addition preserves Control and RUL route contracts and rejects malformed labs', () => {
  assert.equal(pageUrl('control', true), LAB_URL);
  assert.equal(pageUrl('maintenance', 'rul-nn'), RUL_LAB_URL);
  assert.equal(pageUrl('design', true), '/?mode=design');
  for (const id of ['', 'GEOMETRY-NN', 'geometry-nn-extra', 'rul-nn', 'modulation-nn', '__proto__', 'constructor']) {
    assert.deepEqual(readPageRoute(`?mode=design&lab=${id}`), { mode: 'design', lab: false, labId: null });
    assert.equal(pageUrl('design', id), '/?mode=design');
  }
});
