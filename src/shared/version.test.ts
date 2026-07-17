import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  parseVersion,
  parseStableVersion,
  compareVersions,
  comparePrecedence,
  latestStableVersion,
  isPrerelease,
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

// ── Pre-release handling ────────────────────────────────────────────
//
// The daemon reports its own build from /health, and the guided installer has
// shipped rc builds ("0.10.1-rc.3"). Those must be recognised and rejected —
// parsing them to null instead silently disables every version check.

test('parseVersion keeps the pre-release suffix, and rejects only real junk', () => {
  assert.deepEqual(parseVersion('0.11.0'), { version: [0, 11, 0], prerelease: null });
  assert.deepEqual(parseVersion('v0.11.0'), { version: [0, 11, 0], prerelease: null });
  assert.deepEqual(parseVersion('0.10.1-rc.3'), { version: [0, 10, 1], prerelease: 'rc.3' });
  assert.deepEqual(parseVersion('  v1.2.3-beta  '), { version: [1, 2, 3], prerelease: 'beta' });
  assert.equal(parseVersion('antd-go/v0.9.2'), null); // prefixed
  assert.equal(parseVersion('v0.9.2.1'), null); // too many parts
  assert.equal(parseVersion('latest'), null);
  assert.equal(parseVersion(''), null);
});

test('comparePrecedence ranks a pre-release below its own stable release', () => {
  const rc = { version: [0, 10, 1] as [number, number, number], prerelease: 'rc.3' };
  const stable = { version: [0, 10, 1] as [number, number, number], prerelease: null };
  assert.ok(comparePrecedence(rc, stable) < 0); // 0.10.1-rc.3 < 0.10.1
  assert.ok(comparePrecedence(stable, rc) > 0);
  assert.equal(comparePrecedence(rc, rc), 0);
  // Core version still dominates the suffix.
  assert.ok(comparePrecedence({ version: [0, 11, 0], prerelease: 'rc.1' }, stable) > 0);
});

test('isPrerelease flags rc builds, fails safe on junk', () => {
  assert.equal(isPrerelease('0.10.1-rc.3'), true);
  assert.equal(isPrerelease('0.11.0'), false);
  assert.equal(isPrerelease('v0.11.0'), false);
  assert.equal(isPrerelease('bad'), false); // unreadable → not a pre-release
});

test('a pre-release daemon is told a newer stable release is available', () => {
  // The regression that started this: 0.11.0 was out for a week and the rc
  // daemon the installer ships was never nudged, because it parsed to null.
  assert.equal(isUpdateAvailable('0.10.1-rc.3', '0.11.0'), true);
  // An rc of the *same* core still ranks below its stable release.
  assert.equal(isUpdateAvailable('0.11.0-rc.1', '0.11.0'), true);
  // ...but not below an older one.
  assert.equal(isUpdateAvailable('0.11.0-rc.1', '0.10.0'), false);
});

test('a pre-release daemon trips the minimum-version floor', () => {
  assert.equal(isBelowMinimum('0.10.1-rc.3', '0.11.0'), true); // older core
  assert.equal(isBelowMinimum('0.11.0-rc.1', '0.11.0'), true); // rc < its stable
  // A pre-release ahead of the floor isn't "too old" — isPrerelease rejects it
  // separately, with copy that actually matches the situation.
  assert.equal(isBelowMinimum('0.12.0-rc.1', '0.11.0'), false);
  assert.equal(isPrerelease('0.12.0-rc.1'), true);
});

test('latestStableVersion never picks a pre-release, even the highest', () => {
  // Mirrors the real ant-sdk release list, where v0.10.1-rc.3 outranks every
  // stable tag by core version but must never be offered as "latest".
  const realTags = ['v0.11.0', 'v0.10.1-rc.3', 'v0.10.0', 'v0.9.2', 'v0.7.1-rc.1'];
  assert.equal(latestStableVersion(realTags), '0.11.0');
  assert.equal(latestStableVersion(['v0.12.0-rc.1', 'v0.11.0']), '0.11.0');
});
