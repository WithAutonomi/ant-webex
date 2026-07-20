/**
 * Renderer — replaces detected autonomi elements with live content.
 *
 * For each detected element, the renderer:
 *  1. Adds a loading indicator.
 *  2. Sends a FETCH_RESOURCE message to the service worker.
 *  3. On success, sets the element's src/content to the returned blob URL.
 *  4. On failure, shows an unobtrusive error state.
 *
 * Links (autonomi:// hrefs) are handled differently: the click is
 * intercepted and routed through the service worker as a DOWNLOAD_FILE.
 */

import type {
  DownloadFileReq,
  DownloadProgressResp,
  DownloadResp,
  DownloadStateResp,
  FetchResourceReq,
  Request,
  Response,
} from '../shared/messages';
import type { AntElement } from '../shared/types';
import { DOWNLOAD_PORT } from '../shared/constants';
import { parseAntUri } from './scanner';
import { tc } from './i18n';
// Bundled as a data URL (esbuild dataurl loader) so it works on any page
// without web_accessible_resources.
import antLogo from '../../assets/icons/icon-48.png';

/**
 * Send a message to the service worker, retrying once if it was suspended.
 * The retry wakes the worker; chrome.runtime.sendMessage rejects with
 * "Could not establish connection" when the worker is down.
 */
async function sendMsg(msg: Request): Promise<Response> {
  try {
    return await chrome.runtime.sendMessage(msg);
  } catch {
    // Worker was likely suspended ("Receiving end does not exist"). Give it a
    // moment to wake, then retry once.
    await new Promise((r) => setTimeout(r, 300));
    return await chrome.runtime.sendMessage(msg);
  }
}

/** Tracks which addresses we've already started fetching. */
const pending = new Set<string>();

/** CSS class added to elements while loading. */
const LOADING_CLASS = 'ant-loading';
const LOADED_CLASS = 'ant-loaded';
const ERROR_CLASS = 'ant-error';

/** Inject loading/error styles once. */
function injectStyles(): void {
  if (document.getElementById('ant-webex-styles')) return;
  const style = document.createElement('style');
  style.id = 'ant-webex-styles';
  style.textContent = `
    .ant-loading {
      position: relative;
      min-height: 48px;
      min-width: 48px;
    }
    .ant-loading::after {
      content: '';
      position: absolute;
      top: 50%;
      left: 50%;
      width: 24px;
      height: 24px;
      margin: -12px 0 0 -12px;
      border: 3px solid rgba(96, 165, 250, 0.25);
      border-top-color: #60a5fa;
      border-radius: 50%;
      animation: ant-spin 0.8s linear infinite;
    }
    @keyframes ant-spin {
      to { transform: rotate(360deg); }
    }
    .ant-error {
      position: relative;
      min-height: 32px;
    }
    .ant-error::after {
      content: ${JSON.stringify(tc('failed_to_load'))};
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      font-size: 11px;
      color: #ef4444;
      white-space: nowrap;
    }
    a.ant-dl {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      padding: 4px 10px;
      border-radius: 6px;
      background: #1e293b;
      color: #e2e8f0 !important;
      text-decoration: none !important;
      font: 500 13px/1 system-ui, -apple-system, sans-serif;
      cursor: pointer;
      vertical-align: middle;
    }
    a.ant-dl:hover { background: #334155; }
    a.ant-dl[data-ant-downloading] {
      cursor: default;
      /* Determinate fill: blue up to --ant-progress, base colour after. Used
         once genuinely incremental bytes arrive (large, multi-batch files). */
      background-image: linear-gradient(
        to right,
        #2563eb var(--ant-progress, 0%),
        #1e293b var(--ant-progress, 0%)
      );
      background-repeat: no-repeat;
      background-size: 100% 100%;
      background-position: 0 0;
      transition: background-image 0.12s linear;
    }
    /* Indeterminate "working" sweep. The daemon fetches a whole batch of chunks
       before emitting any bytes, so small/single-batch downloads have no
       intermediate byte progress to show — animate instead of sitting at 0%. */
    a.ant-dl[data-ant-indeterminate] {
      background-image: linear-gradient(100deg, #1e293b 30%, #3b82f6 50%, #1e293b 70%);
      background-repeat: no-repeat;
      background-size: 200% 100%;
      background-position: 200% 0;
      animation: ant-dl-sweep 1.1s linear infinite;
      transition: none;
    }
    @keyframes ant-dl-sweep {
      to { background-position: -200% 0; }
    }
    a.ant-dl .ant-dl-logo { width: 16px; height: 16px; display: block; }
    a.ant-dl .ant-dl-label { font-variant-numeric: tabular-nums; }
    /* Already-downloaded: clicking opens the saved file. Subtle green accent. */
    a.ant-dl[data-ant-open] {
      background: #14532d;
      cursor: pointer;
    }
    a.ant-dl[data-ant-open]:hover { background: #166534; }
    /* Circular spinner shown while waiting for the first chunk (before any %),
       then swapped for the determinate fill once real progress arrives. */
    a.ant-dl .ant-dl-spinner {
      display: none;
      width: 12px;
      height: 12px;
      border: 2px solid rgba(226, 232, 240, 0.3);
      border-top-color: #e2e8f0;
      border-radius: 50%;
      animation: ant-dl-spin 0.7s linear infinite;
    }
    a.ant-dl[data-ant-spinner] .ant-dl-spinner { display: inline-block; }
    @keyframes ant-dl-spin { to { transform: rotate(360deg); } }
  `;
  document.head.appendChild(style);
}

injectStyles();
console.log('[ant-webex] content script loaded (streaming build)');

/**
 * Process a batch of detected elements. Idempotent — skips addresses
 * that are already in flight or rendered.
 */
export function render(elements: AntElement[], autoFetch = true): void {
  for (const el of elements) {
    if (pending.has(el.address)) continue;

    if (el.kind === 'link') {
      bindLink(el);
    } else if (autoFetch) {
      fetchInline(el);
    }
  }
}

// ── Links ───────────────────────────────────────────────────────────

/**
 * Bind autonomi:// links so clicking them triggers a download through
 * the service worker instead of navigating to an unresolvable URL.
 */
function bindLink(el: AntElement): void {
  // Find the actual <a> elements (there may be several with same address).
  // Prefix match, not exact: the href may carry a ?name= query that the
  // address (parsed by the scanner) has had stripped off.
  const anchors = document.querySelectorAll<HTMLAnchorElement>(`a[href^="autonomi://${el.address}"]`);
  for (const a of anchors) {
    if (a.hasAttribute('data-ant-bound')) continue;
    a.setAttribute('data-ant-bound', '1');

    // Brand the link as a recognizable [Autonomi logo] Download control,
    // preserving the author's original text as the accessible label.
    const origText = (a.textContent || '').trim();
    if (origText) a.setAttribute('aria-label', origText);
    a.setAttribute('title', tc('title_download'));
    a.classList.add('ant-dl');
    a.replaceChildren();

    const img = document.createElement('img');
    img.className = 'ant-dl-logo';
    img.src = antLogo;
    img.alt = '';
    const label = document.createElement('span');
    label.className = 'ant-dl-label';
    label.textContent = tc('download');
    const spinner = document.createElement('span');
    spinner.className = 'ant-dl-spinner';
    a.append(img, label, spinner);

    // Switch the control into "Open" mode — the file is already downloaded, so
    // clicking opens it instead of fetching again.
    const enterOpenMode = () => {
      a.removeAttribute('data-ant-downloading');
      a.removeAttribute('data-ant-spinner');
      a.style.removeProperty('--ant-progress');
      a.setAttribute('data-ant-open', '1');
      label.textContent = tc('open');
      a.setAttribute('title', tc('title_open'));
    };

    // Ask the worker whether this address was already downloaded (and the file
    // still exists). If so, start in "Open" mode.
    sendMsg({ type: 'CHECK_DOWNLOADED', address: el.address })
      .then((resp) => {
        if ((resp as DownloadStateResp)?.type === 'DOWNLOAD_STATE' && (resp as DownloadStateResp).downloaded) {
          enterOpenMode();
        }
      })
      .catch(() => { /* worker asleep / no history — stay in Download mode */ });

    a.addEventListener('click', (e) => {
      e.preventDefault();
      // Already downloaded → open the file instead of fetching again.
      if (a.hasAttribute('data-ant-open')) {
        sendMsg({ type: 'OPEN_DOWNLOAD', address: el.address }).catch(() => {});
        return;
      }
      // The label span carries the progress text; the LOADING_CLASS spinner and
      // ERROR_CLASS overlay are for inline media containers, so they don't apply.
      if (a.hasAttribute('data-ant-downloading')) return;

      a.setAttribute('data-ant-downloading', '1');
      // Show a circular spinner until the first chunk's % arrives; the animator
      // then swaps it for the determinate fill and eases upward from there.
      a.setAttribute('data-ant-spinner', '1');
      label.textContent = tc('fetching');

      // Filename precedence: the standard HTML download attribute wins, then
      // the ?name= from this anchor's own href, else the background falls back
      // to an address-derived name.
      const msg: DownloadFileReq = {
        type: 'DOWNLOAD_FILE',
        address: el.address,
        filename:
          a.getAttribute('download') || parseAntUri(a.getAttribute('href') || '').name || undefined,
      };

      // `settled` guards against the two terminal signals racing: a normal
      // DOWNLOAD_RESULT followed by the port's onDisconnect both try to finish.
      let settled = false;
      let rafId = 0;
      // Time-based easing between the daemon's chunk steps. Each chunk arrives as
      // one `progress` frame, seconds apart, so the raw signal reads as a 33→66→
      // 100 jump. We instead ease the fill toward the last *confirmed* chunk
      // level at a velocity derived from how long that chunk actually took: the
      // first interval (request → first byte) paces the opening climb, and each
      // later chunk re-evaluates the velocity. The fill is capped at the
      // confirmed level so it never runs past real progress — it trails reception
      // by ~one chunk, which is what makes the motion continuous.
      const animStart = performance.now();
      let lastArrival = animStart; // when the last chunk landed (seed: request start)
      let realPct = 0;             // last confirmed % — the ceiling we ease toward
      let displayedPct = 0;        // eased value actually painted (monotonic)
      let velocity = 0;            // % per ms for the current segment
      let lastFrame = animStart;
      let completed = false;       // bytes done; ease briskly to 100 then finalize
      let started = false;         // first % seen — spinner gone, fill takes over

      // Swap the spinner for the determinate fill on the first real signal.
      const beginFill = () => {
        if (started) return;
        started = true;
        a.removeAttribute('data-ant-spinner');
      };

      const reset = () => {
        if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
        a.removeAttribute('data-ant-downloading');
        a.removeAttribute('data-ant-indeterminate');
        a.removeAttribute('data-ant-spinner');
        a.style.removeProperty('--ant-progress');
      };
      const finish = () => {
        if (settled) return;
        settled = true;
        reset();
        // The file is now saved — offer to open it on the next click.
        enterOpenMode();
      };
      const fail = (detail: unknown) => {
        // Once the success result is in (completed), the bar is still easing to
        // 100% — the port closing now is normal teardown, not a failure.
        if (settled || completed) return;
        settled = true;
        console.error('[ant-webex] download failed:', detail ?? '(no detail)');
        label.textContent = tc('download_failed');
        reset();
        setTimeout(() => { label.textContent = tc('download'); }, 3_000);
      };

      // rAF loop: ease displayedPct up to (never past) the confirmed level at the
      // current segment velocity. Runs from click so 0% shows immediately; on
      // completion it eases to 100, then finalizes.
      const animate = (now: number) => {
        if (settled) { rafId = 0; return; }
        const dt = now - lastFrame;
        lastFrame = now;
        // Spinner phase: keep the loop alive but paint nothing until the first %.
        if (!started) { rafId = requestAnimationFrame(animate); return; }
        if (velocity > 0) {
          displayedPct = Math.min(realPct, displayedPct + velocity * dt);
        }
        const shown = Math.max(0, Math.min(100, Math.floor(displayedPct)));
        a.style.setProperty('--ant-progress', `${shown}%`);
        label.textContent = tc('downloading_pct', { pct: shown });
        if (completed && displayedPct >= 99.5) { finish(); return; }
        rafId = requestAnimationFrame(animate);
      };
      rafId = requestAnimationFrame(animate);

      // A long-lived port (not sendMsg) so the worker can stream progress back.
      // connect() itself wakes a suspended worker, so no retry is needed.
      let port: chrome.runtime.Port;
      try {
        port = chrome.runtime.connect({ name: DOWNLOAD_PORT });
      } catch (err) {
        fail(err);
        return;
      }
      port.onMessage.addListener((resp: DownloadProgressResp | DownloadResp) => {
        if (resp?.type === 'DOWNLOAD_PROGRESS') {
          if (!resp.total) return; // unknown total → can't show a %
          const pct = Math.min(100, Math.floor((resp.received / resp.total) * 100));
          if (pct > realPct) {
            beginFill(); // first % → drop the spinner, start the fill
            const now = performance.now();
            const interval = now - lastArrival; // how long this chunk took
            const step = pct - realPct;
            // Velocity to traverse this step over the just-observed interval, so
            // the climb keeps pace with how fast chunks are actually arriving.
            velocity = interval > 0 ? step / interval : step / 1000;
            realPct = pct;
            lastArrival = now;
          }
        } else if (resp?.type === 'DOWNLOAD_RESULT') {
          if (resp.ok) {
            // Bytes are in — ease briskly to 100 (~400ms), then finish in animate.
            if (settled) return;
            beginFill(); // single-batch files never sent a % — drop the spinner now
            completed = true;
            realPct = 100;
            velocity = Math.max(velocity, (100 - displayedPct) / 400);
          } else {
            fail(resp.error);
          }
        }
      });
      // If the worker dies (or the port closes) before a terminal result, this
      // still resets the button instead of leaving it stuck on "Fetching…".
      port.onDisconnect.addListener(() => {
        fail(chrome.runtime.lastError?.message ?? 'connection closed');
      });
      port.postMessage(msg);
    });
  }
}

// ── Inline resources ────────────────────────────────────────────────

/**
 * Fetch an inline resource (image, video, audio, embed) and replace the
 * placeholder element with the live content.
 */
function fetchInline(el: AntElement): void {
  pending.add(el.address);

  // Find the actual DOM elements for this address.
  const targets = findTargets(el);
  targets.forEach((t) => t.classList.add(LOADING_CLASS));

  const msg: FetchResourceReq = {
    type: 'FETCH_RESOURCE',
    address: el.address,
    mimeType: el.mimeType,
  };

  sendMsg(msg).then((resp: Response) => {
    if (resp?.type !== 'RESOURCE_RESULT') return;

    targets.forEach((t) => t.classList.remove(LOADING_CLASS));

    if (resp.result.ok && resp.result.dataUrl) {
      targets.forEach((t) => {
        applyContent(t, resp.result.dataUrl!, el.kind);
        t.classList.add(LOADED_CLASS);
      });
    } else {
      targets.forEach((t) => {
        t.classList.add(ERROR_CLASS);
        t.setAttribute(
          'title',
          `${tc('failed_to_load')}: ${resp.result.error}`,
        );
      });
    }
  });
}

/** Find DOM elements matching an AntElement's address. */
function findTargets(el: AntElement): Element[] {
  const addr = `autonomi://${el.address}`;
  return [
    ...document.querySelectorAll(`[data-ant-src="${addr}"]`),
    ...document.querySelectorAll(`[data-ant-embed="${addr}"]`),
  ];
}

/** Set the element's src or inner content based on its kind. */
function applyContent(target: Element, blobUrl: string, kind: string): void {
  switch (kind) {
    case 'image':
      (target as HTMLImageElement).src = blobUrl;
      break;

    case 'video':
      (target as HTMLVideoElement).src = blobUrl;
      break;

    case 'audio':
      (target as HTMLAudioElement).src = blobUrl;
      break;

    case 'embed': {
      // For generic embeds, create a sandboxed <iframe> inside the container.
      const iframe = document.createElement('iframe');
      iframe.src = blobUrl;
      iframe.style.width = '100%';
      iframe.style.height = '100%';
      iframe.style.border = 'none';
      // Sandbox: allow styles and form submission but no scripts, popups,
      // or navigation. Network content is untrusted.
      iframe.sandbox.add('allow-same-origin');
      target.textContent = '';
      target.appendChild(iframe);
      break;
    }
  }
}
