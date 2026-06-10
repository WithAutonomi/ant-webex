# ant-webex

Browser extension for downloading and displaying content from the [Autonomi](https://autonomi.com) decentralized network.

Web developers embed `autonomi://` references in their pages. When a user with this extension visits, the extension automatically fetches and renders the content through a local **antd** daemon.

## How It Works

1. **antd** (the Autonomi network daemon) runs locally as a REST gateway to the network
2. The extension's content script scans web pages for `autonomi://` references
3. Detected resources are fetched via antd and rendered inline (images, video, audio, PDFs)
4. `autonomi://` links become clickable downloads

No data goes through any central server. The daemon connects directly to the Autonomi P2P network.

## Prerequisites

- **antd** — the Autonomi network daemon ([ant-sdk](https://github.com/WithAutonomi/ant-sdk))
- **Node.js** 18+ (for building the extension)
- **Chrome** 120+ or **Firefox** 128+ (Manifest V3)

### Set up the daemon (antd)

The extension can't reach the Autonomi network on its own — browser sandboxing and the network's post-quantum cryptography mean a small local daemon (**antd**) does the network work and exposes a localhost REST API the extension talks to.

**Recommended — guided setup:** after you install the extension, an onboarding page opens automatically with a **Download daemon** button for your platform. Run the downloaded installer; it starts antd (with CORS enabled) and sets it to launch on login, and the extension connects automatically. You can reopen this any time via the **Setup guide** link in the popup.

**Manual:** if you already have the `antd` binary, start it with CORS enabled (required for the extension to reach it):

```bash
antd --cors
```

antd listens on `http://localhost:8082` by default; the extension auto-detects it.

## Supported Browsers

| Browser | Engine | Status |
|---------|--------|--------|
| Chrome 120+ | Chromium | Supported |
| Edge 120+ | Chromium | Supported |
| Opera 109+ | Chromium | Supported |
| Brave 1.63+ | Chromium | Supported |
| Vivaldi 6.5+ | Chromium | Supported |
| Arc | Chromium | Supported |
| Firefox 128+ | Gecko | Supported |
| Tor Browser | Gecko | Supported |

All Chromium-based browsers use the same `dist/` build. Firefox/Tor use `dist-firefox/`.

## Build

```bash
npm install
npm run build            # Chrome / Chromium browsers → dist/
npm run build:firefox    # Firefox / Tor → dist-firefox/
npm run build:all        # Both
```

### Load in Chrome / Chromium browsers

1. Go to `chrome://extensions` (or `edge://extensions`, `brave://extensions`, etc.)
2. Enable "Developer mode"
3. Click "Load unpacked" and select the `dist/` directory

### Load in Firefox

1. Go to `about:debugging#/runtime/this-firefox`
2. Click "Load Temporary Add-on"
3. Select `dist-firefox/manifest.json`

## Embedding Autonomi Content (For Web Developers)

Add these to your HTML. Without the extension, they're inert. With it, content loads automatically.

### Links

```html
<a href="autonomi://NETWORK_ADDRESS">Download file</a>
```

### Images

```html
<img data-ant-src="autonomi://NETWORK_ADDRESS" alt="description" />
```

### Video / Audio

```html
<video data-ant-src="autonomi://NETWORK_ADDRESS" controls></video>
<audio data-ant-src="autonomi://NETWORK_ADDRESS" controls></audio>
```

### Generic Embeds

```html
<div data-ant-embed="autonomi://NETWORK_ADDRESS"
     data-ant-type="application/pdf"
     style="width:100%; height:600px;">
</div>
```

The optional `data-ant-type` attribute provides a MIME type hint. Without it, the extension sniffs the content type from magic bytes.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full tag format specification and design details.

## Configuration

Click the extension icon to open the popup. When connected it shows the antd **version**, and flags when an **update is available** or when antd is **older than the minimum supported version**. The **Setup guide** link reopens the onboarding page.

Settings:

- **Daemon URL** — defaults to `http://localhost:8082`. Change if antd runs on a different port.
- **Auto-fetch inline** — toggle automatic fetching of `data-ant-src` / `data-ant-embed` resources.
- **Check for antd updates** — periodically check GitHub for a newer antd release and show an update prompt.
- **Max inline size** — cap on auto-fetched resource size (default 50 MB).

## Native Messaging Host (Optional)

For automatic daemon port discovery (matching how other Autonomi SDKs find antd), you can install the native messaging host. See [native-host/README.md](native-host/README.md) for build and registration instructions.

Without it, the extension probes the default port (8082), which works for most setups.

## Development

```bash
npm run watch      # Rebuild on file changes
npm run typecheck  # Type-check without emitting
npm test           # Run unit tests (requires Node 23.6+ for native .ts execution)
```

After rebuilding, go to `chrome://extensions` and click the reload button on the extension card.

## V1 Scope

This version focuses on **downloading and displaying** public content. Upload, payment, wallet, and private data features are planned for future versions.

## License

MIT
