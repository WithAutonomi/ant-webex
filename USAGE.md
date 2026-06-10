# Embedding Autonomi Content in Web Pages

This guide is for **web developers** who want to serve content from the Autonomi decentralized network. Visitors with the ant-webex extension installed will see the content rendered inline. Visitors without it see nothing — the attributes are inert standard HTML `data-*` attributes.

No central server is involved. The extension fetches content through the visitor's local **antd** daemon, which connects directly to the Autonomi P2P network.

> **Just want to view Autonomi content?** End-user setup — installing the extension and the antd daemon — is covered in the [README](README.md#set-up-the-daemon-antd). The extension's onboarding page walks you through it on first install.

## Quick Reference

| Element | Attribute | Behavior |
|---------|-----------|----------|
| `<a>` | `href="autonomi://ADDR"` | Click triggers file download |
| `<img>` | `data-ant-src="autonomi://ADDR"` | Image fetched and rendered inline |
| `<video>` | `data-ant-src="autonomi://ADDR"` | Video fetched and set as source |
| `<audio>` | `data-ant-src="autonomi://ADDR"` | Audio fetched and set as source |
| Any element | `data-ant-embed="autonomi://ADDR"` | Content rendered in a sandboxed iframe |

All tags accept an optional `data-ant-type` MIME hint (see [MIME Detection](#mime-detection) below).

## Addresses

An Autonomi network address is a 64-character hex string (BLAKE3 hash). The full URI format is:

```
autonomi://9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08
```

You get this address when you store data on the network via antd or the Autonomi CLI.

## Download Links

```html
<a href="autonomi://ADDR">Download this file</a>
```

Clicking the link triggers a browser download dialog. The extension intercepts the click, fetches the data from the network, and hands it to the browser's download manager.

Without the extension, the link points to an unresolvable `autonomi://` URL and does nothing.

**Optional `download` attribute** — suggest a filename:

```html
<a href="autonomi://ADDR" download="report.pdf">Download report</a>
```

## Inline Images

```html
<img data-ant-src="autonomi://ADDR" alt="Description" />
```

The extension fetches the image data and sets the element's `src` attribute. Standard `<img>` attributes (`width`, `height`, `alt`, `loading`, `style`, etc.) all work normally.

**With a MIME hint** (useful if the file has no recognizable magic bytes):

```html
<img data-ant-src="autonomi://ADDR"
     data-ant-type="image/webp"
     alt="Photo" />
```

**Placeholder while loading** — the extension shows a spinner while fetching. You can style the element's initial state with CSS since it starts with no `src`:

```html
<img data-ant-src="autonomi://ADDR"
     alt="Photo"
     width="400" height="300"
     style="background: #1e293b;" />
```

## Video

```html
<video data-ant-src="autonomi://ADDR" controls width="640"></video>
```

The extension fetches the video data and sets the `<video>` element's `src`. Standard attributes like `controls`, `autoplay`, `muted`, `loop`, `poster`, `width`, `height` all work normally.

**With MIME hint:**

```html
<video data-ant-src="autonomi://ADDR"
       data-ant-type="video/mp4"
       controls>
</video>
```

Note: the entire video is fetched before playback begins (no streaming in v1).

## Audio

```html
<audio data-ant-src="autonomi://ADDR" controls></audio>
```

Same behavior as video — fetches the full audio file and sets `src`.

```html
<audio data-ant-src="autonomi://ADDR"
       data-ant-type="audio/mpeg"
       controls>
</audio>
```

## Generic Embeds

For content that doesn't map to a native HTML element (HTML pages, PDFs, etc.), use `data-ant-embed` on any container element:

```html
<div data-ant-embed="autonomi://ADDR"
     data-ant-type="text/html"
     style="width: 100%; height: 400px;">
</div>
```

The extension creates a **sandboxed iframe** inside the container and loads the content into it. The iframe fills the container's dimensions, so set a width and height on the container.

**PDF embed:**

```html
<div data-ant-embed="autonomi://ADDR"
     data-ant-type="application/pdf"
     style="width: 100%; height: 600px;">
</div>
```

**The iframe is sandboxed** — embedded content cannot run scripts, open popups, or navigate the parent page. This is a security measure since content comes from a public network.

## MIME Detection

The extension determines the content type in this priority order:

1. **`data-ant-type` attribute** — explicit hint from the page author
2. **Magic byte sniffing** — checks the first bytes of the fetched data
3. **Fallback** — `application/octet-stream`

Auto-detected types via magic bytes:

| Type | Format |
|------|--------|
| `image/png` | PNG |
| `image/jpeg` | JPEG |
| `image/gif` | GIF |
| `image/webp` | WebP |
| `video/mp4` | MP4 |
| `video/webm` | WebM |
| `audio/mpeg` | MP3 (ID3) |
| `audio/ogg` | Ogg Vorbis/Opus |
| `application/pdf` | PDF |
| `text/html` | HTML (leading `<`) |

For any other format, provide `data-ant-type` explicitly.

## Graceful Degradation

All Autonomi attributes are standard HTML `data-*` attributes or `href` values with a custom protocol. Without the extension:

- `data-ant-src` — ignored by the browser; the `<img>`, `<video>`, or `<audio>` element simply has no `src` and renders nothing
- `data-ant-embed` — ignored; the container `<div>` stays empty
- `href="autonomi://..."` — the link is visible but navigating to it fails (unresolvable protocol)

You can provide fallback content inside embed containers:

```html
<div data-ant-embed="autonomi://ADDR" data-ant-type="text/html"
     style="width:100%; height:400px;">
  <p>This content is hosted on the Autonomi network.
     Install the <a href="https://github.com/user/ant-webex">ant-webex extension</a> to view it.</p>
</div>
```

The extension replaces the container's contents with an iframe when it loads, so the fallback text disappears automatically.

## Dynamic Content (SPAs)

The extension watches for DOM mutations. If your JavaScript adds `autonomi://` elements after initial page load (e.g., in a single-page app), they will be detected and rendered automatically. No additional API calls are needed.

## Limits

- **Max inline size** — configurable by the user (default 50 MB). Resources exceeding this are rejected with an error tooltip on the element.
- **Auto-fetch toggle** — users can disable automatic inline fetching. Download links still work when auto-fetch is off.
- **No streaming** — video and audio are fully downloaded before playback. Large media files should use download links instead of inline embedding.

## Full Example

```html
<!DOCTYPE html>
<html>
<head>
  <title>My Autonomi-powered page</title>
</head>
<body>
  <h1>Decentralized Content</h1>

  <!-- Download link -->
  <a href="autonomi://abc123...def" download="document.pdf">
    Download the whitepaper
  </a>

  <!-- Inline image -->
  <img data-ant-src="autonomi://abc123...def"
       alt="Project logo"
       width="200" height="200" />

  <!-- Video with MIME hint -->
  <video data-ant-src="autonomi://abc123...def"
         data-ant-type="video/mp4"
         controls width="640">
  </video>

  <!-- Embedded HTML page -->
  <div data-ant-embed="autonomi://abc123...def"
       data-ant-type="text/html"
       style="width:100%; height:500px;">
    <p>Install ant-webex to view this content.</p>
  </div>
</body>
</html>
```
