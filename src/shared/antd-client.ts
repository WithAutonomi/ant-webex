/**
 * Minimal antd REST client — GET operations only (v1 scope).
 *
 * antd is the Autonomi network daemon that exposes a local REST API.
 * This client wraps only the download-related endpoints:
 *
 *   GET  /health                → daemon liveness
 *   GET  /v1/data/public/:addr  → download public data by network address
 *   GET  /v1/chunks/:addr       → download a single raw chunk
 *   POST /v1/files/download/public → download a file (antd reassembles from self-encrypted chunks)
 */
const MAX_RETRIES = 2;
const BASE_DELAY_MS = 500;

/** Decode a base64 string (an NDJSON `data` frame chunk) into raw bytes. */
function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Returns true for errors that are worth retrying (network failures, 5xx). */
function isRetryable(err: unknown): boolean {
  if (err instanceof TypeError) return true; // fetch network error
  if (err instanceof Error && 'status' in err) {
    const status = (err as any).status;
    return status >= 500 && status < 600;
  }
  return false;
}

export class AntdClient {
  constructor(private baseUrl: string) {}

  /** Update the base URL (e.g. after discovering the real port). */
  setBaseUrl(url: string): void {
    this.baseUrl = url;
  }

  /**
   * Fetch with exponential backoff retry on transient failures.
   * Retries on network errors and 5xx responses.
   */
  private async fetchRetry(input: RequestInfo, init?: RequestInit): Promise<globalThis.Response> {
    let lastErr: unknown;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const r = await fetch(input, init);
        if (r.ok || r.status < 500) return r; // success or client error (no retry)
        // 5xx — capture the body (antd sends {"error","code"}) so callers can
        // tell *why* it failed, then retry.
        const body = await r.text().catch(() => '');
        const err: any = new Error(`${r.status} ${r.statusText}${body ? ` — ${body}` : ''}`);
        err.status = r.status;
        err.body = body;
        lastErr = err;
      } catch (e) {
        lastErr = e;
        if (!isRetryable(e)) throw e;
      }
      if (attempt < MAX_RETRIES) {
        await new Promise((resolve) => setTimeout(resolve, BASE_DELAY_MS * 2 ** attempt));
      }
    }
    throw lastErr;
  }

  /**
   * Query /health. Returns liveness plus the antd version it reports
   * (bare semver, e.g. "0.9.2"), or null version if unavailable/unparseable.
   */
  async getHealth(): Promise<{ ok: boolean; version: string | null }> {
    try {
      const r = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(3_000),
      });
      if (!r.ok) return { ok: false, version: null };
      const body: any = await r.json().catch(() => null);
      return { ok: true, version: typeof body?.version === 'string' ? body.version : null };
    } catch {
      return { ok: false, version: null };
    }
  }

  /**
   * Probe a range of localhost ports for a running antd instance.
   * Returns the first URL that responds to /health, or null.
   */
  static async probe(startPort = 8082, endPort = 8090): Promise<string | null> {
    const checks = [];
    for (let port = startPort; port <= endPort; port++) {
      const url = `http://localhost:${port}`;
      checks.push(
        fetch(`${url}/health`, { signal: AbortSignal.timeout(1_500) })
          .then((r) => (r.ok ? url : null))
          .catch(() => null),
      );
    }
    const results = await Promise.all(checks);
    return results.find((r) => r !== null) ?? null;
  }

  /** Decode a base64 string into an ArrayBuffer. */
  private static base64ToBuffer(b64: string): ArrayBuffer {
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes.buffer;
  }

  /**
   * GET /v1/data/public/:addr
   *
   * Resolves the DataMap at `address` and returns the reassembled content. The
   * daemon handles chunk retrieval and self-encryption; the response is JSON
   * `{"data":"<base64>"}` (parsed via text() so we don't depend on a
   * content-type header, which Firefox CORS may hide).
   */
  async getPublicData(address: string): Promise<ArrayBuffer> {
    const r = await this.fetchRetry(`${this.baseUrl}/v1/data/public/${address}`);
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      const err: any = new Error(
        `GET /v1/data/public/${address}: ${r.status} ${r.statusText}${body ? ` — ${body}` : ''}`,
      );
      err.status = r.status;
      throw err;
    }
    const text = await r.text();
    try {
      const json = JSON.parse(text);
      if (typeof json.data === 'string') return AntdClient.base64ToBuffer(json.data);
    } catch { /* not the expected JSON shape */ }
    throw new Error(`GET /v1/data/public/${address}: unexpected response (no data field)`);
  }

  /**
   * GET /v1/chunks/:addr
   *
   * Downloads a single raw chunk by its content-address (BLAKE3 hash).
   */
  async getChunk(address: string): Promise<ArrayBuffer> {
    const r = await this.fetchRetry(`${this.baseUrl}/v1/chunks/${address}`);
    if (!r.ok) {
      throw new Error(`GET /v1/chunks/${address}: ${r.status} ${r.statusText}`);
    }

    // antd returns chunks as {"data":"<base64>"}. Try JSON parse first —
    // don't rely on content-type header which may be inaccessible (Firefox CORS).
    const text = await r.text();
    try {
      const json = JSON.parse(text);
      if (typeof json.data === 'string') return AntdClient.base64ToBuffer(json.data);
    } catch { /* not JSON — treat as raw bytes */ }

    const encoder = new TextEncoder();
    return encoder.encode(text).buffer;
  }

  /**
   * Fetch the content stored at `address`, trying endpoints in order:
   *   1. GET /v1/data/public/:addr  (resolves the DataMap → reassembled file)
   *   2. GET /v1/chunks/:addr       (raw single chunk — fallback)
   *
   * The address alone doesn't reveal the storage format, but real autonomi://
   * content is public data (a DataMap address), so that endpoint is tried
   * first. Chunk-first would be *wrong* here: /v1/chunks/:addr on a DataMap
   * address returns 200 with the serialized DataMap (the chunk index), not the
   * file — so we'd silently download the index instead of the content.
   *
   * The fallback is gated on *why* public-data failed:
   *   - network/timeout (the address IS public data but its content can't be
   *     retrieved): surface it — falling back would download the DataMap and
   *     mask the real failure.
   *   - otherwise (e.g. the chunk isn't a DataMap): treat the address as a raw
   *     chunk and fetch it directly.
   * We match on both HTTP status and antd's error body, since the daemon may
   * map a retrieval timeout to a generic 500 rather than 502/504.
   */
  async getData(address: string): Promise<ArrayBuffer> {
    try {
      return await this.getPublicData(address);
    } catch (e: any) {
      const status = e?.status;
      const detail = `${e?.message ?? ''} ${e?.body ?? ''}`.trim();
      const unreachable =
        status === 502 ||
        status === 504 ||
        /timeout|timed out|exhausted|close group|network|insufficient|peers|not ?found/i.test(detail);
      if (unreachable) throw e;
      // Not public data (or not a DataMap) — fall back to a raw chunk fetch.
      // Normal for raw-chunk content, so log at debug level only.
      console.debug(`[ant-webex] /v1/data/public miss for ${address} (${status}); trying /v1/chunks`);
      return await this.getChunk(address);
    }
  }

  /**
   * GET /v1/data/public/:addr/stream
   *
   * Streaming download that drives a *determinate* progress bar. We request the
   * daemon's NDJSON mode (`Accept: application/x-ndjson`): it interleaves
   * per-chunk `progress` frames with base64 `data` frames, and the progress
   * frames advance *during* the network fetch — so the bar fills smoothly
   * instead of sitting at 0 then snapping to 100%.
   *
   * The raw `application/octet-stream` mode (older streaming daemons, or any
   * daemon that ignores our Accept) delivers plaintext in big lumps — often the
   * whole file in one batch at the very end — so received-bytes alone can't
   * animate. We branch on the response Content-Type and fall back to
   * byte-counting in that case, so the download still works (just not smoothly).
   *
   * Failure modes:
   *  - Pre-stream (bad address, DataMap fetch failure): arrives as a normal
   *    non-2xx response *before* the body opens, thrown with `.status`.
   *  - The endpoint is missing (daemon predates streaming): 404, thrown with
   *    `.streamUnsupported = true` so callers can fall back to getData.
   *  - Mid-stream: NDJSON signals it explicitly with an `error` frame; the raw
   *    path can't, so it ends short of Content-Length and we throw on the
   *    byte-count mismatch. Either way we never return a truncated file.
   *
   * Single attempt, no fetchRetry: a partially-consumed stream can't be safely
   * replayed, and the pre-stream errors here are content failures, not the
   * transient 5xx/network blips fetchRetry targets.
   */
  async streamData(
    address: string,
    onProgress?: (received: number, total: number | null) => void,
  ): Promise<ArrayBuffer> {
    const url = `${this.baseUrl}/v1/data/public/${address}/stream`;
    const r = await fetch(url, { headers: { Accept: 'application/x-ndjson' } });
    if (r.status === 404) {
      const err: any = new Error('streaming endpoint not available (daemon too old)');
      err.status = 404;
      err.streamUnsupported = true;
      throw err;
    }
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      const err: any = new Error(
        `GET /v1/data/public/${address}/stream: ${r.status} ${r.statusText}${body ? ` — ${body}` : ''}`,
      );
      err.status = r.status;
      err.body = body;
      throw err;
    }

    const ctype = r.headers.get('content-type') || '';
    return ctype.includes('ndjson')
      ? await this.readNdjsonStream(address, r, onProgress)
      : await this.readRawStream(address, r, onProgress);
  }

  /**
   * Parse the daemon's NDJSON stream: `meta` sets the byte total, `progress`
   * (the `fetching` phase) advances the bar by chunks-fetched, `data` carries a
   * base64 plaintext batch to reassemble, and `error` is a terminal failure.
   */
  private async readNdjsonStream(
    address: string,
    r: globalThis.Response,
    onProgress?: (received: number, total: number | null) => void,
  ): Promise<ArrayBuffer> {
    let total: number | null = null;
    const chunks: Uint8Array[] = [];
    let dataBytes = 0;

    const handle = (line: string) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let frame: any;
      try {
        frame = JSON.parse(trimmed);
      } catch {
        return; // ignore a malformed line rather than abort the download
      }
      switch (frame.type) {
        case 'meta':
          total = typeof frame.total_size === 'number' ? frame.total_size : null;
          onProgress?.(0, total);
          break;
        case 'progress':
          // The 'fetching' phase reports data chunks fetched/total. Report the
          // real fetched count (mapped onto the byte total) and let the renderer
          // own the pacing/easing between these chunk steps — it times each
          // segment by how long the chunk actually took.
          if (frame.phase === 'fetching' && frame.total > 0 && total != null) {
            const frac = Math.min(1, frame.fetched / frame.total);
            onProgress?.(Math.round(frac * total), total);
          }
          break;
        case 'data': {
          const bytes = base64ToBytes(frame.chunk);
          chunks.push(bytes);
          dataBytes += bytes.byteLength;
          break;
        }
        case 'error':
          throw new Error(frame.message || 'stream error');
      }
    };

    if (!r.body) {
      // No readable stream — buffer the whole body and parse it line by line.
      (await r.text()).split('\n').forEach(handle);
    } else {
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buffered = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffered += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buffered.indexOf('\n')) >= 0) {
          handle(buffered.slice(0, nl));
          buffered = buffered.slice(nl + 1);
        }
      }
      buffered += decoder.decode();
      if (buffered.trim()) handle(buffered);
    }

    // Land the bar on 100% — the last 'fetching' frame may stop just short.
    onProgress?.(total ?? dataBytes, total);
    console.debug(`[ant-webex] streamed ${address} (${dataBytes} bytes, ndjson)`);

    const out = new Uint8Array(dataBytes);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out.buffer;
  }

  /**
   * Raw `application/octet-stream` fallback: count received bytes against
   * Content-Length. Progress is lumpy (the daemon often flushes the whole file
   * at once), but the download still completes and short reads are caught.
   */
  private async readRawStream(
    address: string,
    r: globalThis.Response,
    onProgress?: (received: number, total: number | null) => void,
  ): Promise<ArrayBuffer> {
    const lenHeader = r.headers.get('content-length');
    const total = lenHeader ? parseInt(lenHeader, 10) : null;
    console.debug(`[ant-webex] streaming ${address} (${total ?? '?'} bytes, raw)`);

    if (!r.body) {
      const buf = await r.arrayBuffer();
      onProgress?.(buf.byteLength, total);
      return buf;
    }

    const reader = r.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.byteLength;
        onProgress?.(received, total);
      }
    }

    // Short read = the download failed partway (see failure modes above).
    if (total != null && received !== total) {
      throw new Error(`stream incomplete: received ${received} of ${total} bytes`);
    }

    const out = new Uint8Array(received);
    let offset = 0;
    for (const c of chunks) {
      out.set(c, offset);
      offset += c.byteLength;
    }
    return out.buffer;
  }

  /**
   * POST /v1/files/download/public
   *
   * Downloads a file by its public address. antd handles self-encryption
   * reassembly and returns the complete file bytes.
   */
  async downloadFile(address: string): Promise<ArrayBuffer> {
    const r = await this.fetchRetry(`${this.baseUrl}/v1/files/download/public`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ address }),
    });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error(
        `POST /v1/files/download/public: ${r.status}${body ? ` — ${body}` : ''}`,
      );
    }
    return await r.arrayBuffer();
  }
}
