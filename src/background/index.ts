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
  HEALTH_ALARM,
  HEALTH_POLL_MS,
  MIN_ANTD_VERSION,
  STORAGE_KEYS,
  UPDATE_CHECK_INTERVAL_MS,
} from '../shared/constants';
import type { Request, Response } from '../shared/messages';
import { DEFAULT_SETTINGS, type DaemonStatus, type ExtensionSettings } from '../shared/types';
import { isBelowMinimum, isUpdateAvailable, latestStableVersion } from '../shared/version';

// ── State ───────────────────────────────────────────────────────────

let settings: ExtensionSettings = { ...DEFAULT_SETTINGS };
let client = new AntdClient(settings.daemonUrl);
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
      if (!status.connected) {
        return {
          type: 'RESOURCE_RESULT',
          address: msg.address,
          result: { ok: false, error: 'Daemon not connected' },
        };
      }
      try {
        const buf = await getCachedData(msg.address);

        // Enforce max inline size (0 = unlimited).
        if (settings.maxInlineBytes > 0 && buf.byteLength > settings.maxInlineBytes) {
          const sizeMB = (buf.byteLength / (1024 * 1024)).toFixed(1);
          const limitMB = (settings.maxInlineBytes / (1024 * 1024)).toFixed(0);
          return {
            type: 'RESOURCE_RESULT',
            address: msg.address,
            result: { ok: false, error: `Resource too large (${sizeMB} MB, limit ${limitMB} MB)` },
          };
        }

        const bytes = new Uint8Array(buf);
        const mime = msg.mimeType || sniffMime(bytes) || 'application/octet-stream';

        // chrome.runtime.sendMessage uses JSON serialization (not structured
        // cloning), so Uint8Array can't cross contexts. Encode as base64 data
        // URL — bounded by maxInlineBytes. Downloads use blob URLs instead.
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

    case 'DOWNLOAD_FILE': {
      if (!status.connected) {
        return {
          type: 'DOWNLOAD_RESULT',
          address: msg.address,
          ok: false,
          error: 'Daemon not connected',
        };
      }
      try {
        const buf = await getCachedData(msg.address);
        const bytes = new Uint8Array(buf);
        const mime = sniffMime(bytes) || 'application/octet-stream';
        // Blob URL stays in service worker context — no cross-context issue.
        const blob = new Blob([buf], { type: mime });
        const blobUrl = URL.createObjectURL(blob);
        const filename = msg.filename || `autonomi-${msg.address.slice(0, 12)}`;

        await chrome.downloads.download({ url: blobUrl, filename, saveAs: true });
        URL.revokeObjectURL(blobUrl);
        return { type: 'DOWNLOAD_RESULT', address: msg.address, ok: true };
      } catch (e: any) {
        return {
          type: 'DOWNLOAD_RESULT',
          address: msg.address,
          ok: false,
          error: e.message,
        };
      }
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
