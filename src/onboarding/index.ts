/**
 * Onboarding page — shown in a full tab on first install.
 *
 * Walks the user through installing the antd daemon and reflects live
 * connection status by polling the background service worker (same
 * DETECT_DAEMON / GET_DAEMON_STATUS messages the popup uses).
 */

import type { Request, DaemonStatusResp, DetectDaemonResp } from '../shared/messages';
import {
  ANTD_DEFAULT_URL,
  ANTD_INSTALLER_ASSETS,
  ANTD_RELEASES_URL,
  ANTD_RUN_COMMAND,
  ANTD_RUN_GUIDE,
  detectOs,
  installerDownloadUrl,
  OS_LABELS,
} from '../shared/constants';
import { applyStaticTranslations, initI18n, t } from '../i18n';

// ── DOM refs ────────────────────────────────────────────────────────

const statusBanner = document.getElementById('status-banner')!;
const statusText = document.getElementById('status-text')!;
const btnDownload = document.getElementById('btn-download') as HTMLButtonElement;
const releasesLink = document.getElementById('releases-link') as HTMLAnchorElement;
const downloadHint = document.getElementById('download-hint')!;
const step1 = document.getElementById('step-1')!;
const donePanel = document.getElementById('done-panel')!;
const welcomeSection = document.getElementById('welcome')!;
const stepsList = document.getElementById('steps')!;
const runGuide = document.getElementById('run-guide')!;

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

function setupDownloadStep() {
  releasesLink.href = ANTD_RELEASES_URL;

  if (os) {
    btnDownload.textContent = t('onboarding.download_for', { platform: OS_LABELS[os] });
    // Surface the exact download URL on hover (the button isn't a link, so it
    // has no native status-bar URL).
    btnDownload.title = installerDownloadUrl(os);
  } else {
    // Unknown platform — point at the releases page instead of a specific asset.
    btnDownload.textContent = t('onboarding.download_for', { platform: t('onboarding.your_platform') });
    btnDownload.title = ANTD_RELEASES_URL;
    downloadHint.textContent = t('onboarding.os_undetected');
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
      downloadHint.textContent = t('onboarding.downloading_asset', { asset: ANTD_INSTALLER_ASSETS[os] });
      step1.classList.add('complete');
    } catch {
      // Asset missing / download blocked — fall back to the releases page.
      downloadHint.textContent = t('onboarding.download_failed_fallback');
      window.open(ANTD_RELEASES_URL, '_blank');
    }
  });
}

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
  setBanner('connected', t('onboarding.banner_connected'));
  // Already working — collapse the setup walkthrough and just confirm success.
  welcomeSection.classList.add('hidden');
  stepsList.classList.add('hidden');
  runGuide.classList.add('hidden');
  donePanel.classList.remove('hidden');
  stopPoll();
}

// Fill the "already installed? find & run it" guide with OS-specific paths.
function setupRunGuide() {
  const reach = document.getElementById('guide-reach');
  const term = document.getElementById('guide-terminal');
  const install = document.getElementById('guide-install');
  const port = document.getElementById('guide-portfile');
  const cmd = document.getElementById('guide-cmd');
  if (reach) reach.textContent = t('guide.reach_antd', { url: ANTD_DEFAULT_URL });
  if (cmd) cmd.textContent = ANTD_RUN_COMMAND;
  if (!os) {
    if (term) term.textContent = t('guide.terminal_generic');
    if (install) install.textContent = t('guide.path_varies');
    if (port) port.textContent = t('guide.path_varies_short');
    return;
  }
  const g = ANTD_RUN_GUIDE[os];
  if (term) term.textContent = t('guide.terminal_on', { os: OS_LABELS[os], instr: t(`guide.terminal.${os}`) });
  if (install) install.textContent = g.installPath;
  if (port) port.textContent = g.portFile;
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
    setBanner('idle', t('onboarding.banner_idle'));
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

// ── Init ────────────────────────────────────────────────────────────

async function init() {
  await initI18n();
  applyStaticTranslations();
  setupDownloadStep();
  setupRunGuide();

  // Initial check (daemon may already be running), then poll until connected.
  // Outside the extension there's no background worker to query — show a neutral
  // preview state instead of throwing.
  if (inExtension) {
    checkOnce();
    startPoll();
  } else {
    setBanner('idle', t('onboarding.banner_preview'));
  }
}

init();
