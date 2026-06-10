/**
 * DOM scanner — finds autonomi:// references on web pages.
 *
 * Detected patterns:
 *
 *   1. Links:       <a href="autonomi://ADDR">...</a>
 *   2. Images:      <img data-ant-src="autonomi://ADDR">
 *   3. Video:       <video data-ant-src="autonomi://ADDR">
 *   4. Audio:       <audio data-ant-src="autonomi://ADDR">
 *   5. Generic:     <div data-ant-embed="autonomi://ADDR" data-ant-type="application/pdf">
 *
 * Web developers embed these attributes in their HTML. Without the extension
 * installed, they are inert (the browser ignores unknown data-* attributes).
 * With the extension, the content script picks them up and fetches the
 * content from the Autonomi network via the local antd daemon.
 *
 * An optional `data-ant-type` attribute provides a MIME type hint so the
 * extension doesn't have to rely solely on magic-byte sniffing.
 */

import { ANT_PROTOCOL } from '../shared/constants';
import type { AntElement, AntElementKind } from '../shared/types';

/** CSS selector matching any element with an autonomi reference. */
const SELECTOR = [
  `a[href^="${ANT_PROTOCOL}"]`,
  '[data-ant-src]',
  '[data-ant-embed]',
].join(',');

/** Extract the network address from an autonomi:// URI. */
function extractAddress(uri: string): string {
  return uri.startsWith(ANT_PROTOCOL) ? uri.slice(ANT_PROTOCOL.length) : uri;
}

/** Map a tag name to an AntElementKind. */
function kindFromTag(tag: string): AntElementKind {
  switch (tag) {
    case 'IMG':
      return 'image';
    case 'VIDEO':
      return 'video';
    case 'AUDIO':
      return 'audio';
    default:
      return 'embed';
  }
}

/** Scan the document (or a subtree) for autonomi references. */
export function scan(root: ParentNode = document): AntElement[] {
  const results: AntElement[] = [];

  for (const el of root.querySelectorAll(SELECTOR)) {
    const href = el.getAttribute('href');
    const antSrc = el.getAttribute('data-ant-src');
    const antEmbed = el.getAttribute('data-ant-embed');
    const mimeType = el.getAttribute('data-ant-type') ?? undefined;

    if (href?.startsWith(ANT_PROTOCOL)) {
      results.push({
        kind: 'link',
        address: extractAddress(href),
        mimeType,
      });
    }
    if (antSrc?.startsWith(ANT_PROTOCOL)) {
      results.push({
        kind: kindFromTag(el.tagName),
        address: extractAddress(antSrc),
        mimeType,
      });
    }
    if (antEmbed?.startsWith(ANT_PROTOCOL)) {
      results.push({
        kind: 'embed',
        address: extractAddress(antEmbed),
        mimeType,
      });
    }
  }

  return results;
}

/**
 * Observe DOM mutations and invoke `callback` whenever new autonomi
 * references appear. Handles SPAs and lazy-loaded content.
 */
export function observe(callback: (elements: AntElement[]) => void): MutationObserver {
  const observer = new MutationObserver((mutations) => {
    let found = false;
    for (const m of mutations) {
      for (const node of m.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches(SELECTOR) || node.querySelector(SELECTOR)) {
          found = true;
          break;
        }
      }
      if (found) break;
    }
    if (found) callback(scan());
  });

  observer.observe(document.body, { childList: true, subtree: true });
  return observer;
}
