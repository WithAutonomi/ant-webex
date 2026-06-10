# Architecture

## Overview

ant-webex is a browser extension that lets web pages embed and display content from the Autonomi decentralized network. It communicates with a local **antd** daemon (the Autonomi network gateway) to fetch data, so the browser never touches the P2P network directly.

```
┌─────────────────────────────────────────────────────────┐
│  Browser                                                │
│  ┌─────────────┐   messages   ┌──────────────────────┐  │
│  │ Content      │◄───────────►│ Service Worker       │  │
│  │ Script       │             │ (background)         │  │
│  │              │             │                      │  │
│  │ • scan DOM   │             │ • health polling     │  │
│  │ • render     │             │ • fetch resources    │  │
│  │   resources  │             │ • download files     │  │
│  │ • bind links │             │ • daemon detection   │  │
│  └─────────────┘             └──────────┬───────────┘  │
│                                         │               │
│  ┌─────────────┐                        │ HTTP/REST     │
│  │ Popup UI    │────messages────────────┤               │
│  │ • status    │                        │               │
│  │ • settings  │                        │               │
│  └─────────────┘                        │               │
└─────────────────────────────────────────┼───────────────┘
                                          │
                              ┌───────────▼───────────┐
                              │  antd daemon           │
                              │  localhost:8082        │
                              │                        │
                              │  GET /v1/data/public/  │
                              │  GET /v1/chunks/       │
                              │  POST /v1/files/       │
                              └───────────┬───────────┘
                                          │
                              ┌───────────▼───────────┐
                              │  Autonomi P2P Network  │
                              │  (DHT, self-encryption │
                              │   EVM payments, PQC)   │
                              └───────────────────────┘
```

## Components

### Service Worker (`src/background/`)

The MV3 service worker is the extension's brain. It:

- **Polls antd health** on a 30-second alarm cycle. Updates badge icon (red `!` when disconnected).
- **Fetches resources** from antd on behalf of content scripts. Creates blob URLs for inline rendering.
- **Triggers downloads** via `chrome.downloads` API when users click `autonomi://` links.
- **Auto-detects antd** by probing the default port (8082) and optionally querying the native messaging host for the `daemon.port` file.

The service worker may be suspended by Chrome when idle (MV3 lifecycle). State is persisted to `chrome.storage.local` and restored on wake.

### Content Script (`src/content/`)

Injected into every web page. Three modules:

- **scanner.ts** — finds `autonomi://` references in the DOM (see [Tag Format](#tag-format-for-web-developers) below). Uses `MutationObserver` to catch dynamically added elements (SPAs, lazy loading).
- **renderer.ts** — replaces detected elements with live content. Sets `src` on `<img>`/`<video>`/`<audio>`, creates `<iframe>` for generic embeds, intercepts clicks on `autonomi://` links.
- **index.ts** — entry point. Runs initial scan, starts observer, responds to popup queries.

### Popup (`src/popup/`)

Extension popup UI (360px wide, dark theme). Shows:

- Daemon connection status (green/red dot)
- List of autonomi resources detected on the current page
- "Install antd" flow with platform-specific instructions
- Settings: daemon URL, auto-fetch toggle, max inline size

### Native Messaging Host (`native-host/`)

Optional Rust binary registered with the browser. Provides filesystem access the extension doesn't have:

1. **Reads `daemon.port`** — the same file all Autonomi SDKs use for auto-discovery
2. **Finds antd binary** — checks PATH and common install locations

Without the native host, the extension falls back to probing the default port (works for most users).

### Shared (`src/shared/`)

- **antd-client.ts** — minimal REST client wrapping antd GET endpoints only (v1 is download-only)
- **types.ts** — shared TypeScript types
- **messages.ts** — typed message definitions for content ↔ service worker ↔ popup communication
- **constants.ts** — protocol prefix, ports, storage keys

## Tag Format for Web Developers

Web developers embed Autonomi references using standard HTML attributes. Without the extension installed, these are inert — the browser ignores unknown `data-*` attributes and `autonomi://` hrefs don't resolve.

### Links (click to download)

```html
<a href="autonomi://abc123def456">Download the report</a>

<!-- With download filename hint -->
<a href="autonomi://abc123def456" download="report.pdf">Download PDF</a>
```

When clicked, the extension intercepts navigation, fetches the data through antd, and triggers a browser download dialog.

### Images (auto-rendered)

```html
<img data-ant-src="autonomi://abc123def456" alt="Photo from Autonomi" />

<!-- With MIME type hint (skips magic-byte sniffing) -->
<img data-ant-src="autonomi://abc123def456" data-ant-type="image/webp" alt="Photo" />
```

The extension sets the `src` attribute to a blob URL once the data is fetched.

### Video / Audio

```html
<video data-ant-src="autonomi://abc123def456" controls></video>
<audio data-ant-src="autonomi://abc123def456" controls></audio>
```

Same mechanism as images — `src` is set to a blob URL.

### Generic Embeds (PDFs, HTML, etc.)

```html
<div data-ant-embed="autonomi://abc123def456" data-ant-type="application/pdf"
     style="width:100%; height:600px;">
  <!-- Extension creates an <iframe> here -->
</div>
```

The `data-ant-type` attribute is recommended for embeds so the browser can render them correctly.

### Why `data-ant-*` instead of `src`?

Setting `src="autonomi://..."` directly would cause the browser to attempt (and fail) to resolve the URL as a real protocol, generating console errors and broken-image icons. Using `data-*` attributes means:

- **No errors** without the extension — attributes are simply ignored
- **Graceful degradation** — you can include fallback content inside the element
- **Progressive enhancement** — the extension upgrades inert elements to live content

### MIME Type Detection

The extension detects content type in order of preference:

1. `data-ant-type` attribute (explicit hint from the page author)
2. Magic byte sniffing (PNG, JPEG, GIF, WebP, PDF, MP4, WebM, MP3, OGG)
3. Falls back to `application/octet-stream`

## Daemon Detection Flow

```
Extension starts
  │
  ├─ Probe GET http://localhost:8082/health
  │   ├─ 200 OK → connected ✓
  │   └─ failed ↓
  │
  ├─ Query native messaging host (if installed)
  │   ├─ Reads daemon.port file → got port? probe that port
  │   │   ├─ 200 OK → connected ✓, save new URL
  │   │   └─ failed ↓
  │   └─ Not installed → skip
  │
  └─ Show "Daemon not detected" in popup
      ├─ "Re-detect" button → retry above
      └─ "Install antd" button → platform-specific instructions
```

The `daemon.port` file is written by antd on startup to a platform-specific path:

| Platform | Path |
|----------|------|
| Windows  | `%APPDATA%\ant\daemon.port` |
| Linux    | `~/.local/share/ant/daemon.port` |
| macOS    | `~/Library/Application Support/ant/daemon.port` |

This is the same auto-discovery mechanism used by antd-js, antd-py, and all other Autonomi SDKs.

## Build System

esbuild bundles three entry points per browser target:

| Entry | Chrome format | Firefox format | Why |
|-------|--------------|----------------|-----|
| `src/background/index.ts` | ESM | IIFE | Firefox doesn't support ESM service workers in MV3 yet |
| `src/content/index.ts` | IIFE | IIFE | Content scripts must be self-contained |
| `src/popup/index.ts` | IIFE | IIFE | Popup runs in its own page context |

The manifest is assembled at build time by merging `src/manifest.json` (base) with
`src/manifest.chrome.json` or `src/manifest.firefox.json` (browser-specific `background` block).

| Build command | Output | Browsers |
|---------------|--------|----------|
| `npm run build` | `dist/` | Chrome, Edge, Opera, Brave, Vivaldi, Arc, Yandex |
| `npm run build:firefox` | `dist-firefox/` | Firefox, Tor Browser |
| `npm run build:all` | Both | All supported |

## Browser Support

All Chromium-derived browsers share the same extension format (MV3 with service workers).
Firefox MV3 uses event pages (`background.scripts`) instead of `service_worker`, and requires
a `browser_specific_settings.gecko` block with an extension ID.

The codebase uses the `chrome.*` namespace throughout. Firefox provides a compatibility layer
that maps `chrome.*` calls to its native `browser.*` API, so no conditional code is needed.

## V1 Scope

**In scope:**
- Download / inline display of public data
- `autonomi://` link detection and handling
- Auto-detect antd daemon (health probe + native messaging)
- Platform-specific install guidance
- Chrome + all Chromium browsers + Firefox

**Out of scope (future):**
- Upload / PUT operations
- Payment flows / wallet integration
- Private data (requires keys)
- File streaming (SSE from antd)
- Safari (requires Xcode + Apple WebExtension wrapper)
