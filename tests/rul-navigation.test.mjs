import test from 'node:test';
import assert from 'node:assert/strict';
import { LAB_URL, RUL_LAB_URL, pageUrl, readPageRoute } from '../src/controlLabNavigation.js';

test('direct remaining-life links resolve to the Maintenance lab', () => {
  assert.equal(RUL_LAB_URL, '/?mode=maintenance&lab=rul-nn');
  assert.deepEqual(readPageRoute(new URL(RUL_LAB_URL, 'https://example.com').search), {
    mode: 'maintenance', lab: true, labId: 'rul-nn',
  });
  assert.equal(pageUrl('maintenance', 'rul-nn'), RUL_LAB_URL);
});

test('remaining-life lab IDs cannot open under another story or unknown mode', () => {
  for (const mode of ['overview', 'path', 'ai', 'design', 'control', 'unknown', 'MAINTENANCE']) {
    const expectedMode = ['unknown', 'MAINTENANCE'].includes(mode) ? 'overview' : mode;
    assert.deepEqual(readPageRoute(`?mode=${mode}&lab=rul-nn`), { mode: expectedMode, lab: false, labId: null });
    assert.equal(new URL(pageUrl(mode, 'rul-nn'), 'https://example.com').searchParams.has('lab'), false);
  }
  assert.deepEqual(readPageRoute('?lab=rul-nn'), { mode: 'overview', lab: false, labId: null });
});

test('Control boolean callers and explicit lab IDs retain distinct destinations', () => {
  assert.equal(pageUrl('control', true), LAB_URL);
  assert.equal(pageUrl('control', 'modulation-nn'), LAB_URL);
  assert.equal(pageUrl('maintenance', true), '/?mode=maintenance');
  assert.equal(pageUrl('control', 'rul-nn'), '/?mode=control');
  assert.equal(pageUrl('maintenance', 'modulation-nn'), '/?mode=maintenance');
  assert.equal(readPageRoute('?mode=control&lab=modulation-nn').labId, 'modulation-nn');
});

test('returning from RUL removes the lab while preserving shared-link context', () => {
  const href = 'https://example.com/nested?mode=maintenance&lab=rul-nn&source=lecture&tag=a&tag=b#igbt';
  const returned = new URL(pageUrl('maintenance', false, href), 'https://example.com');
  assert.equal(returned.pathname, '/');
  assert.equal(returned.searchParams.get('mode'), 'maintenance');
  assert.equal(returned.searchParams.has('lab'), false);
  assert.equal(returned.searchParams.get('source'), 'lecture');
  assert.deepEqual(returned.searchParams.getAll('tag'), ['a', 'b']);
  assert.equal(returned.hash, '#igbt');
  assert.deepEqual(readPageRoute(returned.search), { mode: 'maintenance', lab: false, labId: null });
});

test('RUL links replace stale and duplicate routing fields without deleting other fields', () => {
  const url = new URL(pageUrl('maintenance', 'rul-nn', '/?mode=control&mode=ai&lab=modulation-nn&lab=old&source=course#unit3'), 'https://example.com');
  assert.deepEqual(url.searchParams.getAll('mode'), ['maintenance']);
  assert.deepEqual(url.searchParams.getAll('lab'), ['rul-nn']);
  assert.equal(url.searchParams.get('source'), 'course');
  assert.equal(url.hash, '#unit3');
});

test('unknown and malformed Maintenance labs remain on the Maintenance story', () => {
  for (const value of ['', 'unknown', 'RUL-NN', 'rul-nn-extra', 'modulation-nn', '__proto__', 'constructor']) {
    assert.deepEqual(readPageRoute(`?mode=maintenance&lab=${value}`), { mode: 'maintenance', lab: false, labId: null });
    assert.equal(pageUrl('maintenance', value), '/?mode=maintenance');
  }
});
