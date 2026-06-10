# Store Submission Materials — Autonomi Browser Extension

Reusable content for the Chrome Web Store (**V2-488**) and Firefox AMO (**V2-489**)
submissions. The privacy policy is in `PRIVACY.md`.

> Publishing is blocked by **V2-484** (real installer assets) and, for the macOS
> daemon path, **V2-490** (Apple notarization). This document is the unblocked prep.

## Listing copy (shared)

**Name:** Autonomi

**Short summary** (≤132 chars, Chrome):
> View and download content from the Autonomi decentralized network, directly in your browser.

**Category:** Productivity

**Full description:**
> Autonomi lets you view and download content stored on the Autonomi decentralized
> network without leaving your browser. When a web page references Autonomi content
> (`autonomi://` links, images, video, audio, or embeds), the extension fetches it
> through a small local daemon (antd) and renders it inline or as a download.
>
> Highlights:
> - Inline rendering of images, video, audio, and PDFs from `autonomi://` references.
> - One-click downloads of Autonomi-hosted files.
> - Guided setup: if the local daemon isn't running, an onboarding page helps you
>   install it for your platform.
> - Connection status, antd version display, and an optional update check in the popup.
>
> Requires the antd daemon running locally — the extension guides you through it.
> No account, no tracking, no data collected (see the privacy policy).
>
> V1 is download-only: no upload, payment, or wallet features.

## Chrome — single-purpose description

> Fetch and display or download content from the Autonomi network that web pages
> reference via `autonomi://` links and `data-ant-*` attributes, through the user's
> local antd daemon.

## Chrome — permission justifications

- **`downloads`** — save Autonomi files the user downloads, and download the antd
  installer from GitHub Releases when the user clicks to install it.
- **`storage`** — persist user settings (daemon URL, toggles, size limit) locally.
- **`alarms`** — schedule periodic daemon health checks and the optional update
  check from the MV3 service worker (which Chrome can suspend).
- **host permission `http://localhost/*`, `http://127.0.0.1/*`** — communicate with
  the user's local antd daemon (the only network endpoint the extension talks to).
- **content script on `<all_urls>`** — scan visited pages for `autonomi://`
  references (`href`, `data-ant-src`, `data-ant-embed`) to render or offer them. No
  page data leaves the device.

## Chrome — reviewer notes

- The extension does **not** execute remote code. When the daemon is missing, it uses
  `chrome.downloads` to save a signed installer from the project's GitHub Releases;
  the **user** runs that installer outside the browser. Nothing is
  fetched-and-executed inside the extension.
- All network requests go to `localhost` (the user's daemon) or — only if the update
  check is enabled — the public GitHub Releases API. No remote config, no `eval`.
- No analytics or telemetry. Settings stay in `chrome.storage.local`.

## Firefox / AMO

- **Desktop-only:** set listing compatibility to **Firefox desktop**; do **not**
  enable Firefox for Android (the extension needs a `localhost` daemon, which is
  absent on Android), and do not declare `browser_specific_settings.gecko_android`.
  (Chrome is desktop-only by nature — no setting needed.)
- **Source-code submission (required):** AMO reviewers must reproduce the bundled
  build.
  - Build: `npm install`, then `npm run build:firefox` → output in `dist-firefox/`.
  - Tooling: Node 18+ (Node 23.6+ only for `npm test`), esbuild + TypeScript (see
    `package.json` / `build.mjs`). No network access required at build time.
  - The submitted package is the **contents** of `dist-firefox/`.

## Screenshots (capture for both stores)

Chrome sizes: 1280×800 or 640×400. Capture:
1. Onboarding — disconnected ("not detected" / download step).
2. Onboarding — connected ("You're connected").
3. Popup — connected (status + version).
4. Popup — disconnected (detect / download daemon / setup guide).
5. An example page with inline-rendered `autonomi://` content.

## Assets

- Icon: `assets/icons/icon-128.png` (16/48/128 present).
- Optional Chrome promo tile 440×280 (derive from branding).

## Privacy policy hosting

`PRIVACY.md` must be served at a stable URL for both listings (decision pending —
options: an `autonomi.com` page, GitHub Pages, or the docs site). Tracked in
**V2-502**. The existing site notice (<https://autonomi.com/privacy-notice>) is
**website-scoped** and does not cover the extension, so it cannot be used verbatim.
