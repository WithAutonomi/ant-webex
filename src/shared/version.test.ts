import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseStableVersion,
  compareVersions,
  latestStableVersion,
  isUpdateAvailable,
  isBelowMinimum,
} from './version.ts';

test('parseStableVersion accepts bare and v-prefixed semver', () => {
  assert.deepEqual(parseStableVersion('0.9.2'), [0, 9, 2]);
  assert.deepEqual(parseStableVersion('v0.9.2'), [0, 9, 2]);
  assert.deepEqual(parseStableVersion('  v1.2.3  '), [1, 2, 3]); // trims
  assert.deepEqual(parseStableVersion('10.20.30'), [10, 20, 30]);
});

test('parseStableVersion rejects prefixed, pre-release, and malformed tags', () => {
  assert.equal(parseStableVersion('antd-go/v0.9.2'), null); // language-binding prefix
  assert.equal(parseStableVersion('v0.7.1-rc.1'), null); // pre-release
  assert.equal(parseStableVersion('0.9'), null); // not x.y.z
  assert.equal(parseStableVersion('v0.9.2.1'), null); // too many parts
  assert.equal(parseStableVersion('latest'), null);
  assert.equal(parseStableVersion(''), null);
});

test('compareVersions orders by major, then minor, then patch', () => {
  assert.equal(compareVersions([1, 0, 0], [1, 0, 0]), 0);
  assert.ok(compareVersions([2, 0, 0], [1, 9, 9]) > 0);
  assert.ok(compareVersions([1, 2, 0], [1, 1, 9]) > 0);
  assert.ok(compareVersions([1, 1, 2], [1, 1, 1]) > 0);
  assert.ok(compareVersions([1, 0, 0], [1, 0, 1]) < 0);
});

test('latestStableVersion picks the highest, ignoring prefixed and pre-release tags', () => {
  const tags = [
    'v0.9.0',
    'antd-go/v0.9.2', // ignored (prefixed) — would otherwise be highest
    'v0.10.0',
    'v0.9.1',
    'v0.11.0-rc.1', // ignored (pre-release)
    'garbage',
  ];
  assert.equal(latestStableVersion(tags), '0.10.0');
});

test('latestStableVersion returns null when nothing parses', () => {
  assert.equal(latestStableVersion([]), null);
  assert.equal(latestStableVersion(['antd-go/v1.0.0', 'v2.0.0-rc.1', 'nope']), null);
});

test('isUpdateAvailable is true only when latest is strictly newer', () => {
  assert.equal(isUpdateAvailable('0.9.2', '0.10.0'), true);
  assert.equal(isUpdateAvailable('0.9.2', '0.9.2'), false); // equal
  assert.equal(isUpdateAvailable('0.10.0', '0.9.2'), false); // older
  assert.equal(isUpdateAvailable('0.9.2', 'v0.9.3'), true); // v-prefix tolerated
  assert.equal(isUpdateAvailable('0.9.2', 'not-a-version'), false); // unparseable
});

test('isBelowMinimum is true only when current is older than the floor', () => {
  assert.equal(isBelowMinimum('0.9.1', '0.9.2'), true);
  assert.equal(isBelowMinimum('0.9.2', '0.9.2'), false); // equal meets floor
  assert.equal(isBelowMinimum('0.10.0', '0.9.2'), false); // newer
  assert.equal(isBelowMinimum('bad', '0.9.2'), false); // unparseable → don't false-warn
});
