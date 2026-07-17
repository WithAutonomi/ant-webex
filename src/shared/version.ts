/**
 * Semver helpers for the antd update checker.
 *
 * antd reports its own version from /health — a bare semver for a stable build
 * ("0.11.0"), or one with a pre-release suffix for an rc ("0.10.1-rc.3"). The
 * ant-sdk repo tags stable releases as `vX.Y.Z` and language-binding releases
 * as `antd-<lang>/vX.Y.Z`, with `-rc.N` for pre-releases.
 *
 * Two jobs, deliberately kept apart:
 *
 *  - Picking the latest *release* off GitHub. A pre-release must never win, so
 *    parsing drops it outright (parseStableVersion → latestStableVersion).
 *
 *  - Judging the *running daemon*. A pre-release must be recognised so it can
 *    be rejected — the extension only supports stable builds. Dropping it here
 *    would be worse than useless: an unreadable version silently disables both
 *    the update nudge and the compatibility floor, which is exactly how an rc
 *    daemon used to sail past both checks unnoticed.
 *
 * Only genuinely unreadable input (a prefixed tag, junk) parses to null, and
 * that case always fails safe — we never warn about a version we can't read.
 */

export type Version = [number, number, number];

export interface ParsedVersion {
  version: Version;
  /** Pre-release suffix, without the leading "-" (e.g. "rc.3"), or null. */
  prerelease: string | null;
}

const SEMVER = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

/**
 * Parse any semver, keeping the pre-release suffix.
 * Accepts "0.11.0", "v0.11.0", "0.10.1-rc.3". Returns null only for input that
 * isn't a semver at all — prefixed tags ("antd-go/v0.9.2") or junk.
 */
export function parseVersion(tag: string): ParsedVersion | null {
  const m = SEMVER.exec(tag.trim());
  if (!m) return null;
  return {
    version: [Number(m[1]), Number(m[2]), Number(m[3])],
    prerelease: m[4] ?? null,
  };
}

/**
 * Parse a *stable* version into [major, minor, patch].
 * Accepts "0.9.2" or "v0.9.2". Returns null for anything else —
 * prefixed tags ("antd-go/v0.9.2"), pre-releases ("v0.7.1-rc.1"), or junk.
 */
export function parseStableVersion(tag: string): Version | null {
  const parsed = parseVersion(tag);
  return parsed && !parsed.prerelease ? parsed.version : null;
}

/** Compare two versions: >0 if a is newer, <0 if older, 0 if equal. */
export function compareVersions(a: Version, b: Version): number {
  for (let i = 0; i < 3; i++) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * Semver precedence: compare the x.y.z core, then rank a pre-release below its
 * own stable release ("0.10.1-rc.3" < "0.10.1"). Two pre-releases of the same
 * core compare equal — antd runs one rc line at a time, so ranking rc.1 against
 * rc.2 buys nothing.
 */
export function comparePrecedence(a: ParsedVersion, b: ParsedVersion): number {
  const core = compareVersions(a.version, b.version);
  if (core !== 0) return core;
  if (a.prerelease && !b.prerelease) return -1;
  if (!a.prerelease && b.prerelease) return 1;
  return 0;
}

/** Wrap a stable [x,y,z] as a ParsedVersion for precedence comparisons. */
function stable(version: Version): ParsedVersion {
  return { version, prerelease: null };
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

/**
 * True if `current` is a pre-release build (e.g. "0.10.1-rc.3"). The extension
 * supports stable antd releases only, so this is a reject — see the popup's
 * pre-release warning. Unreadable input is not a pre-release (fail safe).
 */
export function isPrerelease(current: string): boolean {
  return parseVersion(current)?.prerelease != null;
}

/**
 * True if the latest stable release is newer than what's running. `current` may
 * be a pre-release ("0.10.1-rc.3"), which ranks below its own stable release,
 * so an rc is correctly told that a stable build is available.
 */
export function isUpdateAvailable(current: string, latest: string): boolean {
  const c = parseVersion(current);
  const l = parseStableVersion(latest);
  if (!c || !l) return false;
  return comparePrecedence(stable(l), c) > 0;
}

/**
 * True if `current` is older than the required `min` version. Pre-release
 * precedence applies, so "0.11.0-rc.1" is below a "0.11.0" floor. A pre-release
 * *newer* than the floor is not "too old" — it's rejected separately by
 * isPrerelease, which carries the accurate message.
 */
export function isBelowMinimum(current: string, min: string): boolean {
  const c = parseVersion(current);
  const m = parseStableVersion(min);
  if (!c || !m) return false;
  return comparePrecedence(c, stable(m)) < 0;
}
