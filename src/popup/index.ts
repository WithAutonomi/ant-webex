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
const inputMaxSize = document.getElementById('input-max-size') as HTMLInputElement;

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
  const s = resp.status;

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
  applySettingsToUI(resp.settings);
}

function applySettingsToUI(s: ExtensionSettings) {
  inputUrl.value = s.daemonUrl;
  inputAutoFetch.checked = s.autoFetchInline;
  inputCheckUpdates.checked = s.checkForUpdates;
  inputMaxSize.value = String(Math.round(s.maxInlineBytes / (1024 * 1024)));
}

btnSave.addEventListener('click', async () => {
  const next: ExtensionSettings = {
    daemonUrl: inputUrl.value.replace(/\/+$/, ''),
    autoFetchInline: inputAutoFetch.checked,
    checkForUpdates: inputCheckUpdates.checked,
    maxInlineBytes: (parseInt(inputMaxSize.value, 10) || 50) * 1024 * 1024,
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

// ── Init ────────────────────────────────────────────────────────────

refreshStatus();
refreshResources();
loadSettings();
