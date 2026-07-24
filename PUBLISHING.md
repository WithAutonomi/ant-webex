# Publishing to the stores

Pushing a new version to the **public** Chrome Web Store and Firefox AMO listings
is a deliberate, gated action — the [`publish.yml`](./.github/workflows/publish.yml)
workflow, run manually. It automates *version uploads*, not the initial listings.

> For **tester** distribution (Chrome trusted testers / an unlisted signed
> Firefox `.xpi`) you usually don't need this — see `RELEASING.md`. This file is
> for the public listings.

## Prerequisites (one-time, manual)

1. **Create both store listings by hand first.** The stores need name,
   description, screenshots, category, privacy info, etc., which can't be created
   over the API:
   - Chrome Web Store: create the item in the [Developer Dashboard](https://chrome.google.com/webstore/devconsole).
   - AMO: create a **listed** add-on at [addons.mozilla.org/developers](https://addons.mozilla.org/developers/).
     Its ID must match the manifest's `browser_specific_settings.gecko.id`
     (`autonomi@webex`).
2. **Configure credentials** as secrets on the **`store-publish` environment**
   (Settings → Environments → `store-publish`). Add a **required reviewer** there
   so every publish needs approval, and secrets stay off fork-PR runs.

### Chrome Web Store credentials

CWS uses OAuth2. In a Google Cloud project, enable the *Chrome Web Store API*,
create an OAuth client (Desktop), and mint a **refresh token** (the fiddly part —
follow the [CWS API docs](https://developer.chrome.com/docs/webstore/using-api)).
Then set:

| Secret | Value |
|---|---|
| `CWS_CLIENT_ID` | OAuth client ID |
| `CWS_CLIENT_SECRET` | OAuth client secret |
| `CWS_REFRESH_TOKEN` | Refresh token (can be revoked/expire — re-mint if publishing 401s) |
| `CWS_EXTENSION_ID` | The item ID from the dashboard |

### Firefox AMO credentials

From [AMO → Manage API Keys](https://addons.mozilla.org/developers/addon/api/key/):

| Secret | Value |
|---|---|
| `WEB_EXT_API_KEY` | JWT issuer (`user:…`) |
| `WEB_EXT_API_SECRET` | JWT secret |

(Same pair used by `release.yml` for unlisted signing — set them once at the repo
level, or in both environments.)

## Running it

**Actions → Publish to stores → Run workflow**, then choose:
- **tag** — the release tag to publish (must already exist), e.g. `v0.1.3`.
- **stores** — `both`, `chrome`, or `firefox`.
- **chrome_target** — **`trustedTesters` first** (safe: publishes only to your
  test group), then `default` (public) once you've verified.

The job checks out the tag, rebuilds (reproducible, so it equals the released
artifact), uploads, and publishes. If a required reviewer is set on the
environment, it pauses for approval first.

## What to expect

- **Neither store bypasses review.** The API submits; Google/Mozilla still review
  (hours to days). "Published" means "submitted + accepted," not "instant."
- **Versions are one-shot.** Each store rejects a version it has already seen —
  bump `manifest.json`/`package.json` and re-tag before re-publishing. On AMO
  this holds **across channels**: a version signed unlisted (rc/tester builds)
  can never be submitted listed, which is why `release.yml` only unlisted-signs
  `-rc.` tags. Only publish versions that have never touched AMO.
- **AMO source submission.** AMO requires source for minified/bundled add-ons.
  `web-ext sign --channel=listed` submits the build; if AMO also wants the source
  archive attached, upload `ant-webex-source-vX.Y.Z.zip` (from the release) via
  the AMO dashboard, or attach it through the API. Verify what's needed on the
  first listed submission.
- **Safe first run:** publish Chrome to `trustedTesters` and Firefox to a small
  audience, confirm the listing looks right, then go public.
