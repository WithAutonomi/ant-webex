/**
 * Onboarding page — shown in a full tab on first install.
 *
 * Walks the user through installing the antd daemon and reflects live
 * connection status by polling the background service worker (same
 * DETECT_DAEMON / GET_DAEMON_STATUS messages the popup uses).
 */

import type { Request, DaemonStatusResp, DetectDaemonResp } from '../shared/messages';
import {
  ANTD_INSTALLER_ASSETS,
  ANTD_RELEASES_URL,
  detectOs,
  installerDownloadUrl,
  OS_LABELS,
} from '../shared/constants';

// ── DOM refs ────────────────────────────────────────────────────────

const statusBanner = document.getElementById('status-banner')!;
const statusText = document.getElementById('status-text')!;
const btnDownload = document.getElementById('btn-download') as HTMLButtonElement;
const osLabel = document.getElementById('os-label')!;
const releasesLink = document.getElementById('releases-link') as HTMLAnchorElement;
const downloadHint = document.getElementById('download-hint')!;
const step1 = document.getElementById('step-1')!;
const step3 = document.getElementById('step-3')!;
const donePanel = document.getElementById('done-panel')!;

// ── Helpers ─────────────────────────────────────────────────────────

async function send<T>(msg: Request): Promise<T> {
  return chrome.runtime.sendMessage(msg);
}

const os = detectOs();

/** Running inside the extension, vs. opened directly as a file for preview. */
const inExtension =
  typeof chrome !== 'undefined' &&
  typeof chrome.runtime !== 'undefined' &&
  !!chrome.runtime.id;

// ── Download step ───────────────────────────────────────────────────

releasesLink.href = ANTD_RELEASES_URL;

if (os) {
  osLabel.textContent = OS_LABELS[os];
} else {
  // Unknown platform — point at the releases page instead of a specific asset.
  osLabel.textContent = 'your platform';
  downloadHint.textContent =
    "We couldn't detect your operating system — pick the right build on GitHub.";
}

btnDownload.addEventListener('click', async () => {
  if (!os) {
    window.open(ANTD_RELEASES_URL, '_blank');
    return;
  }
  // Outside the extension (file:// preview) the downloads API is absent —
  // fall back to a plain navigation so the button still does something.
  if (!inExtension || typeof chrome.downloads === 'undefined') {
    window.open(installerDownloadUrl(os), '_blank');
    return;
  }
  try {
    await chrome.downloads.download({ url: installerDownloadUrl(os), saveAs: true });
    downloadHint.textContent = `Downloading ${ANTD_INSTALLER_ASSETS[os]}…`;
    step1.classList.add('complete');
  } catch {
    // Asset missing / download blocked — fall back to the releases page.
    downloadHint.textContent = 'Download failed — opening the GitHub releases page instead.';
    window.open(ANTD_RELEASES_URL, '_blank');
  }
});

// ── Live connection status ──────────────────────────────────────────

const POLL_INTERVAL_MS = 3_000;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let connected = false;

function setBanner(state: 'checking' | 'idle' | 'connected', text: string) {
  statusBanner.className = `status status-${state}`;
  statusText.textContent = text;
}

function onConnected() {
  if (connected) return;
  connected = true;
  setBanner('connected', 'Connected to the Autonomi network');
  step1.classList.add('complete');
  step3.classList.add('complete');
  donePanel.classList.remove('hidden');
  stopPoll();
}

async function checkOnce() {
  // Probe (in case the daemon just started), then read the resulting status.
  await send<DetectDaemonResp>({ type: 'DETECT_DAEMON' });
  const resp = await send<DaemonStatusResp>({ type: 'GET_DAEMON_STATUS' });
  if (resp.status.connected) {
    onConnected();
  } else if (!connected) {
    // Probed and found nothing — make it clear we're waiting on the install,
    // not stuck. Polling continues in the background.
    setBanner(
      'idle',
      'Network daemon not detected — follow the steps below. This page connects automatically once it’s running.',
    );
  }
}

function startPoll() {
  if (pollTimer != null) return;
  pollTimer = setInterval(checkOnce, POLL_INTERVAL_MS);
}

function stopPoll() {
  if (pollTimer != null) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

// Initial check (daemon may already be running), then poll until connected.
// Outside the extension there's no background worker to query — show a neutral
// preview state instead of throwing.
if (inExtension) {
  checkOnce();
  startPoll();
} else {
  setBanner('idle', 'Preview mode — install the extension to detect the daemon.');
}
