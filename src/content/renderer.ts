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

import type { FetchResourceReq, DownloadFileReq, Request, Response } from '../shared/messages';
import type { AntElement } from '../shared/types';
import { parseAntUri } from './scanner';
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
    // Service worker was likely suspended — retry once to wake it.
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
      content: 'Failed to load from Autonomi';
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
    a.ant-dl[data-ant-downloading] { opacity: 0.7; cursor: default; }
    a.ant-dl .ant-dl-logo { width: 16px; height: 16px; display: block; }
  `;
  document.head.appendChild(style);
}

injectStyles();

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
    a.setAttribute('title', 'Download from the Autonomi network');
    a.classList.add('ant-dl');
    a.replaceChildren();

    const img = document.createElement('img');
    img.className = 'ant-dl-logo';
    img.src = antLogo;
    img.alt = '';
    const label = document.createElement('span');
    label.className = 'ant-dl-label';
    label.textContent = 'Download';
    a.append(img, label);

    a.addEventListener('click', (e) => {
      e.preventDefault();
      // The label span carries the progress text; the LOADING_CLASS spinner and
      // ERROR_CLASS overlay are for inline media containers, so they don't apply.
      if (a.hasAttribute('data-ant-downloading')) return;

      a.setAttribute('data-ant-downloading', '1');
      label.textContent = 'Fetching…';

      // Filename precedence: the standard HTML download attribute wins, then
      // the ?name= from this anchor's own href, else the background falls back
      // to an address-derived name.
      const msg: DownloadFileReq = {
        type: 'DOWNLOAD_FILE',
        address: el.address,
        filename:
          a.getAttribute('download') || parseAntUri(a.getAttribute('href') || '').name || undefined,
      };
      sendMsg(msg).then((resp: Response) => {
        a.removeAttribute('data-ant-downloading');
        if (resp?.type === 'DOWNLOAD_RESULT' && !resp.ok) {
          label.textContent = 'Download failed';
          setTimeout(() => { label.textContent = 'Download'; }, 3_000);
        } else {
          label.textContent = 'Download';
        }
      });
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
          `Failed to load from Autonomi: ${resp.result.error}`,
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
