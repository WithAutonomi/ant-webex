// Minimal Chrome Extension API type declarations (MV3 subset used by this project).
// Avoids pulling in a full @anthropic/chrome-types dependency.

declare namespace chrome {
  namespace runtime {
    const id: string | undefined;
    function sendMessage<T = any>(message: any): Promise<T>;
    function sendMessage<T = any>(
      extensionId: string,
      message: any,
    ): Promise<T>;
    const onMessage: {
      addListener(
        callback: (
          message: any,
          sender: MessageSender,
          sendResponse: (response?: any) => void,
        ) => boolean | void | Promise<any>,
      ): void;
    };
    const onInstalled: {
      addListener(callback: (details: { reason: string }) => void): void;
    };
    function connectNative(hostName: string): Port;
    function getURL(path: string): string;

    interface MessageSender {
      tab?: chrome.tabs.Tab;
      frameId?: number;
      id?: string;
      url?: string;
    }
    interface Port {
      name: string;
      onMessage: { addListener(cb: (msg: any) => void): void };
      onDisconnect: {
        addListener(cb: (port: Port) => void): void;
      };
      postMessage(msg: any): void;
      disconnect(): void;
    }
  }

  namespace storage {
    const local: StorageArea;
    interface StorageArea {
      get(keys: string | string[]): Promise<Record<string, any>>;
      set(items: Record<string, any>): Promise<void>;
    }
  }

  namespace downloads {
    interface DownloadItem {
      id: number;
      url: string;
      filename: string;
      state: 'in_progress' | 'complete' | 'interrupted';
      bytesReceived: number;
      totalBytes: number;
      error?: string;
      exists: boolean;
      byExtensionId?: string;
      startTime: string;
    }
    function download(options: {
      url: string;
      filename?: string;
      saveAs?: boolean;
    }): Promise<number>;
    function search(query: {
      limit?: number;
      orderBy?: string[];
      state?: string;
      id?: number;
    }): Promise<DownloadItem[]>;
    /** Open the downloaded file's containing folder in the OS file manager. */
    function show(downloadId: number): void;
    function erase(query: { id?: number }): Promise<number[]>;
    interface DownloadDelta {
      id: number;
      state?: { current: string; previous?: string };
    }
    const onChanged: {
      addListener(callback: (delta: DownloadDelta) => void): void;
      removeListener(callback: (delta: DownloadDelta) => void): void;
    };
  }

  namespace alarms {
    function create(name: string, info: { periodInMinutes: number }): void;
    function clear(name: string): Promise<boolean>;
    const onAlarm: {
      addListener(callback: (alarm: { name: string }) => void): void;
    };
  }

  namespace action {
    function setBadgeText(details: { text: string; tabId?: number }): Promise<void>;
    function setBadgeBackgroundColor(details: {
      color: string;
      tabId?: number;
    }): Promise<void>;
  }

  namespace tabs {
    interface Tab {
      id?: number;
      url?: string;
    }
    function query(queryInfo: {
      active?: boolean;
      currentWindow?: boolean;
    }): Promise<Tab[]>;
    function sendMessage(tabId: number, message: any): Promise<any>;
    function create(createProperties: {
      url?: string;
      active?: boolean;
    }): Promise<Tab>;
  }
}
