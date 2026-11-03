import assert from 'node:assert/strict';
import test from 'node:test';
import { sameFeature, slugFiles, STAGE_FILE } from '../src/names.mjs';

test('STAGE_FILE reads a ticket key, a 12-digit timestamp and the slug', () => {
  const [, key, date, slug] = 'GGQPA-169-202603061530-[Feat]-api-user-registration.md'.match(STAGE_FILE);
  assert.deepEqual([key, date, slug], ['GGQPA-169', '202603061530', 'api-user-registration']);
});

test('STAGE_FILE reads a bare prefix, an 8-digit date, and drops a -V2 suffix', () => {
  const [, key, date, slug] = 'ABC-20261014-[Requirements]-map-opens-V2.md'.match(STAGE_FILE);
  assert.deepEqual([key, date, slug], ['ABC', '20261014', 'map-opens']);
});

test('STAGE_FILE ignores files with no stage tag', () => {
  assert.equal('CHANGELOG.md'.match(STAGE_FILE), null);
});

test('sameFeature matches a slug with a platform prefix, in either order', () => {
  assert.ok(sameFeature('token-usage-billing', 'api-token-usage-billing'));
  assert.ok(sameFeature('web-map-opens', 'map-opens'));
  assert.ok(!sameFeature('map-opens', 'map-closes'));
});

test('slugFiles keeps prefixed and versioned files of the slug, and no other', () => {
  const files = [
    'spdd/prompt/X-20261014-[Create]-web-map-opens.md',
    'spdd/prompt/X-20261015-[Create]-map-opens-V2.md',
    'spdd/prompt/X-20261014-[Create]-other-map-opens-later.md',
  ];
  assert.deepEqual(slugFiles(files, 'map-opens'), files.slice(0, 2));
  assert.deepEqual(slugFiles(files, null), []);
});
