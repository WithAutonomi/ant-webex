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
        // 5xx — create an error with status and retry
        const err: any = new Error(`${r.status} ${r.statusText}`);
        err.status = r.status;
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

  /**
   * GET /v1/data/public/:addr
   *
   * Downloads public data stored at `address`. The daemon handles chunk
   * retrieval, self-encryption reassembly, and returns the raw bytes.
   */
  async getPublicData(address: string): Promise<ArrayBuffer> {
    const r = await this.fetchRetry(`${this.baseUrl}/v1/data/public/${address}`);
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error(
        `GET /v1/data/public/${address}: ${r.status} ${r.statusText}${body ? ` — ${body}` : ''}`,
      );
    }
    return await r.arrayBuffer();
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
      if (json.data) {
        const binary = atob(json.data);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
          bytes[i] = binary.charCodeAt(i);
        }
        return bytes.buffer;
      }
    } catch { /* not JSON — treat as raw bytes */ }

    const encoder = new TextEncoder();
    return encoder.encode(text).buffer;
  }

  /**
   * Fetch data by address, trying endpoints in order:
   *   1. GET /v1/chunks/:addr       (raw chunks — simpler, no DataMap overhead)
   *   2. GET /v1/data/public/:addr  (self-encrypted data via DataMap)
   *
   * These are different storage formats. Chunks stores raw bytes directly;
   * public data uses self-encryption (DataMap → encrypted chunks). The
   * address alone doesn't indicate which format was used, so we try both.
   * Chunks first avoids a wasted 500 when the address is a raw chunk.
   */
  async getData(address: string): Promise<ArrayBuffer> {
    try {
      return await this.getChunk(address);
    } catch {
      return await this.getPublicData(address);
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
