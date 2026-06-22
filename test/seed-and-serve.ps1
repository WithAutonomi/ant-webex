## Seed test data into a running antd, then serve a test page.
##
## Prerequisites:
##   1. Start the local devnet from ant-sdk:
##        cd ..\ant-sdk
##        .\scripts\start-local.ps1
##      Wait for "=== Ready! ==="
##
##   2. Run this script:
##        .\test\seed-and-serve.ps1
##
##   3. Load the extension in Chrome:
##        chrome://extensions → Developer mode → Load unpacked → select dist/
##
##   4. Visit http://localhost:8888 in Chrome
##
## Tear down:
##   Ctrl+C to stop the test server.
##   cd ..\ant-sdk; .\scripts\kill-local.ps1  to stop the devnet.

$ErrorActionPreference = "Stop"
$BaseUrl = if ($env:ANTD_BASE_URL) { $env:ANTD_BASE_URL } else { "http://localhost:8082" }
$TestDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ServePort = 8888

# ── Helpers ──

function B64Encode([byte[]]$bytes) {
    [Convert]::ToBase64String($bytes)
}

function StoreChunk([byte[]]$data, [string]$label) {
    $b64 = B64Encode $data
    $body = "{`"data`": `"$b64`"}"
    $bodyBytes = [System.Text.Encoding]::UTF8.GetBytes($body)
    try {
        $resp = Invoke-RestMethod -Uri "$BaseUrl/v1/chunks" -Method Post `
            -ContentType "application/json; charset=utf-8" -Body $bodyBytes
        Write-Host "  Stored $label → $($resp.address.Substring(0, 16))..." -ForegroundColor Green
        return $resp.address
    } catch {
        Write-Host "  FAILED to store $label" -ForegroundColor Red
        Write-Host "  $($_.Exception.Message)" -ForegroundColor Gray
        return $null
    }
}

# ── Check antd is running ──

Write-Host ""
Write-Host "=== ant-webex Test Setup ===" -ForegroundColor Cyan
Write-Host ""

try {
    $health = Invoke-RestMethod "$BaseUrl/health" -ErrorAction Stop
    Write-Host "antd is running ($BaseUrl, network: $($health.network))" -ForegroundColor Green
} catch {
    Write-Host "ERROR: antd is not running at $BaseUrl" -ForegroundColor Red
    Write-Host ""
    Write-Host "Start the local devnet first:" -ForegroundColor Gray
    Write-Host "  cd ..\ant-sdk" -ForegroundColor Gray
    Write-Host "  .\scripts\start-local.ps1" -ForegroundColor Gray
    exit 1
}

# ── Seed test data ──

Write-Host ""
Write-Host "Seeding test data..." -ForegroundColor Yellow

# 1. A tiny 1x1 red PNG (69 bytes). Compressed with a valid zlib stream —
# Chrome tolerates Adler-32 mismatches, Firefox does not, so any regression
# here will silently break the Firefox build.
$pngBytes = [byte[]]@(
    0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,  # PNG signature
    0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52,  # IHDR chunk
    0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,  # 1x1
    0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,  # 8-bit RGB
    0xDE, 0x00, 0x00, 0x00, 0x0C, 0x49, 0x44, 0x41,  # IDAT chunk
    0x54, 0x78, 0xDA, 0x63, 0xF8, 0xCF, 0xC0, 0x00,  # zlib-compressed red pixel
    0x00, 0x03, 0x01, 0x01, 0x00, 0xF7, 0x03, 0x41,
    0x43, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4E,  # IEND chunk
    0x44, 0xAE, 0x42, 0x60, 0x82
)
$pngAddr = StoreChunk $pngBytes "test PNG image"

# 2. Plain text
$textBytes = [System.Text.Encoding]::UTF8.GetBytes("Hello from the Autonomi network! This text was fetched via the ant-webex browser extension.")
$textAddr = StoreChunk $textBytes "test text"

# 3. A small HTML snippet
$htmlBytes = [System.Text.Encoding]::UTF8.GetBytes("<!DOCTYPE html><html><body style='font-family:sans-serif;padding:20px;background:#1e293b;color:#e2e8f0'><h2>Autonomi Embedded Content</h2><p>This HTML page was stored on the Autonomi network and rendered inline by the ant-webex extension.</p></body></html>")
$htmlAddr = StoreChunk $htmlBytes "test HTML embed"

# ── Generate test page ──

Write-Host ""
Write-Host "Generating test page..." -ForegroundColor Yellow

# Build address substitution — use "MISSING" placeholder if store failed
$imgTag = if ($pngAddr) { "autonomi://$pngAddr" } else { "autonomi://STORE_FAILED" }
$textTag = if ($textAddr) { "autonomi://$textAddr" } else { "autonomi://STORE_FAILED" }
$embedTag = if ($htmlAddr) { "autonomi://$htmlAddr" } else { "autonomi://STORE_FAILED" }
$downloadAddr = if ($textAddr) { "autonomi://$textAddr" } else { "autonomi://STORE_FAILED" }

$html = @"
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>ant-webex Test Page</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 40px auto; padding: 0 20px; background: #0f172a; color: #e2e8f0; }
    h1 { color: #60a5fa; }
    h2 { color: #94a3b8; margin-top: 40px; }
    .test-case { background: #1e293b; border: 1px solid #334155; border-radius: 8px; padding: 16px; margin: 12px 0; }
    .test-case h3 { margin: 0 0 8px; color: #60a5fa; font-size: 14px; }
    .test-case p { color: #94a3b8; font-size: 13px; margin: 4px 0; }
    code { background: #334155; padding: 2px 6px; border-radius: 3px; font-size: 12px; }
    a { color: #60a5fa; }
    img { border: 2px solid #334155; border-radius: 4px; }
    .embed-container { width: 100%; height: 200px; border: 2px solid #334155; border-radius: 4px; }
    .status { padding: 8px 12px; border-radius: 4px; margin: 20px 0; font-size: 13px; }
    .status.info { background: #1e3a5f; border: 1px solid #3b82f6; }
  </style>
</head>
<body>
  <h1>ant-webex Test Page</h1>
  <div class="status info">
    If the extension is installed and antd is running, the resources below will load automatically.
    Check the extension popup (click the icon) to see daemon status and detected resources.
  </div>

  <h2>1. Download Link</h2>
  <div class="test-case">
    <h3><code>&lt;a href="autonomi://..."&gt;</code></h3>
    <p>Clicking this should trigger a browser download via the extension:</p>
    <p><a href="$downloadAddr">Download test file from Autonomi</a></p>
  </div>

  <h2>2. Inline Image</h2>
  <div class="test-case">
    <h3><code>&lt;img data-ant-src="autonomi://..."&gt;</code></h3>
    <p>The extension should fetch this image and set the src attribute:</p>
    <img data-ant-src="$imgTag" data-ant-type="image/png"
         alt="Test image from Autonomi" width="64" height="64"
         style="image-rendering: pixelated;" />
  </div>

  <h2>3. Generic Embed</h2>
  <div class="test-case">
    <h3><code>&lt;div data-ant-embed="autonomi://..." data-ant-type="text/html"&gt;</code></h3>
    <p>The extension should fetch this HTML and render it in an iframe:</p>
    <div data-ant-embed="$embedTag" data-ant-type="text/html"
         class="embed-container">
    </div>
  </div>

  <h2>4. Source HTML</h2>
  <div class="test-case">
    <h3>What the page author wrote</h3>
    <pre style="background:#0f172a;padding:12px;border-radius:4px;font-size:11px;overflow-x:auto;color:#94a3b8;">
&lt;a href="$downloadAddr"&gt;Download&lt;/a&gt;

&lt;img data-ant-src="$imgTag"
     data-ant-type="image/png" /&gt;

&lt;div data-ant-embed="$embedTag"
     data-ant-type="text/html"&gt;&lt;/div&gt;
    </pre>
  </div>

  <h2>Addresses</h2>
  <div class="test-case">
    <p>PNG: <code>$(if ($pngAddr) { $pngAddr } else { "FAILED" })</code></p>
    <p>Text: <code>$(if ($textAddr) { $textAddr } else { "FAILED" })</code></p>
    <p>HTML: <code>$(if ($htmlAddr) { $htmlAddr } else { "FAILED" })</code></p>
  </div>
</body>
</html>
"@

$html | Set-Content "$TestDir\page.html" -Encoding UTF8
Write-Host "  Written to test\page.html" -ForegroundColor Green

# ── Serve ──

Write-Host ""
Write-Host "=== Serving test page ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "  URL:  http://localhost:$ServePort" -ForegroundColor White
Write-Host ""
Write-Host "  Steps:" -ForegroundColor Gray
Write-Host "    1. Load extension: chrome://extensions → Dev mode → Load unpacked → dist/" -ForegroundColor Gray
Write-Host "    2. Visit http://localhost:$ServePort" -ForegroundColor Gray
Write-Host "    3. Check that the popup shows 'Connected' and resources render" -ForegroundColor Gray
Write-Host ""
Write-Host "  Press Ctrl+C to stop." -ForegroundColor Gray
Write-Host ""

python -m http.server $ServePort --directory $TestDir
