# ant-webex

Browser extension for Autonomi network content. Communicates with a local antd daemon via REST.

## Architecture

- `src/background/` — MV3 service worker (daemon health, resource fetching, downloads)
- `src/content/` — content script (DOM scanning for `autonomi://` references, inline rendering)
- `src/popup/` — extension popup UI (status, settings, install guidance)
- `src/shared/` — shared types, antd REST client, message definitions
- `native-host/` — optional Rust binary for daemon.port auto-discovery

## Key Conventions

- **V1 is download-only** — no upload, payment, or wallet operations
- **antd** is the daemon (from WithAutonomi/ant-sdk), not ant-client
- **Manifest V3** — service worker (not background page), Chrome 120+
- **esbuild** builds three bundles: background (ESM), content (IIFE), popup (IIFE)
- Content script detects `autonomi://` hrefs, `data-ant-src`, `data-ant-embed` attributes
- Service worker may be suspended by Chrome — state persisted to chrome.storage.local

## Build

```bash
npm install
npm run build      # → dist/
npm run watch      # dev mode with sourcemaps
npm run typecheck  # tsc --noEmit
```

Load `dist/` as unpacked extension in chrome://extensions.

## antd Interaction

- Health: `GET /health`
- Public data: `GET /v1/data/public/:addr`
- Chunks: `GET /v1/chunks/:addr`
- Files: `POST /v1/files/download/public` (body: `{ "address": "..." }`)
- Default port: 8082, auto-discovered via `daemon.port` file (native host) or probed directly
- antd must be started with `--cors` flag for extension access
