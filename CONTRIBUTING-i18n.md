# Contributing translations

Thanks for helping localize the **Autonomi** browser extension (`ant-webex`).
This guide covers adding a new locale and polishing existing translations.

## TL;DR

- UI strings live in [`src/i18n/locales/<lang>.json`](./src/i18n/locales/) and are
  loaded at runtime by [`src/i18n/index.ts`](./src/i18n/index.ts).
- English (`en.json`) is the source of truth — every other locale mirrors its
  structure.
- Most non-English locales ship as **machine-translated baselines** (flagged
  with `_translator_notes`). Native speakers are very welcome to polish them
  via PR.
- Currently shipped: `en, ja, ko, nl, fr, bg, es, ar, he, ru, uk, zh-CN,
  zh-TW, pt-BR, tr, vi, id, de` (18 locales).

## How i18n is wired (two string stores)

The extension is dependency-free — there is no i18n framework. Strings live in
two places, both copied into `dist/` and `dist-firefox/` by `build.mjs`:

1. **Runtime dictionary — `src/i18n/locales/<lang>.json`.** Powers every string
   in the popup and onboarding page. Fetched at page load from the packaged
   assets and applied by `t()` / `applyStaticTranslations()`. This is where
   ~95% of the copy lives and where almost all translation happens.

2. **Native store listing — `src/_locales/<lang>/messages.json`.** A single key,
   `extDescription`, referenced from the manifest as `__MSG_extDescription__`.
   This is the *only* thing a runtime dictionary can't localize: the extension
   description shown in the browser and on the Chrome Web Store / Firefox AMO
   listing (read from the manifest before any JS runs). The product **name**
   ("Autonomi") is intentionally left untranslated.

   > Note the folder-name convention: Chinese uses **underscore** directory
   > names here — `_locales/zh_CN/` and `_locales/zh_TW/` — even though the
   > runtime dictionary uses hyphens (`zh-CN.json`, `zh-TW.json`). That's the
   > `chrome.i18n` requirement, not a typo.

### Content-script strings

A small subset (the in-page Download/Open link labels and the "Failed to load"
overlay) is bundled into the content script from the `content` section of each
locale file — see `src/i18n/content-locales.json`, which `build.mjs`
**regenerates on every build**; don't hand-edit it. Edit the `content.*` keys in
the per-locale files instead.

The content script follows the **browser UI language** (`navigator.language`);
the in-popup language override governs the extension's own pages (popup +
onboarding) but not content-script labels injected into arbitrary web pages.

## Conventions

Each locale file is one JSON object grouped by area (`popup.*`, `onboarding.*`,
`guide.*`, `install.*`, `downloads.*`, `settings.*`, `content.*`, `common.*`).
Keys are dotted paths used as `t('popup.no_downloads')`.

- **Placeholders** are written `{name}` and must be preserved verbatim:
  `{min} {version} {url} {os} {instr} {file} {pct} {received} {total} {asset}
  {platform}`.
- **Plurals** (should any be added) use suffixed keys `*_one` / `*_many`, chosen
  by the caller via `t(key, { count })` — not a `|` plural syntax.
- **Don't translate identifiers.** Keep verbatim: `Autonomi`, `antd`,
  `autonomi://`, `--cors`, `GitHub`, `PowerShell`, `Terminal`, `PATH`,
  `macOS`/`Windows`/`Linux`, key names (`Win`, `Enter`, `Cmd+Space`,
  `Ctrl+Alt+T`), the literal shell message `"command not found"`, the 🎉 emoji,
  and version/number tokens.
- **Shared atoms** (`common.download`, `common.save`, `common.connected`,
  `common.checking`, `common.downloading`, `common.settings`,
  `common.downloads`) are copied verbatim from the sibling `ant-ui` desktop app
  so the two products read identically. Please keep them in sync rather than
  re-translating.

## Right-to-left (RTL) locales

Arabic (`ar`) and Hebrew (`he`) ship as RTL baselines. Direction is wired
through two pieces:

- **`src/i18n/index.ts`** — the `RTL_LOCALES` set, applied as `<html dir="rtl">`
  in `initI18n()`. Add new RTL locale codes here.
- **Logical CSS** — layout uses flex/gap (mirrors automatically) plus logical
  properties (`margin-inline-start/end`) rather than physical `margin-left/
  right`, so it flips with `dir`. When adding CSS, prefer logical properties.

Known minor follow-up (functional, not blocking): the indeterminate
download-progress shimmer keyframe in `popup/style.css` animates a physical
`margin-left` and doesn't mirror in RTL. It's a decorative sweep; migrate it to
a direction-aware pair opportunistically.

## Backend error passthrough (carve-out)

Technical error detail produced by the daemon/browser (e.g. the text after
"Failed:" in the downloads list, or after "Failed to load from Autonomi:") stays
in English — the source emits it as a pre-formatted string. Only the leading
label is localized. Please leave the appended detail alone; a later phase can
switch the source to structured error tokens.

## Adding a new locale

1. **Copy `en.json` to `src/i18n/locales/<lang>.json`.** Use the ISO 639-1 code
   (`fr`, `de`, …) or an IETF tag where the region matters (`pt-BR`, `zh-TW`).
2. **Add `_translator_notes` as the first key** if the baseline is
   machine-translated:
   ```json
   { "_translator_notes": "Machine-translated baseline. Native-speaker polish via PR welcome.", "common": { … } }
   ```
   Keys starting with `_` are documentation-only — never consumed at runtime.
3. **Translate the values**, leaving every key path intact and in order (diffing
   against `en.json` is the fastest way to find gaps).
4. **Register the code** in `SUPPORTED_LOCALES` (and `NATIVE_LOCALE_NAMES`, and
   `RTL_LOCALES` if applicable) in `src/i18n/index.ts`. The Settings → Language
   picker is populated from `SUPPORTED_LOCALES` automatically.
5. **Add the store-listing description** at
   `src/_locales/<lang>/messages.json` (underscore directory names for Chinese —
   `zh_CN`, `zh_TW`).
6. **Rebuild and verify** (below), then open a PR noting whether the source is
   machine-translated or human-authored.

## Testing locally

```
npm run build:all       # builds dist/ (Chrome) and dist-firefox/ (Firefox)
npm run typecheck
```

Load `dist/` as an unpacked extension (chrome://extensions → Load unpacked).
To exercise a specific locale, set your browser's UI language, or open the popup
and pick a language from **Settings → Language** (this persists an override in
`chrome.storage.local`, independent of the browser language). For RTL, pick
Arabic or Hebrew and confirm the layout mirrors.

## Review

Structural changes (new keys, plurals, renames) are reviewed on the English
side. Translation-only PRs get a lighter review — if you self-identify as a
native or fluent speaker, that's enough. Partial polish is welcome; you don't
have to review the whole file.

Thanks again for the help.
