# ant-webex-host — Native Messaging Host

A small native binary that bridges the browser extension with local filesystem operations it can't do on its own:

1. **Read `daemon.port`** — discovers which port antd is listening on (same file all Autonomi SDKs use)
2. **Find antd binary** — checks PATH and common install locations

## Build

```bash
cd native-host
cargo build --release
```

The binary is at `target/release/ant-webex-host` (or `.exe` on Windows).

## Register with Chrome

Chrome requires a JSON manifest pointing to the binary, registered via a platform-specific mechanism.

### Windows

1. Place the built `ant-webex-host.exe` somewhere permanent (e.g. `%LOCALAPPDATA%\AntWebex\ant-webex-host.exe`)
2. Create `com.autonomi.webex.json`:

```json
{
  "name": "com.autonomi.webex",
  "description": "Autonomi Web Extension native host",
  "path": "C:\\Users\\YOU\\AppData\\Local\\AntWebex\\ant-webex-host.exe",
  "type": "stdio",
  "allowed_origins": ["chrome-extension://YOUR_EXTENSION_ID/"]
}
```

3. Add a registry key:
```
HKCU\Software\Google\Chrome\NativeMessagingHosts\com.autonomi.webex
  (Default) = C:\Users\YOU\AppData\Local\AntWebex\com.autonomi.webex.json
```

Or run the provided PowerShell script:
```powershell
.\scripts\register-native-host.ps1 -ExtensionId "YOUR_EXTENSION_ID"
```

### macOS / Linux

Place `com.autonomi.webex.json` in:
- **Chrome**: `~/.config/google-chrome/NativeMessagingHosts/` (Linux) or `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` (macOS)
- **Firefox**: `~/.mozilla/native-messaging-hosts/` (Linux) or `~/Library/Application Support/Mozilla/NativeMessagingHosts/` (macOS)

## Protocol

Communication uses Chrome's native messaging protocol (4-byte little-endian length prefix + JSON body).

**Request:**
```json
{ "action": "detect" }
```

**Response:**
```json
{
  "port": 8082,
  "binary_found": true,
  "binary_path": "/home/user/.cargo/bin/antd"
}
```
