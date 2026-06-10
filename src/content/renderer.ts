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
  const anchors = document.querySelectorAll(`a[href="autonomi://${el.address}"]`);
  for (const a of anchors) {
    if (a.hasAttribute('data-ant-bound')) continue;
    a.setAttribute('data-ant-bound', '1');

    a.addEventListener('click', (e) => {
      e.preventDefault();
      // Links use their own text as the progress indicator; the LOADING_CLASS
      // spinner and ERROR_CLASS overlay are for inline media containers where
      // the element has no meaningful text content, so they don't apply here.
      if (a.hasAttribute('data-ant-downloading')) return;

      a.setAttribute('data-ant-downloading', '1');
      const origText = a.textContent;
      a.textContent = 'Fetching from network...';

      const msg: DownloadFileReq = {
        type: 'DOWNLOAD_FILE',
        address: el.address,
        filename: a.getAttribute('download') || undefined,
      };
      sendMsg(msg).then((resp: Response) => {
        a.removeAttribute('data-ant-downloading');
        if (resp?.type === 'DOWNLOAD_RESULT' && !resp.ok) {
          a.textContent = 'Download failed';
          setTimeout(() => { a.textContent = origText; }, 3_000);
        } else {
          a.textContent = origText;
        }
      });
    });

    // Visual hint that this link is handled by the extension.
    a.setAttribute('title', `Download from Autonomi network: ${el.address}`);
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
