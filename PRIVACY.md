# Privacy Policy — Autonomi Browser Extension

_Last updated: 2026-06-10_

This policy describes the data practices of the **Autonomi** browser extension
("the extension"), published by the **Autonomi Foundation** (Place de Longemalle 1,
Geneva, Switzerland). It complements the Autonomi website privacy notice at
<https://autonomi.com/privacy-notice>, which covers the website rather than this
extension.

## Summary

The extension collects **no personal data**, contains **no analytics, telemetry,
or tracking**, and sends **no data to the Autonomi Foundation** or any third party
for profiling. Everything it does happens locally on your device or directly
between your browser and services you already use.

## What the extension does with data

**Local daemon (antd) — on your own machine.**
The extension communicates with a local Autonomi daemon (antd) over
`http://localhost` to fetch and download the content you request. This traffic
stays on your device / local network; the Autonomi Foundation does not receive it.

**Content you choose to view or download.**
When a page contains `autonomi://` references, the extension asks your local antd
to retrieve that content. Network addresses are sent only to your local daemon,
not to us. Fetched content is cached locally (the browser Cache API) for
performance.

**Update check (optional, on by default).**
To tell you when a newer antd release is available, the extension periodically
requests the public GitHub Releases API for the Autonomi SDK repository
(`api.github.com/repos/WithAutonomi/ant-sdk/releases`). This is a standard request
to GitHub with no personal data added. You can disable it in the extension settings
("Check for antd updates").

**Settings.**
Your preferences (daemon URL, toggles, size limits) are stored locally via the
browser's `chrome.storage.local`. They never leave your device.

## What we do NOT collect

- No names, emails, accounts, or identifiers.
- No browsing history or page content sent to us.
- No analytics, telemetry, advertising, or fingerprinting.
- No selling or sharing of data — there is none to sell or share.

## Permissions

The extension requests only the permissions needed for the above: `downloads`
(save files/installer you request), `storage` (save settings), `alarms` (schedule
the daemon health and update checks), and host access to `localhost` (talk to your
local daemon). Per-permission detail is in `STORE.md`.

## Third parties

- **GitHub** — only if the update check is enabled; subject to GitHub's own privacy
  policy.
- The extension downloads the antd installer from the project's GitHub Releases when
  you click to install it. Running that installer is your action, outside the
  extension.

## Changes

Material changes will be reflected here with an updated date.

## Contact

Data protection inquiries: <!-- TODO: confirm the Autonomi Foundation data-protection
contact email shown on https://autonomi.com/privacy-notice -->.
Autonomi Foundation, Place de Longemalle 1, Geneva, Switzerland.
