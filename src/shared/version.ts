/**
 * Semver helpers for the antd update checker.
 *
 * antd reports a bare semver from /health (e.g. "0.9.2"). The ant-sdk repo
 * tags stable releases as `vX.Y.Z` and language-binding releases as
 * `antd-<lang>/vX.Y.Z`, with `-rc.N` for pre-releases. We only ever compare
 * the bare `vX.Y.Z` line, so parsing rejects prefixed and pre-release tags.
 */

export type Version = [number, number, number];

/**
 * Parse a stable release version into [major, minor, patch].
 * Accepts "0.9.2" or "v0.9.2". Returns null for anything else —
 * prefixed tags ("antd-go/v0.9.2"), pre-releases ("v0.7.1-rc.1"), or junk.
 */
export function parseStableVersion(tag: string): Version | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(tag.trim());
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

/** Compare two versions: >0 if a is newer, <0 if older, 0 if equal. */
export function compareVersions(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * Given a list of git tag names, return the highest stable version as
 * "x.y.z", or null if none parse. Prefixed/pre-release tags are ignored.
 */
export function latestStableVersion(tags: string[]): string | null {
  let best: Version | null = null;
  for (const tag of tags) {
    const v = parseStableVersion(tag);
    if (v && (best === null || compareVersions(v, best) > 0)) best = v;
  }
  return best ? best.join('.') : null;
}

/** True if `latest` is strictly newer than `current` (both "x.y.z" / "vx.y.z"). */
export function isUpdateAvailable(current: string, latest: string): boolean {
  const c = parseStableVersion(current);
  const l = parseStableVersion(latest);
  if (!c || !l) return false;
  return compareVersions(l, c) > 0;
}

/** True if `current` is older than the required `min` version. */
export function isBelowMinimum(current: string, min: string): boolean {
  const c = parseStableVersion(current);
  const m = parseStableVersion(min);
  if (!c || !m) return false;
  return compareVersions(c, m) < 0;
}
