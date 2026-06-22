/**
 * Service worker (MV3 background script).
 *
 * Responsibilities:
 *  1. Poll antd /health on a periodic alarm to track daemon status.
 *  2. Auto-detect antd via port probing (localhost 8082-8090).
 *  3. Fetch Autonomi resources on behalf of content scripts.
 *  4. Trigger file downloads via chrome.downloads API.
 */

import { AntdClient } from '../shared/antd-client';
import {
  ANTD_RELEASES_API,
  DOWNLOAD_PORT,
  HEALTH_ALARM,
  HEALTH_POLL_MS,
  MIN_ANTD_VERSION,
  STORAGE_KEYS,
  UPDATE_CHECK_INTERVAL_MS,
} from '../shared/constants';
import type { DownloadFileReq, DownloadResp, Request, Response } from '../shared/messages';
import { DEFAULT_SETTINGS, type DaemonStatus, type ExtensionSettings } from '../shared/types';
import { isBelowMinimum, isUpdateAvailable, latestStableVersion } from '../shared/version';

// ── State ───────────────────────────────────────────────────────────

let settings: ExtensionSettings = { ...DEFAULT_SETTINGS };
let client = new AntdClient(settings.daemonUrl);
// Network address → chrome.downloads id, so the in-page button can offer "Open"
// when a file has already been downloaded. Persisted (MV3 may suspend us).
let downloadsByAddress: Record<string, number> = {};
let status: DaemonStatus = {
  connected: false,
  url: settings.daemonUrl,
  lastSeen: null,
  version: null,
  latestVersion: null,
  updateAvailable: false,
  belowMinimum: false,
};

// ── Init ────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(async (details) => {
  await loadSettings();
  await loadDownloads();
  await checkHealth();
  startHealthAlarm();

  // Open the onboarding/setup guide in a full tab on first install only.
  // (Gated to 'install' — not shown on updates or browser restarts.)
  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding/index.html') });
  }
});

// Also restore state when the service worker wakes up (MV3 can suspend it).
loadSettings().then(() => checkHealth());
loadDownloads();

// ── Health polling ──────────────────────────────────────────────────

function startHealthAlarm() {
  chrome.alarms.create(HEALTH_ALARM, {
    periodInMinutes: HEALTH_POLL_MS / 60_000,
  });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === HEALTH_ALARM) checkHealth();
});

async function checkHealth(): Promise<void> {
  const health = await client.getHealth();
  status.connected = health.ok;
  status.url = settings.daemonUrl;
  status.version = health.version;
  // Compatibility floor — always evaluated, regardless of the update setting.
  status.belowMinimum = health.version
    ? isBelowMinimum(health.version, MIN_ANTD_VERSION)
    : false;
  if (health.ok) status.lastSeen = new Date().toISOString();

  await refreshUpdateStatus();

  await chrome.storage.local.set({ [STORAGE_KEYS.DAEMON_STATUS]: status });
  // Flag the toolbar icon when disconnected OR running an unsupported version.
  updateBadge(status.connected && !status.belowMinimum);
}

/**
 * True if the daemon is reachable. The in-memory `status` resets to
 * disconnected whenever the MV3 worker restarts (e.g. waking to handle a
 * message), so re-check health live before trusting a disconnected flag —
 * otherwise the first request after a wake spuriously fails.
 */
async function ensureConnected(): Promise<boolean> {
  if (status.connected) return true;
  await checkHealth();
  return status.connected;
}

// ── Update checking ─────────────────────────────────────────────────

/**
 * Compare the running antd version against the latest stable GitHub release
 * and set status.updateAvailable. Gated on the setting; the GitHub lookup is
 * cached (UPDATE_CHECK_INTERVAL_MS) so the periodic health poll doesn't spam
 * the API.
 */
async function refreshUpdateStatus(): Promise<void> {
  if (!settings.checkForUpdates || !status.connected || !status.version) {
    status.updateAvailable = false;
    return;
  }
  const latest = await getLatestRelease();
  status.latestVersion = latest;
  status.updateAvailable = latest ? isUpdateAvailable(status.version, latest) : false;
}

/** Latest stable antd version from GitHub, cached in storage. */
async function getLatestRelease(): Promise<string | null> {
  const now = Date.now();
  const stored = await chrome.storage.local.get(STORAGE_KEYS.UPDATE_CACHE);
  const cache = stored[STORAGE_KEYS.UPDATE_CACHE] as
    | { latest: string | null; checkedAt: number }
    | undefined;
  if (cache && now - cache.checkedAt < UPDATE_CHECK_INTERVAL_MS) {
    return cache.latest;
  }
  const latest = await fetchLatestStable();
  // Cache even a null result so a failed/empty lookup doesn't retry every poll.
  await chrome.storage.local.set({
    [STORAGE_KEYS.UPDATE_CACHE]: { latest, checkedAt: now },
  });
  return latest;
}

async function fetchLatestStable(): Promise<string | null> {
  try {
    const r = await fetch(ANTD_RELEASES_API, {
      signal: AbortSignal.timeout(5_000),
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!r.ok) return null;
    const releases: any[] = await r.json();
    const tags = releases
      .map((rel) => rel?.tag_name)
      .filter((t): t is string => typeof t === 'string');
    return latestStableVersion(tags);
  } catch {
    return null;
  }
}

function updateBadge(connected: boolean) {
  chrome.action.setBadgeText({ text: connected ? '' : '!' });
  chrome.action.setBadgeBackgroundColor({ color: connected ? '#22c55e' : '#ef4444' });
}

// ── Settings persistence ────────────────────────────────────────────

async function loadSettings(): Promise<void> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.SETTINGS);
  if (stored[STORAGE_KEYS.SETTINGS]) {
    settings = { ...DEFAULT_SETTINGS, ...stored[STORAGE_KEYS.SETTINGS] };
  }
  client.setBaseUrl(settings.daemonUrl);
}

async function saveSettings(next: ExtensionSettings): Promise<void> {
  settings = next;
  client.setBaseUrl(settings.daemonUrl);
  await chrome.storage.local.set({ [STORAGE_KEYS.SETTINGS]: settings });
  await checkHealth();
}

// ── Download history (address → download id) ────────────────────────

async function loadDownloads(): Promise<void> {
  const stored = await chrome.storage.local.get(STORAGE_KEYS.DOWNLOADS);
  downloadsByAddress = stored[STORAGE_KEYS.DOWNLOADS] || {};
}

async function recordDownload(address: string, id: number): Promise<void> {
  downloadsByAddress[address] = id;
  await chrome.storage.local.set({ [STORAGE_KEYS.DOWNLOADS]: downloadsByAddress });
}

async function forgetDownload(address: string): Promise<void> {
  if (!(address in downloadsByAddress)) return;
  delete downloadsByAddress[address];
  await chrome.storage.local.set({ [STORAGE_KEYS.DOWNLOADS]: downloadsByAddress });
}

/** Look up the live, on-disk download item for an address, if any. */
async function findDownload(address: string): Promise<chrome.downloads.DownloadItem | null> {
  const id = downloadsByAddress[address];
  if (id == null) return null;
  try {
    const [item] = await chrome.downloads.search({ id });
    if (item && item.state === 'complete' && item.exists) return item;
  } catch {
    /* search failed — treat as not present */
  }
  // Stale (erased, deleted, or moved) — drop it so the button reverts.
  await forgetDownload(address);
  return null;
}

// ── Port probing (daemon auto-discovery) ────────────────────────────

// ── Message handler ─────────────────────────────────────────────────

// Return a Promise from the listener — this enables structured cloning
// for the response, allowing Uint8Array transfer without base64 encoding.
// (Requires Chrome 120+; the callback-based sendResponse uses JSON only.)
chrome.runtime.onMessage.addListener(
  (msg: Request, sender): undefined | Promise<Response> => {
    if (msg?.type) return handleMessage(msg, sender);
  },
);

// Streaming-download port. The content script opens this for a download so the
// worker can push DOWNLOAD_PROGRESS ticks while the daemon streams the file,
// then a final DOWNLOAD_RESULT. The open port also keeps the MV3 worker alive
// for the whole download.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== DOWNLOAD_PORT) return;
  port.onMessage.addListener(async (msg: DownloadFileReq) => {
    if (msg?.type !== 'DOWNLOAD_FILE') return;
    const result = await performDownload(msg.address, msg.filename, (received, total) => {
      // postMessage throws if the page navigated away mid-download — ignore.
      try {
        port.postMessage({ type: 'DOWNLOAD_PROGRESS', address: msg.address, received, total });
      } catch { /* port closed */ }
    });
    try {
      port.postMessage(result);
    } catch { /* port closed */ }
    port.disconnect();
  });
});

async function handleMessage(msg: Request, sender?: chrome.runtime.MessageSender): Promise<Response> {
  switch (msg.type) {
    case 'GET_DAEMON_STATUS':
      return { type: 'DAEMON_STATUS', status };

    case 'GET_SETTINGS':
      return { type: 'SETTINGS', settings };

    case 'SAVE_SETTINGS':
      await saveSettings(msg.settings);
      return { type: 'SETTINGS', settings };

    case 'FETCH_RESOURCE': {
      if (!(await ensureConnected())) {
        return {
          type: 'RESOURCE_RESULT',
          address: msg.address,
          result: { ok: false, error: 'Daemon not connected' },
        };
      }
      try {
        const buf = await getCachedData(msg.address);

        const bytes = new Uint8Array(buf);
        const mime = msg.mimeType || sniffMime(bytes) || 'application/octet-stream';

        // chrome.runtime.sendMessage uses JSON serialization (not structured
        // cloning), so Uint8Array can't cross contexts. Encode as a base64
        // data URL for inline rendering.
        const dataUrl = `data:${mime};base64,${uint8ToBase64(bytes)}`;
        return {
          type: 'RESOURCE_RESULT',
          address: msg.address,
          result: { ok: true, dataUrl, mime, size: buf.byteLength },
        };
      } catch (e: any) {
        return {
          type: 'RESOURCE_RESULT',
          address: msg.address,
          result: { ok: false, error: e.message },
        };
      }
    }

    case 'DOWNLOAD_FILE':
      // One-shot download with no progress reporting. Content scripts use the
      // streaming port (onConnect below) instead; this remains for any caller
      // that just wants fire-and-forget.
      return performDownload(msg.address, msg.filename);

    case 'CHECK_DOWNLOADED': {
      const item = await findDownload(msg.address);
      return { type: 'DOWNLOAD_STATE', address: msg.address, downloaded: !!item };
    }

    case 'OPEN_DOWNLOAD': {
      const item = await findDownload(msg.address);
      if (!item) {
        return { type: 'DOWNLOAD_RESULT', address: msg.address, ok: false, error: 'file no longer available' };
      }
      try {
        chrome.downloads.open(item.id);
      } catch {
        // open() needs the downloads.open permission / a complete file — if it
        // fails, fall back to revealing the file in the OS file manager.
        try { chrome.downloads.show(item.id); } catch { /* nothing more to do */ }
      }
      return { type: 'DOWNLOAD_RESULT', address: msg.address, ok: true };
    }

    case 'DETECT_DAEMON': {
      // Step 1: check current URL (may already be connected).
      if (status.connected) {
        return {
          type: 'DETECT_DAEMON_RESULT',
          discoveredPort: null,
          binaryFound: true,
        };
      }
      // Step 2: probe localhost ports 8082-8090 for a running antd.
      const found = await AntdClient.probe();
      if (found) {
        settings.daemonUrl = found;
        await saveSettings(settings); // also triggers health check
        const port = parseInt(new URL(found).port, 10);
        return {
          type: 'DETECT_DAEMON_RESULT',
          discoveredPort: port,
          binaryFound: true,
        };
      }
      return {
        type: 'DETECT_DAEMON_RESULT',
        discoveredPort: null,
        binaryFound: false,
      };
    }

    case 'UPDATE_BADGE': {
      const tabId = sender?.tab?.id;
      const count = msg.count;
      if (tabId != null && status.connected) {
        chrome.action.setBadgeText({ text: count > 0 ? String(count) : '', tabId });
        chrome.action.setBadgeBackgroundColor({ color: '#60a5fa', tabId });
      }
      return { type: 'DAEMON_STATUS', status }; // ack
    }
  }
}

// ── Download ────────────────────────────────────────────────────────

/**
 * Fetch `address` and hand the bytes to chrome.downloads. Prefers the
 * streaming endpoint (raw bytes + progress via `onProgress`), falling back to
 * the buffered getData path on daemons that predate /stream. Returns a
 * DownloadResp rather than throwing, so both the message and port callers can
 * forward it directly.
 */
async function performDownload(
  address: string,
  filename?: string,
  onProgress?: (received: number, total: number | null) => void,
): Promise<DownloadResp> {
  if (!(await ensureConnected())) {
    return { type: 'DOWNLOAD_RESULT', address, ok: false, error: 'Daemon not connected' };
  }
  const fname =
    (filename && sanitizeFilename(filename)) || `autonomi-${address.slice(0, 12)}`;
  try {
    // Stream the raw bytes (reports progress, skips the daemon-side base64 +
    // JSON). Older daemons lack the endpoint (404) — fall back to getData,
    // which also resolves DataMaps and raw chunks.
    let buf: ArrayBuffer;
    try {
      buf = await client.streamData(address, onProgress);
    } catch (e: any) {
      if (e?.streamUnsupported) {
        console.debug('[ant-webex] /stream unavailable; falling back to getData');
        buf = await client.getData(address);
      } else {
        throw e;
      }
    }
    const bytes = new Uint8Array(buf);
    const mime = sniffMime(bytes) || 'application/octet-stream';

    // Pick the download source per browser. Chrome's MV3 service worker has no
    // URL.createObjectURL, so it uses a data: URL. Firefox's event-page
    // background has createObjectURL and *refuses* to download data: URLs
    // ("Access denied"), so it uses a blob: URL.
    let url: string;
    let objectUrl: string | null = null;
    if (typeof URL.createObjectURL === 'function') {
      objectUrl = URL.createObjectURL(new Blob([bytes], { type: mime }));
      url = objectUrl;
    } else {
      url = `data:${mime};base64,${uint8ToBase64(bytes)}`;
    }

    try {
      const id = await chrome.downloads.download({ url, filename: fname, saveAs: false });
      // Firefox's chrome.* namespace can report failures via lastError
      // rather than rejecting the promise, so check it explicitly.
      const lastErr = (chrome.runtime as any)?.lastError;
      if (lastErr) throw new Error(lastErr.message);
      // Revoke the blob URL once the download reaches a terminal state —
      // revoking earlier can cancel an in-flight download.
      if (objectUrl) revokeWhenDone(id, objectUrl);
      // Remember it so the in-page button can later offer "Open".
      await recordDownload(address, id);
      console.debug(`[ant-webex] download started: ${fname} (${bytes.length} bytes, id ${id})`);
      return { type: 'DOWNLOAD_RESULT', address, ok: true };
    } catch (e) {
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      throw e;
    }
  } catch (e: any) {
    // Log so failures are visible in the background console — the fetch error
    // carries the failing endpoint + status (e.g. .../stream: 500).
    console.error(`[ant-webex] download failed for ${address} → ${fname}:`, e);
    return { type: 'DOWNLOAD_RESULT', address, ok: false, error: e?.message || 'download failed' };
  }
}

// ── Cache ──────────────────────────────────────────────────────────

const CACHE_NAME = 'ant-resources';

/**
 * Fetch data by address, checking the Cache API first.
 * Autonomi data is content-addressed (immutable), so cache entries never go stale.
 * Falls back to direct fetch when Cache API is unavailable (Firefox event pages).
 */
async function getCachedData(address: string): Promise<ArrayBuffer> {
  if (typeof caches === 'undefined') return client.getData(address);

  const cacheKey = `https://ant-cache/${address}`;
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(cacheKey);
  if (cached) return cached.arrayBuffer();

  const buf = await client.getData(address);
  await cache.put(cacheKey, new Response(buf));
  return buf;
}

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Sanitize a page-supplied download filename. The ?name= param (and the HTML
 * download attribute) are author-controlled, so reduce to a bare basename,
 * drop path separators, control characters, and leading dots, and cap the
 * length. Returns '' if nothing usable remains, so the caller can fall back.
 * chrome.downloads also blocks traversal, but we write straight to Downloads
 * (saveAs:false) and shouldn't rely solely on that.
 */
function sanitizeFilename(name: string): string {
  const base = name.split(/[/\\]/).pop() ?? '';
  return base
    .replace(/[\x00-\x1f<>:"|?*]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 200);
}

/**
 * Revoke a blob object URL once its download reaches a terminal state, then
 * detach the listener. Used only on the Firefox (blob:) path.
 */
function revokeWhenDone(id: number, objectUrl: string): void {
  const onChanged = (delta: chrome.downloads.DownloadDelta) => {
    if (delta.id !== id || !delta.state) return;
    if (delta.state.current === 'complete' || delta.state.current === 'interrupted') {
      URL.revokeObjectURL(objectUrl);
      chrome.downloads.onChanged.removeListener(onChanged);
    }
  };
  chrome.downloads.onChanged.addListener(onChanged);
}

/** Convert a Uint8Array to a base64 string. */
function uint8ToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/** Sniff MIME type from magic bytes. Covers the common inline-renderable types. */
function sniffMime(data: Uint8Array): string | null {
  if (data.length < 4) return null;
  const h = (data[0] << 24) | (data[1] << 16) | (data[2] << 8) | data[3];

  if (h === 0x89504e47) return 'image/png';
  if ((h >>> 8) === 0xffd8ff) return 'image/jpeg';
  if (h === 0x47494638) return 'image/gif';
  if (h === 0x52494646 && data.length >= 12 && data[8] === 0x57 && data[9] === 0x45 && data[10] === 0x42 && data[11] === 0x50) return 'image/webp';
  if (h === 0x25504446) return 'application/pdf';
  if (data[0] === 0x1a && data[1] === 0x45 && data[2] === 0xdf && data[3] === 0xa3) return 'video/webm';
  if (h === 0x00000020 || h === 0x00000018 || (data[4] === 0x66 && data[5] === 0x74 && data[6] === 0x79 && data[7] === 0x70)) return 'video/mp4';
  if ((h >>> 16) === 0x4944 && data[2] === 0x33) return 'audio/mpeg'; // ID3 tag
  if (h === 0x4f676753) return 'audio/ogg';
  if (data[0] === 0x3c) return 'text/html'; // leading '<'

  return null;
}
