/**
 * Popup script — daemon status, page resource list, settings.
 */

import type {
  Request,
  DaemonStatusResp,
  SettingsResp,
  DetectDaemonResp,
} from '../shared/messages';
import type { ExtensionSettings } from '../shared/types';
import {
  ANTD_INSTALLER_ASSETS,
  ANTD_RELEASES_URL,
  detectOs,
  installerDownloadUrl,
  MIN_ANTD_VERSION,
} from '../shared/constants';

// ── DOM refs ────────────────────────────────────────────────────────

const statusDot = document.getElementById('status-dot')!;
const statusText = document.getElementById('status-text')!;
const daemonUrlEl = document.getElementById('daemon-url')!;
const antdVersion = document.getElementById('antd-version')!;
const updateNudge = document.getElementById('update-nudge')!;
const latestVersionEl = document.getElementById('latest-version')!;
const updateLink = document.getElementById('update-link') as HTMLAnchorElement;
const versionWarning = document.getElementById('version-warning')!;
const minVersionEl = document.getElementById('min-version')!;
const warningUpdateLink = document.getElementById('warning-update-link') as HTMLAnchorElement;
const connectedView = document.getElementById('connected-view')!;
const disconnectedView = document.getElementById('disconnected-view')!;
const noResources = document.getElementById('no-resources')!;
const resourceList = document.getElementById('resource-list')!;
const downloadList = document.getElementById('download-list')!;
const noDownloads = document.getElementById('no-downloads')!;
const btnClearDownloads = document.getElementById('btn-clear-downloads') as HTMLButtonElement;
const installInfo = document.getElementById('install-info')!;
const installFile = document.getElementById('install-file')!;
const installReleasesLink = document.getElementById('install-releases-link') as HTMLAnchorElement;

const btnDetect = document.getElementById('btn-detect') as HTMLButtonElement;
const btnInstall = document.getElementById('btn-install') as HTMLButtonElement;
const setupLinks = document.querySelectorAll<HTMLAnchorElement>('.open-setup');
const btnSave = document.getElementById('btn-save') as HTMLButtonElement;
const inputUrl = document.getElementById('input-url') as HTMLInputElement;
const inputAutoFetch = document.getElementById('input-auto-fetch') as HTMLInputElement;
const inputCheckUpdates = document.getElementById('input-check-updates') as HTMLInputElement;

// ── Helpers ─────────────────────────────────────────────────────────

async function send<T>(msg: Request): Promise<T> {
  return chrome.runtime.sendMessage(msg);
}

function show(el: HTMLElement) {
  el.classList.remove('hidden');
}
function hide(el: HTMLElement) {
  el.classList.add('hidden');
}

// ── Status ──────────────────────────────────────────────────────────

async function refreshStatus() {
  const resp = await send<DaemonStatusResp>({ type: 'GET_DAEMON_STATUS' });
  const s = resp?.status;
  if (!s) return; // service worker waking up / older build — try again next tick

  if (s.connected) {
    statusDot.className = 'connected';
    statusText.textContent = 'Connected';
    daemonUrlEl.textContent = s.url;
    antdVersion.textContent = s.version ?? 'unknown';
    if (s.belowMinimum) {
      // Hard compatibility warning takes precedence over the update nudge.
      minVersionEl.textContent = MIN_ANTD_VERSION;
      warningUpdateLink.href = ANTD_RELEASES_URL;
      show(versionWarning);
      hide(updateNudge);
    } else if (s.updateAvailable && s.latestVersion) {
      hide(versionWarning);
      latestVersionEl.textContent = s.latestVersion;
      updateLink.href = ANTD_RELEASES_URL;
      show(updateNudge);
    } else {
      hide(versionWarning);
      hide(updateNudge);
    }
    show(connectedView);
    hide(disconnectedView);
    stopAutoPoll();
  } else {
    statusDot.className = 'disconnected';
    statusText.textContent = 'Daemon not detected';
    hide(connectedView);
    show(disconnectedView);
    startAutoPoll();
  }
}

// ── Auto-poll while disconnected ────────────────────────────────────
// Re-probe for antd every few seconds so the popup reconnects on its own
// once the daemon starts (e.g. right after the user runs the installer).
// The interval is cleared automatically on connect or when the popup closes.

const POLL_INTERVAL_MS = 3_000;
let pollTimer: ReturnType<typeof setInterval> | null = null;

function startAutoPoll() {
  if (pollTimer != null) return;
  pollTimer = setInterval(async () => {
    await send<DetectDaemonResp>({ type: 'DETECT_DAEMON' });
    await refreshStatus();
  }, POLL_INTERVAL_MS);
}

function stopAutoPoll() {
  if (pollTimer != null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// ── Page resources ──────────────────────────────────────────────────

async function refreshResources() {
  // Ask the active tab's content script what it found.
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;

  try {
    const elements = await chrome.tabs.sendMessage(tab.id, { type: 'GET_ELEMENTS' });
    if (!Array.isArray(elements) || elements.length === 0) {
      show(noResources);
      return;
    }
    hide(noResources);
    resourceList.innerHTML = '';
    for (const el of elements) {
      const li = document.createElement('li');
      li.innerHTML = `<span class="kind">${el.kind}</span>${el.address.slice(0, 24)}...`;
      resourceList.appendChild(li);
    }
  } catch {
    // Content script not injected (e.g. chrome:// page).
    show(noResources);
  }
}

// ── Settings ────────────────────────────────────────────────────────

async function loadSettings() {
  const resp = await send<SettingsResp>({ type: 'GET_SETTINGS' });
  if (resp?.settings) applySettingsToUI(resp.settings);
}

function applySettingsToUI(s: ExtensionSettings) {
  inputUrl.value = s.daemonUrl;
  inputAutoFetch.checked = s.autoFetchInline;
  inputCheckUpdates.checked = s.checkForUpdates;
}

btnSave.addEventListener('click', async () => {
  const next: ExtensionSettings = {
    daemonUrl: inputUrl.value.replace(/\/+$/, ''),
    autoFetchInline: inputAutoFetch.checked,
    checkForUpdates: inputCheckUpdates.checked,
  };
  btnSave.disabled = true;
  btnSave.textContent = 'Saving...';
  await send<SettingsResp>({ type: 'SAVE_SETTINGS', settings: next });
  await refreshStatus();
  btnSave.textContent = 'Saved!';
  setTimeout(() => {
    btnSave.textContent = 'Save';
    btnSave.disabled = false;
  }, 1_500);
});

// ── Detect / install ────────────────────────────────────────────────

btnDetect.addEventListener('click', async () => {
  btnDetect.textContent = 'Detecting...';
  btnDetect.disabled = true;
  await send<DetectDaemonResp>({ type: 'DETECT_DAEMON' });
  await refreshStatus();
  btnDetect.textContent = 'Detect daemon';
  btnDetect.disabled = false;
});

setupLinks.forEach((link) =>
  link.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding/index.html') });
  }),
);

btnInstall.addEventListener('click', async () => {
  installReleasesLink.href = ANTD_RELEASES_URL;
  const os = detectOs();

  // Unknown platform — can't pick an asset; send them to the releases page.
  if (!os) {
    installFile.textContent = '(see releases page)';
    show(installInfo);
    window.open(ANTD_RELEASES_URL, '_blank');
    return;
  }

  installFile.textContent = ANTD_INSTALLER_ASSETS[os];
  show(installInfo);
  try {
    await chrome.downloads.download({ url: installerDownloadUrl(os), saveAs: true });
  } catch {
    // Download failed (e.g. asset missing) — fall back to the releases page.
    window.open(ANTD_RELEASES_URL, '_blank');
  }
  // Begin watching for the daemon to come up after the user runs the installer.
  startAutoPoll();
});

// ── Downloads ───────────────────────────────────────────────────────

function formatBytes(n: number): string {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(i ? 1 : 0)} ${units[i]}`;
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() || path;
}

function renderDownloads(items: chrome.downloads.DownloadItem[]) {
  if (!items.length) {
    show(noDownloads);
    hide(btnClearDownloads);
    downloadList.innerHTML = '';
    return;
  }
  hide(noDownloads);
  btnClearDownloads.classList.toggle(
    'hidden',
    !items.some((i) => i.state === 'complete' || i.state === 'interrupted'),
  );

  downloadList.innerHTML = '';
  for (const it of items) {
    const li = document.createElement('li');
    li.className = `dl dl-${it.state}`;

    const name = document.createElement('div');
    name.className = 'dl-name';
    name.textContent = basename(it.filename) || it.url;
    li.appendChild(name);

    if (it.state === 'in_progress') {
      const meta = document.createElement('div');
      meta.className = 'dl-meta';
      const bar = document.createElement('div');
      const fill = document.createElement('div');
      fill.className = 'dl-fill';
      if (it.totalBytes > 0) {
        const pct = Math.floor((it.bytesReceived / it.totalBytes) * 100);
        meta.textContent = `Downloading… ${pct}% (${formatBytes(it.bytesReceived)} / ${formatBytes(it.totalBytes)})`;
        bar.className = 'dl-bar';
        fill.style.width = `${pct}%`;
      } else {
        meta.textContent = `Downloading… ${formatBytes(it.bytesReceived)}`;
        bar.className = 'dl-bar indeterminate';
      }
      bar.appendChild(fill);
      li.appendChild(meta);
      li.appendChild(bar);
    } else if (it.state === 'complete') {
      const meta = document.createElement('div');
      meta.className = 'dl-meta';
      meta.textContent = formatBytes(it.totalBytes || it.bytesReceived);
      li.appendChild(meta);
      const open = document.createElement('button');
      open.className = 'open-folder dl-action';
      open.dataset.id = String(it.id);
      open.textContent = 'Open folder';
      li.appendChild(open);
    } else {
      const meta = document.createElement('div');
      meta.className = 'dl-meta dl-err';
      meta.textContent = `Failed${it.error ? `: ${it.error}` : ''}`;
      li.appendChild(meta);
    }
    downloadList.appendChild(li);
  }
}

async function refreshDownloads() {
  try {
    const items = await chrome.downloads.search({ limit: 100, orderBy: ['-startTime'] });
    renderDownloads(items.filter((i) => i.byExtensionId === chrome.runtime.id));
  } catch {
    // downloads API unavailable / transient — the next tick retries.
  }
}

downloadList.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('.open-folder') as HTMLElement | null;
  if (btn?.dataset.id) chrome.downloads.show(Number(btn.dataset.id));
});

btnClearDownloads.addEventListener('click', async () => {
  const items = await chrome.downloads.search({ limit: 1000 });
  const finished = items.filter(
    (i) =>
      i.byExtensionId === chrome.runtime.id &&
      (i.state === 'complete' || i.state === 'interrupted'),
  );
  await Promise.all(finished.map((i) => chrome.downloads.erase({ id: i.id })));
  refreshDownloads();
});

// ── Init ────────────────────────────────────────────────────────────

refreshStatus();
refreshResources();
refreshDownloads();
loadSettings();

// Keep the downloads list (and any in-flight progress) live while open.
setInterval(refreshDownloads, 1000);
