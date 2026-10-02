import { Page, Preset } from "../types";
import {
  clearBoardRecovery,
  loadBoardRecoveries,
  mergeBoardRecoveries,
  storeBoardRecovery,
} from "../features/board/recovery";

type WebSessionPayload = {
  partition: string;
  settings: Record<string, unknown>;
};

export interface WebBlockingStatus {
  ads: number;
  cookies: number;
  popups: number;
  filtersUpdatedAt: string | null;
  filterRules: number;
  extensionId: string | null;
  extensionName: string | null;
  extensionReady: boolean;
  extensionEnabled: boolean;
}

interface NoteboardDesktopApi {
  readClipboard: () => Promise<{text:string;html:string;image:string;files:{name:string;type:string;base64:string}[]}>;
  writeBoardClipboard: (json:string) => Promise<boolean>;
  loadPages: () => Promise<Page[]>;
  savePage: (page: Page) => Promise<boolean>;
  deletePage: (pageId: string) => Promise<boolean>;
  loadPresets: () => Promise<Preset[]>;
  savePresets: (presets: Preset[]) => Promise<boolean>;
  loadSettings: () => Promise<{ brightness: number }>;
  saveSettings: (settings: { brightness: number }) => Promise<boolean>;
  openBoardsFolder: () => Promise<string>;
  configureWebSession: (payload: WebSessionPayload) => Promise<boolean>;
  configureWebViewport: (payload: { guestId: number; deviceMode: string; width: number; height: number }) => Promise<boolean>;
  getWebHostZoom: () => number;
  enterWebFullscreen: (guestId: number) => Promise<boolean>;
  sampleBoardColor: (point:{x:number;y:number})=>Promise<string>;
  setBoardZoomState: (state: {shortcut:string;active:boolean}) => Promise<boolean>;
  onWebWheel: (callback: (event:{guestId:number;guestX:number;guestY:number;deltaY:number})=>void) => () => void;
  getWebBlockingStatus?: (partition: string) => Promise<WebBlockingStatus | null>;
  clearWebSession: (partition: string) => Promise<boolean>;
  onBoardsChanged: (callback: () => void) => () => void;
}

declare global {
  interface Window {
    noteboardAPI?: NoteboardDesktopApi;
  }
}

const desktopApi = () => window.noteboardAPI ?? null;

async function request(url: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(body || `Request failed with status ${response.status}.`);
  }
  return response;
}

export async function loadPages(): Promise<Page[]> {
  const api = desktopApi();
  const storedPages = api
    ? await api.loadPages()
    : ((await (await request("/api/pages")).json()) as Page[]);
  const recoveryStorage = getRecoveryStorage();
  if (!recoveryStorage) return storedPages;
  const merged = mergeBoardRecoveries(
    storedPages,
    loadBoardRecoveries(recoveryStorage),
  );
  merged.staleRecoveryIds.forEach((pageId) =>
    clearBoardRecovery(recoveryStorage, pageId),
  );
  merged.recoveredPages.forEach((page) => {
    persistPage(page)
      .then(() =>
        clearBoardRecovery(recoveryStorage, page.id, page.updatedAt ?? 0),
      )
      .catch(() => undefined);
  });
  return merged.pages;
}

const getRecoveryStorage = () => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

const persistPage = async (
  page: Page,
  options: { keepalive?: boolean; body?: string } = {},
) => {
  const api = desktopApi();
  if (api) {
    await api.savePage(page);
    return;
  }
  await request(`/api/pages/${encodeURIComponent(page.id)}`, {
    method: "PUT",
    keepalive: options.keepalive,
    headers: { "Content-Type": "application/json" },
    body: options.body ?? JSON.stringify(page),
  });
};

export async function savePage(
  page: Page,
  options: { keepalive?: boolean } = {},
): Promise<void> {
  const recoveryStorage = getRecoveryStorage();
  if (options.keepalive && recoveryStorage) {
    storeBoardRecovery(recoveryStorage, page);
  }
  const body = JSON.stringify(page);
  const bodyBytes = new TextEncoder().encode(body).byteLength;
  // Browsers cap the aggregate keepalive body budget near 64 KiB. The local
  // recovery copy is replayed on the next load instead of issuing a request
  // the browser is guaranteed to reject.
  if (options.keepalive && bodyBytes > 60 * 1024) return;
  await persistPage(page, { keepalive: options.keepalive, body });
  if (recoveryStorage) {
    clearBoardRecovery(recoveryStorage, page.id, page.updatedAt ?? 0);
  }
}

export async function deletePage(pageId: string): Promise<void> {
  const recoveryStorage = getRecoveryStorage();
  if (recoveryStorage) clearBoardRecovery(recoveryStorage, pageId);
  const api = desktopApi();
  if (api) {
    await api.deletePage(pageId);
    return;
  }
  await request(`/api/pages/${encodeURIComponent(pageId)}`, { method: "DELETE" });
}

export async function loadPresets(): Promise<Preset[]> {
  const api = desktopApi();
  if (api) return api.loadPresets();
  return (await (await request("/api/presets")).json()) as Preset[];
}

export async function savePresets(presets: Preset[]): Promise<void> {
  const api = desktopApi();
  if (api) {
    await api.savePresets(presets);
    return;
  }
  await request("/api/presets", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(presets),
  });
}

export async function loadSettings(): Promise<{ brightness: number }> {
  const api = desktopApi();
  if (api) return api.loadSettings();
  return (await (await request("/api/settings")).json()) as { brightness: number };
}

export async function saveSettings(settings: { brightness: number }): Promise<void> {
  const api = desktopApi();
  if (api) {
    await api.saveSettings(settings);
    return;
  }
  await request("/api/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
}

export async function openBoardStorageFolder(): Promise<string | null> {
  const api = desktopApi();
  return api ? api.openBoardsFolder() : null;
}

export async function configureWebSession(payload: WebSessionPayload): Promise<boolean> {
  const api = desktopApi();
  return api ? api.configureWebSession(payload) : false;
}

export async function clearWebSession(partition: string): Promise<boolean> {
  const api = desktopApi();
  return api ? api.clearWebSession(partition) : false;
}

export async function getWebBlockingStatus(partition: string): Promise<WebBlockingStatus | null> {
  return desktopApi()?.getWebBlockingStatus?.(partition) ?? null;
}

export function subscribeToBoardChanges(callback: () => void): () => void {
  const api = desktopApi();
  return api ? api.onBoardsChanged(callback) : () => undefined;
}
