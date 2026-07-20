# Releasing

Release artifacts are built by CI ([`.github/workflows/release.yml`](./.github/workflows/release.yml))
from a clean checkout — you don't hand-zip `dist/`. Cutting a release is just a
version bump and a tag.

## Cut a release

1. **Bump the version** in both `src/manifest.json` and `package.json` (they must
   match — CI fails the release if they don't). Commit it.
2. **Tag and push:**
   ```bash
   git tag v0.1.3          # tag must equal the manifest/package version
   git push origin main --tags
   ```
   The tag push triggers the release workflow.
3. **Grab the artifacts.** They're attached to the GitHub Release for the tag
   (and also downloadable from the workflow run under *Actions*):
   - `ant-webex-chrome-vX.Y.Z.zip` — upload to the Chrome Web Store dashboard.
   - `ant-webex-firefox-vX.Y.Z.xpi` — the **signed, unlisted** Firefox build;
     testers install it directly (drag into Firefox). *Requires AMO creds — see
     below; without them you get `…-unsigned.zip` instead, which won't install.*
   - `ant-webex-source-vX.Y.Z.zip` — upload as the AMO **source-code submission**.

You can also run it without tagging: **Actions → Release artifacts → Run
workflow** (`workflow_dispatch`). Manual runs upload the artifacts to the run but
don't create a GitHub Release.

## One-time setup: AMO signing (for the Firefox `.xpi`)

The signed Firefox build uses `web-ext sign` against the AMO API. Until these are
configured, the workflow still succeeds but emits an **unsigned** Firefox zip.

1. **Get AMO API credentials** at <https://addons.mozilla.org/developers/addon/api/key/>
   — an API **key** (issuer, `user:…`) and **secret**.
2. **Store them as GitHub secrets** named `WEB_EXT_API_KEY` and
   `WEB_EXT_API_SECRET`. Recommended: put them on a protected **Environment**
   (Settings → Environments → `release`) rather than plain repo secrets — the
   workflow already runs in the `release` environment, so you can add a
   **required reviewer** to gate every release, and environment secrets are never
   exposed to fork-PR runs.
3. **Add-on ID.** The Firefox manifest already declares
   `browser_specific_settings.gecko.id = autonomi@webex`. Unlisted signing
   auto-registers the add-on under that ID on the first run — no manual AMO
   listing needed.

### Notes

- **Versions are one-shot on AMO.** It won't re-sign a version it has already
  seen, so every signed build needs a fresh `manifest.json` version. Bump before
  re-tagging.
- **Unlisted ≠ listed.** This produces a self-distributed build for testers, not
  a public AMO listing. Publishing to the public Chrome Web Store / AMO listings
  is tracked separately (see the store-upload automation ticket).
- **Reproducibility.** The build is deterministic (verified by CI's
  reproducible-build check), so the artifact equals the tagged commit built with
  the pinned toolchain — matching `BUILD.md`'s AMO source-reproduction steps.
