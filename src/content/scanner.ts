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

/**
 * Parse an autonomi:// URI into its bare network address and optional query
 * params. The address is content-addressed (64 hex chars); a `?name=` param
 * lets the author suggest a download filename. The query is stripped from the
 * address so it stays a clean address for the daemon, which rejects anything
 * that isn't exactly 64 hex characters.
 */
export function parseAntUri(uri: string): { address: string; name?: string } {
  const body = uri.startsWith(ANT_PROTOCOL) ? uri.slice(ANT_PROTOCOL.length) : uri;
  const q = body.indexOf('?');
  if (q === -1) return { address: body };
  const address = body.slice(0, q);
  const name = new URLSearchParams(body.slice(q + 1)).get('name')?.trim();
  return { address, name: name || undefined };
}

/**
 * A valid Autonomi address is a content hash: exactly 64 hex characters.
 * Validating here keeps malformed or hostile values (e.g. markup smuggled
 * through an `autonomi://` href) out of the daemon, the popup, and CSS
 * selectors downstream.
 */
const ADDRESS_RE = /^[0-9a-fA-F]{64}$/;
export function isValidAddress(addr: string): boolean {
  return ADDRESS_RE.test(addr);
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
    const mimeType = el.getAttribute('data-ant-type') ?? undefined;

    // Only emit references whose address is a well-formed content hash;
    // anything else is malformed or hostile and is dropped silently.
    const push = (kind: AntElementKind, uri: string) => {
      const { address, name } = parseAntUri(uri);
      if (isValidAddress(address)) results.push({ kind, address, name, mimeType });
    };

    const href = el.getAttribute('href');
    const antSrc = el.getAttribute('data-ant-src');
    const antEmbed = el.getAttribute('data-ant-embed');

    if (href?.startsWith(ANT_PROTOCOL)) push('link', href);
    if (antSrc?.startsWith(ANT_PROTOCOL)) push(kindFromTag(el.tagName), antSrc);
    if (antEmbed?.startsWith(ANT_PROTOCOL)) push('embed', antEmbed);
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
