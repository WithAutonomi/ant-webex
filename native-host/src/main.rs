//! Chrome Native Messaging host for the Autonomi web extension.
//!
//! This tiny binary is registered with the browser and communicates over
//! stdin/stdout using Chrome's native messaging protocol (4-byte length
//! prefix + JSON).
//!
//! It provides two capabilities that the extension's service worker cannot
//! do on its own:
//!
//!   1. **Read daemon.port** — antd writes its REST port to a well-known
//!      file on startup. This is the same auto-discovery mechanism used by
//!      antd-js, antd-py, and all other Autonomi SDKs.
//!
//!   2. **Check for antd binary** — looks on PATH and in common install
//!      locations to report whether antd is installed.

use serde::{Deserialize, Serialize};
use std::io::{self, Read, Write};
use std::path::PathBuf;

// ── Native messaging protocol ───────────────────────────────────────

fn read_message() -> io::Result<Vec<u8>> {
    let mut len_buf = [0u8; 4];
    io::stdin().read_exact(&mut len_buf)?;
    let len = u32::from_ne_bytes(len_buf) as usize;
    let mut buf = vec![0u8; len];
    io::stdin().read_exact(&mut buf)?;
    Ok(buf)
}

fn write_message(msg: &[u8]) -> io::Result<()> {
    let len = (msg.len() as u32).to_ne_bytes();
    let stdout = io::stdout();
    let mut out = stdout.lock();
    out.write_all(&len)?;
    out.write_all(msg)?;
    out.flush()
}

// ── Messages ────────────────────────────────────────────────────────

#[derive(Deserialize)]
struct Request {
    action: String,
}

#[derive(Serialize)]
struct DetectResponse {
    /// REST API port from daemon.port file, or null if unreadable.
    port: Option<u16>,
    /// Whether the antd binary was found on the system.
    binary_found: bool,
    /// Path to the antd binary (if found).
    binary_path: Option<String>,
}

// ── Daemon detection ────────────────────────────────────────────────

/// Platform-specific path to the daemon.port file.
fn daemon_port_path() -> Option<PathBuf> {
    // antd writes to <data_dir>/ant/daemon.port
    // data_dir:
    //   Windows: %APPDATA%     (C:\Users\X\AppData\Roaming)
    //   Linux:   ~/.local/share
    //   macOS:   ~/Library/Application Support
    let base = dirs::data_dir()?;
    Some(base.join("ant").join("daemon.port"))
}

/// Read the port number from the daemon.port file.
fn read_daemon_port() -> Option<u16> {
    let path = daemon_port_path()?;
    let contents = std::fs::read_to_string(path).ok()?;
    // File may contain "rest_port=8082\ngrpc_port=50051" or just "8082".
    for line in contents.lines() {
        let value = if let Some(rest) = line.strip_prefix("rest_port=") {
            rest.trim()
        } else if !line.contains('=') {
            line.trim()
        } else {
            continue;
        };
        if let Ok(port) = value.parse::<u16>() {
            return Some(port);
        }
    }
    None
}

/// Check if the antd binary exists on PATH or in common locations.
fn find_antd_binary() -> Option<PathBuf> {
    // Check PATH first.
    if let Ok(path) = which::which("antd") {
        return Some(path);
    }

    // Check common install locations.
    let candidates: Vec<PathBuf> = vec![
        // Cargo install default
        dirs::home_dir()
            .map(|h| h.join(".cargo").join("bin").join(antd_bin_name()))
            .unwrap_or_default(),
        // Global /usr/local/bin (Unix)
        PathBuf::from("/usr/local/bin").join(antd_bin_name()),
    ];

    candidates.into_iter().find(|p| p.exists())
}

fn antd_bin_name() -> &'static str {
    if cfg!(target_os = "windows") {
        "antd.exe"
    } else {
        "antd"
    }
}

// ── Main ────────────────────────────────────────────────────────────

fn main() {
    let msg = match read_message() {
        Ok(m) => m,
        Err(_) => return, // stdin closed — browser shut us down
    };

    let req: Request = match serde_json::from_slice(&msg) {
        Ok(r) => r,
        Err(_) => return,
    };

    let response = match req.action.as_str() {
        "detect" => {
            let port = read_daemon_port();
            let binary = find_antd_binary();
            let resp = DetectResponse {
                port,
                binary_found: binary.is_some(),
                binary_path: binary.map(|p| p.to_string_lossy().into_owned()),
            };
            serde_json::to_vec(&resp).unwrap()
        }
        _ => {
            serde_json::to_vec(&serde_json::json!({"error": "unknown action"})).unwrap()
        }
    };

    let _ = write_message(&response);
}
