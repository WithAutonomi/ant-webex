/**
 * Minimal i18n runtime for the extension's own pages (popup + onboarding).
 *
 * The extension is dependency-free, so this is a ~100-line hand-rolled runtime
 * rather than a framework. Locale catalogs are fetched from the packaged
 * assets via chrome.runtime.getURL(): popup and onboarding run in extension
 * pages, which can read packaged resources without web_accessible_resources.
 * The content script can't (it injects into arbitrary pages), so it uses a
 * separate bundled subset — see content/i18n.ts.
 *
 * Conventions mirror the sibling ant-ui desktop app so translations and the
 * contributor guide port across: dotted keys grouped by area, {name}
 * placeholders, and _one/_many plural suffixes chosen by the caller. See
 * CONTRIBUTING-i18n.md.
 */

/** Every locale the extension ships. Order matches ant-ui's SUPPORTED_LOCALES. */
export const SUPPORTED_LOCALES = [
  'en', 'ja', 'ko', 'nl', 'fr', 'bg', 'es', 'ar', 'he', 'ru',
  'uk', 'zh-CN', 'zh-TW', 'pt-BR', 'tr', 'vi', 'id', 'de',
] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
const DEFAULT_LOCALE: SupportedLocale = 'en';

/** Locales whose script flows right-to-left; applied as <html dir="rtl">. */
export const RTL_LOCALES: ReadonlySet<SupportedLocale> = new Set(['ar', 'he']);
export function isRtlLocale(value: string): boolean {
  return RTL_LOCALES.has(value as SupportedLocale);
}

/** Each locale's name in its own script — shown in the Settings picker so the
 *  user reads the language name regardless of the active UI locale. */
export const NATIVE_LOCALE_NAMES: Record<SupportedLocale, string> = {
  en: 'English',
  ja: '日本語',
  ko: '한국어',
  nl: 'Nederlands',
  fr: 'Français',
  bg: 'Български',
  es: 'Español',
  ar: 'العربية',
  he: 'עברית',
  ru: 'Русский',
  uk: 'Українська',
  'zh-CN': '简体中文',
  'zh-TW': '繁體中文',
  'pt-BR': 'Português (Brasil)',
  tr: 'Türkçe',
  vi: 'Tiếng Việt',
  id: 'Bahasa Indonesia',
  de: 'Deutsch',
};

/** chrome.storage.local key holding the user's explicit locale override. */
export const LOCALE_STORAGE_KEY = 'uiLocale';

function isSupported(value: string): value is SupportedLocale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/**
 * A few languages we ship only in regional/script variants — Chinese
 * (zh-CN/zh-TW) and Portuguese (pt-BR) — never as a bare `zh`/`pt`. So a tag
 * like `pt-PT`, `zh-HK`, or the script forms `zh-Hant`/`zh-Hans` matches nothing
 * above and would otherwise fall all the way to English. Map each to the closest
 * variant we do ship instead: Portuguese → pt-BR; Chinese → Traditional
 * (zh-TW) when the tag carries a Traditional script (Hant) or a Traditional
 * region (TW/HK/MO), else Simplified (zh-CN).
 */
function regionalFallback(parts: string[]): SupportedLocale | undefined {
  const lang = parts[0].toLowerCase();
  const rest = parts.slice(1).map((p) => p.toLowerCase());
  if (lang === 'pt') return 'pt-BR';
  if (lang === 'zh') {
    const traditional =
      rest.includes('hant') || rest.some((p) => ['tw', 'hk', 'mo'].includes(p));
    return traditional ? 'zh-TW' : 'zh-CN';
  }
  return undefined;
}

/**
 * Map a raw BCP 47 tag to a supported locale. Tries the region-qualified tag
 * first (so zh-CN/zh-TW/pt-BR keep the region that carries the meaning), then
 * the bare language (fr-CA → fr), then a regional fallback for languages we
 * ship only regionally (pt-PT → pt-BR, zh-Hant → zh-TW), then English. Ported
 * from ant-ui's useLocale.ts.
 */
export function normalizeLocale(raw: string | null | undefined): SupportedLocale {
  if (!raw) return DEFAULT_LOCALE;
  const parts = raw.split('-');
  if (parts.length >= 2) {
    const tagged = `${parts[0].toLowerCase()}-${parts[1].toUpperCase()}`;
    if (isSupported(tagged)) return tagged;
  }
  const base = parts[0].toLowerCase();
  if (isSupported(base)) return base;
  return regionalFallback(parts) ?? DEFAULT_LOCALE;
}

type Catalog = Record<string, unknown>;
let catalog: Catalog = {};
let fallbackCatalog: Catalog = {};
let activeLocale: SupportedLocale = DEFAULT_LOCALE;

function localeUrl(loc: SupportedLocale): string {
  return chrome.runtime.getURL(`i18n/locales/${loc}.json`);
}

async function loadCatalog(loc: SupportedLocale): Promise<Catalog> {
  try {
    const r = await fetch(localeUrl(loc));
    if (!r.ok) return {};
    return (await r.json()) as Catalog;
  } catch {
    return {};
  }
}

/** Resolve the locale to use: persisted override → browser UI language → en. */
export async function resolveLocale(): Promise<SupportedLocale> {
  try {
    const stored = await chrome.storage.local.get(LOCALE_STORAGE_KEY);
    const override = stored?.[LOCALE_STORAGE_KEY];
    if (typeof override === 'string' && isSupported(override)) return override;
  } catch {
    /* storage unavailable — fall through to the browser language */
  }
  return normalizeLocale(navigator.language);
}

/**
 * Resolve the locale, load its catalog plus English as the fallback layer, and
 * set <html lang> / <html dir>. Call once before rendering the page.
 */
export async function initI18n(): Promise<void> {
  activeLocale = await resolveLocale();
  catalog = await loadCatalog(activeLocale);
  fallbackCatalog = activeLocale === 'en' ? catalog : await loadCatalog('en');
  const el = document.documentElement;
  el.lang = activeLocale;
  el.dir = isRtlLocale(activeLocale) ? 'rtl' : 'ltr';
}

export function getLocale(): SupportedLocale {
  return activeLocale;
}

/** Persist an explicit locale override; null clears it → follow the browser. */
export async function setLocale(next: SupportedLocale | null): Promise<void> {
  if (next === null) await chrome.storage.local.remove(LOCALE_STORAGE_KEY);
  else await chrome.storage.local.set({ [LOCALE_STORAGE_KEY]: next });
}

function lookup(cat: Catalog, key: string): unknown {
  let node: unknown = cat;
  for (const part of key.split('.')) {
    if (node == null || typeof node !== 'object') return undefined;
    node = (node as Record<string, unknown>)[part];
  }
  return node;
}

function interpolate(s: string, params?: Record<string, string | number>): string {
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (m, k) => (k in params ? String(params[k]) : m));
}

/**
 * Translate a dotted key. Falls back active-locale → English → the key itself,
 * so a missing translation degrades to English (or, worst case, a visible key
 * that flags the gap). `params.count` selects the `_one`/`_many` plural suffix
 * when such keys exist.
 */
export function t(key: string, params?: Record<string, string | number>): string {
  let resolvedKey = key;
  if (params && typeof params.count === 'number') {
    const suffix = params.count === 1 ? '_one' : '_many';
    if (
      typeof lookup(catalog, key + suffix) === 'string' ||
      typeof lookup(fallbackCatalog, key + suffix) === 'string'
    ) {
      resolvedKey = key + suffix;
    }
  }
  let value = lookup(catalog, resolvedKey);
  if (typeof value !== 'string') value = lookup(fallbackCatalog, resolvedKey);
  if (typeof value !== 'string') return key;
  return interpolate(value, params);
}

/**
 * Fill every element carrying a data-i18n* attribute from the catalog:
 *   data-i18n             → textContent
 *   data-i18n-title       → title attribute
 *   data-i18n-placeholder → placeholder attribute
 *   data-i18n-aria-label  → aria-label attribute
 * For interpolation-free static strings; dynamic strings are set via t() in
 * code. Safe against untrusted content — only ever sets textContent/attributes,
 * never innerHTML.
 */
export function applyStaticTranslations(root: ParentNode = document): void {
  root.querySelectorAll<HTMLElement>('[data-i18n]').forEach((el) => {
    el.textContent = t(el.dataset.i18n!);
  });
  const attrMap: Array<[string, string]> = [
    ['data-i18n-title', 'title'],
    ['data-i18n-placeholder', 'placeholder'],
    ['data-i18n-aria-label', 'aria-label'],
  ];
  for (const [dataAttr, domAttr] of attrMap) {
    root.querySelectorAll<HTMLElement>(`[${dataAttr}]`).forEach((el) => {
      el.setAttribute(domAttr, t(el.getAttribute(dataAttr)!));
    });
  }
}
