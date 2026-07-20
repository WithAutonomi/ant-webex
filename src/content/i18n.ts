/**
 * Content-script i18n. The content script injects into arbitrary pages and
 * can't fetch packaged locale JSON without widening web_accessible_resources
 * (a store-review surface), so its small string subset is bundled at build
 * time. content-locales.json is regenerated from the `content` section of each
 * locale file by build.mjs — the per-locale files stay the single source of
 * truth.
 *
 * The locale here follows the browser UI language (navigator.language). The
 * in-popup language override governs the extension's own pages; content-script
 * link labels follow the browser — see CONTRIBUTING-i18n.md.
 */
import { normalizeLocale } from '../i18n';
import CONTENT_LOCALES from '../i18n/content-locales.json';

type ContentDict = Record<string, string>;
const all = CONTENT_LOCALES as Record<string, ContentDict>;
const en: ContentDict = all.en ?? {};
const dict: ContentDict = all[normalizeLocale(navigator.language)] ?? en;

/** Translate a content-script key, with {name} interpolation and en fallback. */
export function tc(key: string, params?: Record<string, string | number>): string {
  const raw = dict[key] ?? en[key] ?? key;
  if (!params) return raw;
  return raw.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
}
