import type { DaemonStatus, ExtensionSettings, FetchResult } from './types';

// ── Requests (content/popup → service worker) ───────────────────────

export interface GetDaemonStatusReq {
  type: 'GET_DAEMON_STATUS';
}

export interface GetSettingsReq {
  type: 'GET_SETTINGS';
}

export interface SaveSettingsReq {
  type: 'SAVE_SETTINGS';
  settings: ExtensionSettings;
}

export interface FetchResourceReq {
  type: 'FETCH_RESOURCE';
  address: string;
  mimeType?: string;
}

export interface DownloadFileReq {
  type: 'DOWNLOAD_FILE';
  address: string;
  filename?: string;
}

export interface DetectDaemonReq {
  type: 'DETECT_DAEMON';
}

export interface UpdateBadgeReq {
  type: 'UPDATE_BADGE';
  count: number;
}

export type Request =
  | GetDaemonStatusReq
  | GetSettingsReq
  | SaveSettingsReq
  | FetchResourceReq
  | DownloadFileReq
  | DetectDaemonReq
  | UpdateBadgeReq;

// ── Responses (service worker → content/popup) ──────────────────────

export interface DaemonStatusResp {
  type: 'DAEMON_STATUS';
  status: DaemonStatus;
}

export interface SettingsResp {
  type: 'SETTINGS';
  settings: ExtensionSettings;
}

export interface ResourceResp {
  type: 'RESOURCE_RESULT';
  address: string;
  result: FetchResult;
}

export interface DownloadResp {
  type: 'DOWNLOAD_RESULT';
  address: string;
  ok: boolean;
  error?: string;
}

export interface DetectDaemonResp {
  type: 'DETECT_DAEMON_RESULT';
  /** Port read from daemon.port file, or null if unavailable. */
  discoveredPort: number | null;
  /** Whether the antd binary was found on disk. */
  binaryFound: boolean;
}

export type Response =
  | DaemonStatusResp
  | SettingsResp
  | ResourceResp
  | DownloadResp
  | DetectDaemonResp;
