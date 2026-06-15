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
