/** URI prefix for Autonomi network addresses. */
export const ANT_PROTOCOL = 'autonomi://';

/** Default antd REST API port. */
export const ANTD_DEFAULT_PORT = 8082;

/** Default antd base URL (localhost, no trailing slash). */
export const ANTD_DEFAULT_URL = `http://localhost:${ANTD_DEFAULT_PORT}`;

/** How often (ms) the service worker polls antd /health. */
export const HEALTH_POLL_MS = 30_000;

/** Chrome native messaging host name — must match native-host manifest. */
export const NATIVE_HOST_NAME = 'com.autonomi.webex';

/** Chrome alarm name for periodic health checks. */
export const HEALTH_ALARM = 'antd-health';

/**
 * chrome.runtime.connect port name for streamed downloads. A long-lived port
 * (rather than a one-shot sendMessage) lets the service worker push progress
 * updates back to the content script while the daemon streams the file, and
 * keeps the MV3 worker alive for the duration of the download.
 */
export const DOWNLOAD_PORT = 'ant-download';

/**
 * Platform-specific paths where antd writes its daemon.port file.
 * The native messaging host reads these — the extension itself cannot
 * access the filesystem.
 *
 * NOTE: antd writes under the `ant/sdk/` subdir (see antd/src/port_file.rs),
 * keeping it separate from the ant-node daemon which uses the `ant/` umbrella.
 */
export const DAEMON_PORT_PATHS: Record<string, string> = {
  win32: '%APPDATA%/ant/sdk/daemon.port',
  linux: '~/.local/share/ant/sdk/daemon.port',
  darwin: '~/Library/Application Support/ant/sdk/daemon.port',
};

// ── Installer download (guided local-daemon install) ─────────────────
//
// When no local antd is detected, the popup offers a one-click download of a
// signed installer asset. The extension only *downloads* the file; the user
// runs it. The installer is responsible for autostart + `--cors` (see
// project memory: install-strategy).

/** OS keys used to pick the right installer asset. */
export type OsKey = 'windows' | 'macos' | 'linux';

/** GitHub repo publishing antd installer assets. */
export const ANTD_RELEASE_REPO = 'WithAutonomi/ant-sdk';

/**
 * Pinned release tag — a specific tag (not a moving branch) so the downloaded
 * binary is reproducible and auditable. Matches the current SDK line and the
 * MIN_ANTD_VERSION floor.
 * NOTE: the installer *asset filenames* (below) still need to be finalized
 * (awaiting correct installer paths) before this download URL resolves.
 */
export const ANTD_RELEASE_TAG = 'v0.9.2';

/** Releases landing page — fallback / "other builds" link. */
export const ANTD_RELEASES_URL = `https://github.com/${ANTD_RELEASE_REPO}/releases`;

/**
 * Installer asset filename per OS within the pinned release.
 * TODO: confirm exact asset names (and arch variants, e.g. arm64) once the
 * release artifacts are finalized.
 */
export const ANTD_INSTALLER_ASSETS: Record<OsKey, string> = {
  // Windows ships an MSI, matching the Autonomi GUI (Tauri WiX bundle) and its
  // existing signing pipeline. NOTE: Tauri names MSIs with the version baked in
  // (e.g. Autonomi_x.y.z_x64_en-US.msi); the release must publish it under this
  // stable filename so the download URL resolves. See INSTALLER.md §3.
  windows: 'antd-windows-x64-setup.msi',
  macos: 'antd-macos.pkg',
  linux: 'antd-linux-x64.deb',
};

/** Build the direct download URL for a given OS's pinned installer asset. */
export function installerDownloadUrl(os: OsKey): string {
  return `https://github.com/${ANTD_RELEASE_REPO}/releases/download/${ANTD_RELEASE_TAG}/${ANTD_INSTALLER_ASSETS[os]}`;
}

/**
 * GitHub API: list releases — used by the update checker to find the latest
 * stable `vX.Y.Z` release. GitHub sends CORS headers (ACAO: *), so this is
 * reachable from the service worker without a host permission.
 */
export const ANTD_RELEASES_API = `https://api.github.com/repos/${ANTD_RELEASE_REPO}/releases?per_page=100`;

/** How often (ms) to re-check GitHub for a newer antd release. */
export const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

/**
 * Minimum antd version the extension's REST usage requires. When the running
 * daemon is older, the popup shows a hard "update required" warning (this is
 * independent of the optional update-available nudge).
 *
 * The extension ships fresh against the current SDK, so the floor is set to
 * the current antd release (v0.9.2). Bump this when the extension starts
 * relying on endpoints/behavior added in a later antd version.
 */
export const MIN_ANTD_VERSION = '0.9.2';

/** Map the current user agent to an installer OS key, or null if unknown. */
export function detectOs(): OsKey | null {
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('win')) return 'windows';
  if (ua.includes('mac')) return 'macos';
  if (ua.includes('linux') || ua.includes('x11')) return 'linux';
  return null;
}

/** Human-readable OS label for UI copy. */
export const OS_LABELS: Record<OsKey, string> = {
  windows: 'Windows',
  macos: 'macOS',
  linux: 'Linux',
};

/**
 * Per-OS hints for the popup's "already installed antd? find & run it" guide,
 * shown when the daemon isn't detected. The audience is mixed-technical, so the
 * copy stays plain. The extension talks to antd over REST and requires the
 * `--cors` flag (see RUN_COMMAND); the run command is the same on every OS once
 * antd is on the PATH.
 *
 * `installPath` is the conventional install location per installer type
 * (best-effort). `portFile` is authoritative (mirrors DAEMON_PORT_PATHS): if
 * that file exists, antd has run at least once.
 */
export interface RunGuide {
  /** How to open a terminal on this OS. */
  terminal: string;
  /** Conventional install location of the antd program. */
  installPath: string;
  /** Where antd writes its daemon.port file once running. */
  portFile: string;
}

/** The command to start antd so the extension can reach it. */
export const ANTD_RUN_COMMAND = 'antd --cors';

export const ANTD_RUN_GUIDE: Record<OsKey, RunGuide> = {
  // TODO (awaiting correct installer paths): the `installPath` values below are
  // conventional best-guesses per installer type. Confirm each against the real
  // installer once the asset locations are finalized.
  windows: {
    terminal: 'press Win, type “PowerShell”, then Enter',
    installPath: 'C:\\Program Files\\Autonomi\\antd\\antd.exe',
    portFile: '%APPDATA%\\ant\\sdk\\daemon.port',
  },
  macos: {
    terminal: 'press Cmd+Space, type “Terminal”, then Enter',
    installPath: '/usr/local/bin/antd',
    portFile: '~/Library/Application Support/ant/sdk/daemon.port',
  },
  linux: {
    terminal: 'press Ctrl+Alt+T (or open your terminal app)',
    installPath: '/usr/bin/antd',
    portFile: '~/.local/share/ant/sdk/daemon.port',
  },
};

/** Storage keys used in chrome.storage.local. */
export const STORAGE_KEYS = {
  SETTINGS: 'settings',
  DAEMON_STATUS: 'daemonStatus',
  UPDATE_CACHE: 'updateCache',
  /** Map of network address → chrome.downloads id for completed downloads. */
  DOWNLOADS: 'downloads',
} as const;
