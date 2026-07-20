/**
 * Popup script — daemon status, page resource list, settings.
 */

import type {
  Request,
  DaemonStatusResp,
  SettingsResp,
  DetectDaemonResp,
  DownloadResp,
} from '../shared/messages';
import type { ExtensionSettings } from '../shared/types';
import {
  ANTD_DEFAULT_URL,
  ANTD_INSTALLER_ASSETS,
  ANTD_RELEASES_URL,
  ANTD_RUN_COMMAND,
  ANTD_RUN_GUIDE,
  detectOs,
  installerDownloadUrl,
  MIN_ANTD_VERSION,
  OS_LABELS,
} from '../shared/constants';
import {
  applyStaticTranslations,
  initI18n,
  LOCALE_STORAGE_KEY,
  NATIVE_LOCALE_NAMES,
  setLocale,
  SUPPORTED_LOCALES,
  t,
  type SupportedLocale,
} from '../i18n';

// ── DOM refs ────────────────────────────────────────────────────────

const statusDot = document.getElementById('status-dot')!;
const statusText = document.getElementById('status-text')!;
const daemonUrlEl = document.getElementById('daemon-url')!;
const antdVersion = document.getElementById('antd-version')!;
const updateNudge = document.getElementById('update-nudge')!;
const updateNudgeText = document.getElementById('update-nudge-text')!;
const updateBtn = document.getElementById('update-btn') as HTMLButtonElement;
const versionWarning = document.getElementById('version-warning')!;
const versionWarningText = document.getElementById('version-warning-text')!;
const warningUpdateBtn = document.getElementById('warning-update-btn') as HTMLButtonElement;
const prereleaseWarning = document.getElementById('prerelease-warning')!;
const prereleaseWarningText = document.getElementById('prerelease-warning-text')!;
const prereleaseUpdateBtn = document.getElementById('prerelease-update-btn') as HTMLButtonElement;
const connectedView = document.getElementById('connected-view')!;
const disconnectedView = document.getElementById('disconnected-view')!;
const noResources = document.getElementById('no-resources')!;
const resourceList = document.getElementById('resource-list')!;
const downloadList = document.getElementById('download-list')!;
const noDownloads = document.getElementById('no-downloads')!;
const btnClearDownloads = document.getElementById('btn-clear-downloads') as HTMLButtonElement;
const installInfo = document.getElementById('install-info')!;
const installStepRun = document.getElementById('install-step-run')!;
const installTitle = document.getElementById('install-title')!;
const installStep2 = document.getElementById('install-step-2')!;
const installReleasesLink = document.getElementById('install-releases-link') as HTMLAnchorElement;
const guideReach = document.getElementById('guide-reach')!;

const btnDetect = document.getElementById('btn-detect') as HTMLButtonElement;
const btnInstall = document.getElementById('btn-install') as HTMLButtonElement;
const setupLinks = document.querySelectorAll<HTMLAnchorElement>('.open-setup');
const btnSave = document.getElementById('btn-save') as HTMLButtonElement;
const inputUrl = document.getElementById('input-url') as HTMLInputElement;
const inputAutoFetch = document.getElementById('input-auto-fetch') as HTMLInputElement;
const inputCheckUpdates = document.getElementById('input-check-updates') as HTMLInputElement;
const inputLanguage = document.getElementById('input-language') as HTMLSelectElement;

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
    statusText.textContent = t('common.connected');
    daemonUrlEl.textContent = s.url;
    antdVersion.textContent = s.version ?? t('common.unknown');
    // Precedence: the two hard rejections (too old, then pre-release) outrank
    // the optional update nudge. Both can be true at once — an rc behind the
    // floor — and "too old" is the more actionable message, so it wins.
    if (s.belowMinimum) {
      versionWarningText.textContent = t('popup.version_too_old', { min: MIN_ANTD_VERSION });
      show(versionWarning);
      hide(prereleaseWarning);
      hide(updateNudge);
    } else if (s.prerelease) {
      prereleaseWarningText.textContent = t('popup.prerelease_warning', {
        version: s.version ?? t('common.unknown'),
      });
      hide(versionWarning);
      show(prereleaseWarning);
      hide(updateNudge);
    } else if (s.updateAvailable && s.latestVersion) {
      hide(versionWarning);
      hide(prereleaseWarning);
      updateNudgeText.textContent = t('popup.update_available', { version: s.latestVersion });
      show(updateNudge);
    } else {
      hide(versionWarning);
      hide(prereleaseWarning);
      hide(updateNudge);
    }
    show(connectedView);
    hide(disconnectedView);

    // Connected is NOT enough to settle: during an update the daemon stays
    // connected the whole time, just reporting an unsupported version.
    //
    // Poll whenever it's unsupported — not only after the update button is
    // clicked. This view renders the service worker's *cached* status, which
    // only refreshes on its own HEALTH_POLL_MS alarm (Chrome clamps that, so
    // ~30-60s). Without a poll here, a popup opened straight after running the
    // installer shows a stale "too old" warning and sits on it, which reads as
    // "the upgrade failed" and invites the user to run the installer again.
    // Re-probing makes it self-correct within seconds.
    if (s.belowMinimum || s.prerelease) {
      startAutoPoll();
    } else {
      stopAutoPoll();
      hide(installInfo);
    }
  } else {
    statusDot.className = 'disconnected';
    statusText.textContent = t('status.not_detected');
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
    resourceList.replaceChildren();
    for (const el of elements) {
      // Build via textContent, never innerHTML — el.kind/el.address/el.name
      // originate from page content and must not be interpreted as markup.
      const address = String(el.address);
      const name = typeof el.name === 'string' && el.name.length ? el.name : '';

      const li = document.createElement('li');
      li.className = 'res';

      const main = document.createElement('div');
      main.className = 'res-main';

      const head = document.createElement('div');
      head.className = 'res-head';
      const kind = document.createElement('span');
      kind.className = 'kind';
      kind.textContent = el.kind;
      head.append(kind);
      // Filename (bold) on the first line only when known.
      if (name) {
        const title = document.createElement('span');
        title.className = 'res-name';
        title.textContent = name;
        head.append(title);
      }
      main.appendChild(head);

      // Address always shown in full as the smaller grey second line.
      const addr = document.createElement('div');
      addr.className = 'res-addr';
      addr.textContent = address;
      main.appendChild(addr);
      li.appendChild(main);

      const dl = document.createElement('button');
      dl.className = 'res-download';
      dl.textContent = t('common.download');
      dl.dataset.address = address;
      if (name) dl.dataset.name = name;
      li.appendChild(dl);

      resourceList.appendChild(li);
    }
  } catch {
    // Content script not injected (e.g. chrome:// page).
    show(noResources);
  }
}

// Delegated download for the resource list — a one-shot DOWNLOAD_FILE to the
// worker; the result then surfaces in the downloads list below.
resourceList.addEventListener('click', (e) => {
  const btn = (e.target as HTMLElement).closest('.res-download') as HTMLButtonElement | null;
  if (!btn?.dataset.address) return;
  send<DownloadResp>({
    type: 'DOWNLOAD_FILE',
    address: btn.dataset.address,
    filename: btn.dataset.name || undefined,
  });
  btn.textContent = t('common.downloading');
  btn.disabled = true;
  setTimeout(() => {
    btn.textContent = t('common.download');
    btn.disabled = false;
    refreshDownloads();
  }, 1_200);
});

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
  btnSave.textContent = t('settings.saving');
  await send<SettingsResp>({ type: 'SAVE_SETTINGS', settings: next });
  await refreshStatus();
  btnSave.textContent = t('settings.saved');
  setTimeout(() => {
    btnSave.textContent = t('common.save');
    btnSave.disabled = false;
  }, 1_500);
});

// ── Language ────────────────────────────────────────────────────────

/**
 * Populate the language picker: "System default" (follow the browser) plus
 * every supported locale in its own script. Changing it persists the override
 * and reloads the popup so initI18n() re-resolves and re-applies.
 */
async function setupLanguagePicker() {
  const sys = document.createElement('option');
  sys.value = '';
  sys.textContent = t('settings.language_system');
  inputLanguage.appendChild(sys);
  for (const loc of SUPPORTED_LOCALES) {
    const opt = document.createElement('option');
    opt.value = loc;
    opt.textContent = NATIVE_LOCALE_NAMES[loc];
    inputLanguage.appendChild(opt);
  }
  // Reflect the persisted override ('' = follow the browser language).
  const stored = await chrome.storage.local.get(LOCALE_STORAGE_KEY);
  const override = stored?.[LOCALE_STORAGE_KEY];
  inputLanguage.value = typeof override === 'string' ? override : '';

  inputLanguage.addEventListener('change', async () => {
    const val = inputLanguage.value;
    await setLocale(val ? (val as SupportedLocale) : null);
    location.reload();
  });
}

// ── Detect / install ────────────────────────────────────────────────

btnDetect.addEventListener('click', async () => {
  btnDetect.textContent = t('popup.detecting');
  btnDetect.disabled = true;
  await send<DetectDaemonResp>({ type: 'DETECT_DAEMON' });
  await refreshStatus();
  btnDetect.textContent = t('popup.detect_daemon');
  btnDetect.disabled = false;
});

setupLinks.forEach((link) =>
  link.addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: chrome.runtime.getURL('onboarding/index.html') });
  }),
);

// Fill the "already installed? find & run it" guide with OS-specific paths.
function setupRunGuide() {
  const term = document.getElementById('guide-terminal');
  const install = document.getElementById('guide-install');
  const port = document.getElementById('guide-portfile');
  const cmd = document.getElementById('guide-cmd');
  guideReach.textContent = t('guide.reach_antd', { url: ANTD_DEFAULT_URL });
  if (cmd) cmd.textContent = ANTD_RUN_COMMAND;

  const os = detectOs();
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

/**
 * Download the pinned installer for this OS and watch for the daemon to come
 * (back) up.
 *
 * Shared by the first-run "Download daemon" button and by every version
 * warning/nudge: updating has to be exactly as one-click as installing. The
 * alternative — linking to the releases page — makes the user pick the right
 * asset out of ~11 by hand, which is a worse experience than a first install
 * and would land on the entire existing user base at once.
 *
 * Falls back to the releases page only when we genuinely can't choose an asset
 * (unknown OS) or the download fails.
 */
async function downloadInstaller(mode: 'install' | 'update'): Promise<void> {
  installReleasesLink.href = ANTD_RELEASES_URL;
  installTitle.textContent = t(mode === 'update' ? 'install.title_update' : 'install.title_install');
  installStep2.textContent = t(mode === 'update' ? 'install.step2_update' : 'install.step2_install');

  const os = detectOs();

  // Unknown platform — can't pick an asset; send them to the releases page.
  if (!os) {
    installStepRun.textContent = t('install.step_run', { file: t('install.see_releases') });
    show(installInfo);
    window.open(ANTD_RELEASES_URL, '_blank');
    return;
  }

  installStepRun.textContent = t('install.step_run', { file: ANTD_INSTALLER_ASSETS[os] });
  show(installInfo);
  try {
    await chrome.downloads.download({ url: installerDownloadUrl(os), saveAs: true });
  } catch {
    // Download failed (e.g. asset missing) — fall back to the releases page.
    window.open(ANTD_RELEASES_URL, '_blank');
  }
  // Watch for the daemon to come up (install) or be swapped out (update).
  startAutoPoll();
}

btnInstall.addEventListener('click', () => downloadInstaller('install'));
warningUpdateBtn.addEventListener('click', () => downloadInstaller('update'));
prereleaseUpdateBtn.addEventListener('click', () => downloadInstaller('update'));
updateBtn.addEventListener('click', () => downloadInstaller('update'));

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
    downloadList.replaceChildren();
    return;
  }
  hide(noDownloads);
  btnClearDownloads.classList.toggle(
    'hidden',
    !items.some((i) => i.state === 'complete' || i.state === 'interrupted'),
  );

  downloadList.replaceChildren();
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
        meta.textContent = t('downloads.progress_pct', {
          pct,
          received: formatBytes(it.bytesReceived),
          total: formatBytes(it.totalBytes),
        });
        bar.className = 'dl-bar';
        fill.style.width = `${pct}%`;
      } else {
        meta.textContent = t('downloads.progress_indeterminate', {
          received: formatBytes(it.bytesReceived),
        });
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
      open.textContent = t('downloads.open_folder');
      li.appendChild(open);
    } else {
      const meta = document.createElement('div');
      meta.className = 'dl-meta dl-err';
      // The daemon/browser error detail (it.error) stays verbatim after the
      // localized "Failed" label — see the i18n Phase-1 carve-out in
      // CONTRIBUTING-i18n.md.
      meta.textContent = t('downloads.failed') + (it.error ? `: ${it.error}` : '');
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

async function init() {
  // Load the active locale and paint all static [data-i18n] text before the
  // dynamic refreshers (which call t() directly) run.
  await initI18n();
  applyStaticTranslations();
  await setupLanguagePicker();

  refreshStatus();
  refreshResources();
  refreshDownloads();
  loadSettings();
  setupRunGuide();

  // Keep the downloads list (and any in-flight progress) live while open.
  setInterval(refreshDownloads, 1000);
}

init();
