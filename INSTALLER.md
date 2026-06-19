# antd Installer Requirements

Handoff spec for the team building the **antd daemon installers** that the
Autonomi browser extension downloads. One installer per desktop OS:

| OS | Package | Asset filename (exact) |
|----|---------|------------------------|
| Windows | MSI | `antd-windows-x64-setup.msi` |
| macOS | PKG | `antd-macos.pkg` |
| Linux | DEB | `antd-linux-x64.deb` |

> **Windows uses an MSI to match the existing Autonomi GUI.** The GUI is a Tauri
> app whose release CI builds `tauri build --bundles msi` and ships a signed
> `Autonomi_<version>_x64_en-US.msi` — so the team already has a working
> Tauri/WiX + Authenticode pipeline to reuse. See §3 (including the per-user
> autostart nuance and the asset-naming caveat).

The extension only **downloads** the file (via `chrome.downloads`, with a Save
dialog). The **user runs it**. After they run it, the extension expects a
working daemon with **no further configuration**.

All the strings the extension uses live in
[`src/shared/constants.ts`](src/shared/constants.ts) — keep them in sync with
whatever you publish.

---

## 1. The two contracts

### 1a. Publishing contract (so the download resolves)

The extension builds this URL and hands it to the browser:

```
https://github.com/{repo}/releases/download/{tag}/{asset}
```

| Part | Value | Constant |
|------|-------|----------|
| `{repo}` | `WithAutonomi/ant-sdk` | `ANTD_RELEASE_REPO` |
| `{tag}` | `v0.9.2` | `ANTD_RELEASE_TAG` |
| `{asset}` | per-OS filename above | `ANTD_INSTALLER_ASSETS` |

Requirements:
- Each installer is a **public GitHub Release asset** on that repo, under that
  exact tag, with the **exact filename** (byte-for-byte) listed above.
- **Directly downloadable, no auth** — it's a plain browser download.
- If you change a filename or tag, update `constants.ts` to match, or the
  download 404s.

### 1b. Runtime contract (so the extension connects)

After the user runs the installer, the daemon must be:

1. **antd version ≥ 0.9.2** (`MIN_ANTD_VERSION`). Older → the extension shows a
   hard "antd too old" warning.
2. **Started with the `--cors` flag.** Non-negotiable: the extension calls
   antd's REST API from a browser origin; without `--cors` every request is
   blocked and the daemon looks "not connected."
3. **Listening on `127.0.0.1:8082`** (the default). The extension probes
   `127.0.0.1:8082`–`8090`. If you must use another port, antd has to write its
   `daemon.port` file (below) — but **default 8082 is strongly recommended**, as
   `daemon.port` discovery relies on the optional native-messaging host.
4. **Auto-started on login** (so it persists across reboots) — see the **B**
   approach below.
5. **Running in the user's session** (not as root / LocalSystem) so its
   per-user data lands in the right place (next section).

---

## 2. Why "per-user login autostart" (approach B)

antd keeps per-user state — its `daemon.port` file and config — under the
**logged-in user's** profile:

| OS | Per-user data dir |
|----|-------------------|
| Windows | `%APPDATA%\ant\sdk\` |
| macOS | `~/Library/Application Support/ant/sdk/` |
| Linux | `~/.local/share/ant/sdk/` |

If the daemon runs as **root / LocalSystem** (a Windows Service, a macOS
LaunchDaemon, or a system systemd unit), those files land in the *wrong*
profile and the extension can't find them. So every OS uses the **per-user,
login-session** autostart mechanism — never the root/boot one.

```
            ✅ use this (per-user)              ❌ avoid (root/boot)
Windows     Run key / Scheduled Task (logon)    Windows Service (LocalSystem)
macOS       LaunchAgent                         LaunchDaemon (root)
Linux       systemd --user / XDG autostart      systemd system unit (root)
```

Each installer must do the same three things: **install antd → register
per-user login autostart with `--cors` → start it once now** (so the user
doesn't have to log out/in before the extension connects).

---

## 3. Windows — MSI

**Recommendation: MSI, matching the Autonomi GUI.** The GUI is a Tauri app; its
release CI builds `tauri build --bundles msi,updater` and ships a signed
`Autonomi_<version>_x64_en-US.msi` (WiX). The team therefore already has a
working **Tauri/WiX + Authenticode signing** pipeline — reuse it for antd rather
than introducing a separate (NSIS) toolchain.

**Tooling:** WiX (via the same Tauri bundler the GUI uses), with the existing
`signCommand` signing step.

**Install location & scope**
- Install `antd.exe` under `C:\Program Files\Autonomi\antd\antd.exe` — nesting
  `antd\` beside the GUI under the shared `Autonomi\` parent, and matching the
  path the extension's "find & run" help shows.
- **Match the GUI's MSI install scope** (per-machine vs per-user — it's the Tauri
  WiX default, as the GUI sets no `installMode` override). Per-machine is the
  common Tauri WiX default and is **fine here** — see the next point.

**The install scope does *not* dictate how the daemon runs.** Approach B is
about the daemon *running in the user's session* (so `daemon.port`/config land in
the user's `%APPDATA%\ant\sdk\`), which is independent of where the binary is
installed. A per-machine binary is fine **as long as antd is started via a
per-user autostart, _not_ a Windows Service** (a Service runs as LocalSystem →
wrong profile).

**Autostart at login with `--cors`** — pick one:
- **Run key:** `…\CurrentVersion\Run` → `Autonomi antd` =
  `"C:\Program Files\Autonomi\antd\antd.exe" --cors`. An **`HKLM`** Run key runs
  for every user at *their* login, in *their* session (correct per-user data);
  use **`HKCU`** to scope it to just the installing user. Either is per-user at
  runtime — neither runs as SYSTEM.
- **Scheduled Task (preferred):** a logon-triggered task running `antd.exe
  --cors`. Preferred because it can run **hidden**.

> ⚠️ **Do NOT install antd as a Windows Service.** That's the one option that
> runs as LocalSystem and writes `daemon.port` to the wrong profile, breaking
> discovery. Use a Run key or Scheduled Task.

> ⚠️ **Console window:** antd is a console program. Launched plainly it shows a
> terminal window. Use a hidden Scheduled Task, a windowless launcher, or a
> windowless antd build so nothing visible pops up.

**Start immediately after install**
- A WiX **custom action on finish, in user context** (the WixUI "launch
  application when setup completes" pattern — *not* a `deferred`/elevated action,
  which runs as SYSTEM). Launches `antd.exe --cors` once so the extension
  connects without a reboot/relogin.

**Uninstall**
- Remove the Run key / Scheduled Task and stop the running process.

**Signing**
- Authenticode-sign `antd.exe` and the `.msi` (reuse the GUI's `signCommand`
  pipeline). An EV certificate is strongly recommended to avoid SmartScreen.

> ⚠️ **Asset naming caveat.** Tauri names MSIs with the version baked in
> (`Autonomi_0.8.2_x64_en-US.msi`), but the extension's download URL needs a
> **fixed** filename (`antd-windows-x64-setup.msi`). So the release job must
> **rename/republish** the artifact under the stable name (the same applies if
> the macOS/Linux bundlers emit versioned names). Alternatively the extension
> would have to resolve the versioned asset via the GitHub API — a code change,
> currently out of scope.

---

## 4. macOS — PKG

**Why PKG and not DMG.** The Autonomi GUI ships a notarized **`.app`** (drag-to-
Applications, user-launched) — fine for an app, but a **DMG / `.app` runs no
install logic**, so it *cannot* register a LaunchAgent or start a background
daemon. antd is headless and must auto-install + autostart, which requires a
**PKG** (its postinstall script does the LaunchAgent + `launchctl` work). This is
the one place antd deliberately diverges from the GUI's packaging.

> The GUI's Apple **Developer ID + notarization** pipeline is reusable, but note
> a PKG is signed with a **Developer ID _Installer_** certificate (the GUI's
> `.app` uses **Developer ID _Application_**) — same Apple account, possibly a
> new cert to generate. Both still get notarized.

**Tooling:** `pkgbuild` + `productbuild` (or Packages.app).

**Install**
- Place the binary at `/usr/local/bin/antd` (matches the extension's help text).

**Autostart at login with `--cors` — LaunchAgent**
- Install a LaunchAgent plist at
  `/Library/LaunchAgents/com.autonomi.antd.plist`. Agents in
  `/Library/LaunchAgents` load **per-user, in each user's GUI session as that
  user** — so you install as root but the daemon still runs as the user (correct
  profile). Use a reverse-DNS label consistent with the project
  (`com.autonomi.antd`; cf. the native host `com.autonomi.webex`).
- Key plist contents:
  - `Label` = `com.autonomi.antd`
  - `ProgramArguments` = `["/usr/local/bin/antd", "--cors"]`
  - `RunAtLoad` = `true`
  - `KeepAlive` = `true` (optional — restarts antd if it exits)

**Start immediately after install**
- A **postinstall script** that resolves the active console user and boots the
  agent, e.g.:
  ```sh
  uid=$(stat -f %u /dev/console)
  launchctl bootstrap gui/$uid /Library/LaunchAgents/com.autonomi.antd.plist
  ```
  > ⚠️ postinstall runs as **root** — resolve the real logged-in user; don't
  > assume `$HOME`/`~` is the user's.

**Signing & notarization**

A PKG needs **two** Apple Developer ID certificate types (a DMG/`.app` needs only
the first — which is why the GUI has only that one today):

1. **Developer ID _Application_** — signs the `antd` binary *inside* the pkg
   (the GUI already uses this; `APPLE_SIGNING_IDENTITY` in its CI).
2. **Developer ID _Installer_** — signs the `.pkg` itself. **This is the only
   genuinely new piece** vs. the GUI.

Then **notarize** the `.pkg` (`notarytool`) and **staple** — Gatekeeper blocks
an un-notarized pkg.

**Where the certs come from (the Installer cert is the new one)**
- Both certs are issued **free by Apple** inside the **same Apple Developer
  Program membership the GUI already uses** — nothing is purchased, and it's not
  a third-party CA (contrast Windows, where the cert comes from DigiCert).
- Generate the **Developer ID Installer** cert, either:
  - **Apple Developer portal** → *Certificates, Identifiers & Profiles →
    Certificates → + → Software → "Developer ID Installer"*, uploading a CSR you
    create in **Keychain Access → Certificate Assistant → Request a Certificate
    from a CA**; or
  - **Xcode → Settings → Accounts → (team) → Manage Certificates → + →
    Developer ID Installer** (handles the CSR for you).
- ⚠️ Must be done by the **Account Holder** (or an Admin with permission). Apple
  caps the number of active Developer ID certs per type, so check existing ones
  first.

**Wiring it into CI** (mirrors the GUI's `APPLE_CERTIFICATE` handling)
- Export the Installer cert **+ private key** from Keychain as a **`.p12`**,
  base64-encode it, and add it as a **new** secret (e.g.
  `APPLE_INSTALLER_CERTIFICATE` + `…_PASSWORD`). Reuse the GUI's existing
  `APPLE_ID` / app-specific password / `APPLE_TEAM_ID` for notarization.
- On the runner: import the `.p12` into a temp keychain, then
  `productbuild --sign "Developer ID Installer: <Name> (<TEAMID>)"` (or
  `productsign`) the pkg, then `notarytool submit … --wait` and
  `xcrun stapler staple`.

**Hardened runtime (required for notarization)**
- Sign the `antd` binary with **`codesign --options runtime`** (+ a secure
  timestamp). Notarization **rejects** binaries without the hardened runtime. Add
  an entitlements plist only if something the daemon does is blocked by it (a
  plain network daemon usually needs none).

---

## 5. Linux — DEB

**Tooling:** `dpkg-deb` / `debheper` / `fpm`.

**Install**
- Place the binary at `/usr/bin/antd` (matches the extension's help text).
- Declare any shared-library dependencies in the package control file.

**Autostart at login with `--cors` — systemd user service (recommended)**
- Ship a user unit at `/usr/lib/systemd/user/antd.service`:
  ```ini
  [Unit]
  Description=Autonomi antd daemon

  [Service]
  ExecStart=/usr/bin/antd --cors
  Restart=on-failure

  [Install]
  WantedBy=default.target
  ```
- In `postinst`, enable it for all users' sessions:
  ```sh
  systemctl --global enable antd.service
  ```
  This runs antd in each user's session (correct per-user profile).

**Start immediately after install**
- ⚠️ Harder than Windows/macOS: `postinst` runs as **root** and can't cleanly
  start a `--user` service for the logged-in user (it needs their session/DBus).
  Acceptable outcomes, in order of preference:
  1. Detect the active user and
     `systemctl --user --machine=<user>@.host start antd.service`, or
  2. Document that it **connects on next login** (the `--global enable` makes it
     start automatically then).

**Desktop-only alternative — XDG autostart**
- An `/etc/xdg/autostart/antd.desktop` with `Exec=antd --cors` launches at
  graphical login. Simpler, but only fires in **desktop** sessions (not
  headless) and is desktop-environment dependent.

**Decision needed:** systemd `--user` (general, incl. headless) vs XDG autostart
(desktop only). systemd is recommended; note it assumes a systemd distro (true
for most modern ones).

**Signing**
- Standalone `.deb` files downloaded from GitHub aren't gatekept like Windows/mac
  packages. (Repo-level GPG signing only matters if distributed via an apt repo,
  which this isn't.)

---

## 6. Open decision — CPU architecture

The extension's OS detection (`detectOs()` in `constants.ts`) distinguishes
**only** Windows / macOS / Linux — **it does not detect CPU architecture.** Each
OS therefore maps to exactly **one** asset. The current filenames say `x64`.

Choose one:
- **Universal builds per OS** (recommended): a universal macOS pkg (x64 + arm64),
  and MSI/deb that install the right arch. No extension change; current
  single-asset-per-OS model holds.
- **Per-arch assets:** requires an extension change to detect arch and pick the
  asset — more work, and the filename constants would need arch variants.

As shipped today, an Apple-Silicon or ARM-Linux user would receive the x64
download. Decide before release.

---

## 7. Acceptance criteria

For each OS, on a clean machine:

1. Click **Download daemon** in the extension popup (or onboarding page) → the
   correct asset downloads from the GitHub release URL.
2. Run the installer with default options.
3. **Without any manual step or reboot**, within a few seconds the extension's
   onboarding page banner turns green / the popup shows **Connected**.
4. `antd` is listening on `127.0.0.1:8082` and responds to `GET /health`.
5. The daemon was started **with `--cors`** (a request from the extension's
   origin succeeds — i.e. the page actually loads `autonomi://` content).
6. The `daemon.port`/config files exist under the **per-user** data dir (§2).
7. **Reboot / log out and back in** → antd is running again automatically.
8. No visible console/terminal window lingers (Windows especially).
9. Uninstalling removes the autostart entry and stops the daemon.

---

## 8. Summary checklist

- [ ] Build signed installers: Windows **MSI** (WiX, reusing the GUI pipeline),
      macOS `.pkg` (notarized), Linux `.deb`.
- [ ] Each installs `antd` ≥ 0.9.2 to the documented path
      (Windows: `C:\Program Files\Autonomi\antd\`).
- [ ] Each registers **per-user login autostart** running `antd --cors`
      (Windows: Run key / Scheduled Task — **not** a Service · macOS LaunchAgent ·
      Linux systemd `--user`).
- [ ] Publish each under the **fixed** asset filename (rename versioned bundler
      output, e.g. Tauri's `Autonomi_x.y.z_x64_en-US.msi`).
- [ ] Each **starts antd once at end of install** (best-effort on Linux).
- [ ] Daemon listens on `127.0.0.1:8082`.
- [ ] Publish as GitHub Release assets on `WithAutonomi/ant-sdk` @ `v0.9.2` with
      the **exact** filenames in §1a.
- [ ] Resolve the **architecture** decision (§6).
- [ ] Confirm the final filenames/paths back into
      [`src/shared/constants.ts`](src/shared/constants.ts)
      (`ANTD_INSTALLER_ASSETS`, `ANTD_RUN_GUIDE[].installPath`).
