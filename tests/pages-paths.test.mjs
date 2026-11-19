import test from 'node:test';
import assert from 'node:assert/strict';
import { pageUrl, readPageRoute, sitePath } from '../src/controlLabNavigation.js';

const origin = 'https://xinzelee.github.io';
const bases = ['/', '/power-converter-explorer/'];
const labs = [
  ['design', 'geometry-nn'],
  ['control', 'modulation-nn'],
  ['maintenance', 'rul-nn'],
];

test('site links and downloaded model records stay within the configured deployment base', () => {
  for (const base of bases) {
    assert.equal(sitePath('', base), base);
    assert.equal(sitePath('/', base), base);
    for (const path of [
      'models/design-nn-4d/model.json',
      'models/design-nn-4d/samples.csv',
      'models/design-nn/source/tpel2019_2R.json',
      'models/control-nn/model.json',
      'models/rul-nn/provenance.json',
    ]) {
      const resolved = new URL(sitePath(`/${path}`, base), origin);
      assert.equal(resolved.pathname, `${base}${path}`);
      assert.equal(resolved.origin, origin);
    }
  }
  assert.equal(sitePath('/models/rul-nn/provenance.json', '/power-converter-explorer'),
    '/power-converter-explorer/models/rul-nn/provenance.json');
});

test('direct lab links and return routes remain on their deployment path', () => {
  for (const base of bases) for (const [mode, labId] of labs) {
    const original = `${origin}${base}?source=course&tag=one&tag=two#slide`;
    const lab = new URL(pageUrl(mode, labId, original, base), origin);
    assert.equal(lab.pathname, base);
    assert.deepEqual(readPageRoute(lab.search), { mode, lab: true, labId });
    assert.deepEqual(lab.searchParams.getAll('tag'), ['one', 'two']);
    assert.equal(lab.searchParams.get('source'), 'course');
    assert.equal(lab.hash, '#slide');

    const story = new URL(pageUrl(mode, false, lab.href, base), origin);
    assert.equal(story.pathname, base);
    assert.deepEqual(readPageRoute(story.search), { mode, lab: false, labId: null });
    assert.equal(story.searchParams.get('source'), 'course');
    assert.equal(story.hash, '#slide');

    const explorer = new URL(pageUrl('overview', false, story.href, base), origin);
    assert.equal(explorer.pathname, base);
    assert.deepEqual(readPageRoute(explorer.search), { mode: 'overview', lab: false, labId: null });
  }
});

test('a changed deployment base does not retain foreign modes or duplicate lab parameters', () => {
  const base = '/power-converter-explorer/';
  const current = `${origin}${base}?mode=control&mode=ai&lab=modulation-nn&lab=old&source=lecture#notes`;
  const url = new URL(pageUrl('design', 'geometry-nn', current, base), origin);
  assert.equal(url.pathname, base);
  assert.deepEqual(url.searchParams.getAll('mode'), ['design']);
  assert.deepEqual(url.searchParams.getAll('lab'), ['geometry-nn']);
  assert.equal(url.searchParams.get('source'), 'lecture');
  assert.equal(url.hash, '#notes');
  assert.equal(pageUrl('maintenance', 'geometry-nn', current, base),
    `${base}?mode=maintenance&source=lecture#notes`);
});
