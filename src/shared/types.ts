// ── Daemon ──────────────────────────────────────────────────────────

export interface DaemonStatus {
  connected: boolean;
  url: string;
  /** ISO-8601 timestamp of last successful health check. */
  lastSeen: string | null;
  /** antd version reported by /health (bare semver), or null if unknown. */
  version: string | null;
  /** Latest stable antd release from GitHub, or null if not checked. */
  latestVersion: string | null;
  /** True when latestVersion is newer than the running version. */
  updateAvailable: boolean;
  /** True when the running version is older than MIN_ANTD_VERSION. */
  belowMinimum: boolean;
}

// ── Settings ────────────────────────────────────────────────────────

export interface ExtensionSettings {
  /** antd REST base URL (no trailing slash). */
  daemonUrl: string;
  /** Automatically fetch and render inline autonomi:// resources. */
  autoFetchInline: boolean;
  /**
   * Maximum byte size to auto-fetch for inline rendering.
   * 0 = unlimited. Prevents accidentally loading huge files into the DOM.
   */
  maxInlineBytes: number;
  /** Periodically check GitHub for a newer antd release. */
  checkForUpdates: boolean;
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  daemonUrl: 'http://localhost:8082',
  autoFetchInline: true,
  maxInlineBytes: 50 * 1024 * 1024, // 50 MB
  checkForUpdates: true,
};

// ── Content script detection ────────────────────────────────────────

export type AntElementKind = 'link' | 'image' | 'video' | 'audio' | 'embed';

export interface AntElement {
  kind: AntElementKind;
  /** Network address (the part after autonomi://). */
  address: string;
  /** Optional MIME type hint from data-ant-type attribute. */
  mimeType?: string;
}

// ── Download ────────────────────────────────────────────────────────

export interface FetchResult {
  ok: boolean;
  /** Data URL (base64-encoded) for inline rendering. */
  dataUrl?: string;
  /** MIME type of the resource. */
  mime?: string;
  /** Byte length of the fetched data. */
  size?: number;
  error?: string;
}
