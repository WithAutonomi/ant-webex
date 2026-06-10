/**
 * Content script entry point.
 *
 * Injected into every page (configurable via manifest.json matches).
 * Scans the DOM for autonomi:// references, renders inline resources,
 * and watches for dynamically added elements.
 */

import { scan, observe } from './scanner';
import { render } from './renderer';
import type { AntElement } from '../shared/types';
import type { SettingsResp } from '../shared/messages';

/** Cache of detected elements so the popup can query them. */
let lastScan: AntElement[] = [];
let autoFetch = true;

async function init(): Promise<void> {
  // Load settings to check whether auto-fetch is enabled.
  try {
    const resp: SettingsResp = await chrome.runtime.sendMessage({ type: 'GET_SETTINGS' });
    if (resp?.type === 'SETTINGS') {
      autoFetch = resp.settings.autoFetchInline;
    }
  } catch { /* service worker not ready — default to true */ }

  // Initial scan once the document is ready.
  lastScan = scan();
  updateBadge(lastScan.length);
  if (lastScan.length > 0) {
    render(lastScan, autoFetch);
  }

  // Watch for new elements added after initial load (SPA navigation, lazy loading).
  observe((elements) => {
    lastScan = elements;
    updateBadge(lastScan.length);
    if (elements.length > 0) render(elements, autoFetch);
  });
}

function updateBadge(count: number): void {
  chrome.runtime.sendMessage({ type: 'UPDATE_BADGE', count }).catch(() => {});
}

// Respond to popup queries for detected elements on this page.
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'GET_ELEMENTS') {
    sendResponse(lastScan);
  }
});

// document_idle means the DOM is already parsed, but guard just in case.
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
