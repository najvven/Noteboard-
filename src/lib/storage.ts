import { Page, Preset } from "../types";
import { assertFileSize, assertValidBoard, MAX_BOARD_FILE_BYTES } from "../../shared/board-data.js";
import { enqueueBoardOperation } from "./board-operations";
import { BoardConflictError, BoardValidationError, type BoardConflictCode, type BoardValidationCode } from './storage-errors';
import {
  clearBoardRecovery,
  clearRecoveryEntry,
  classifyBoardRecovery,
  createRecoveredBoard,
  loadBoardRecoveries,
  storeBoardRecovery,
} from "../features/board/recovery";

type WebSessionPayload = {
  partition: string;
  settings: Record<string, unknown>;
};

export interface SavePageOptions {
  keepalive?: boolean;
  baseRevision?: number | null;
  recoveryPredecessor?: Page;
}

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
  onCloseRequested?: (callback: (requestId: string) => void) => () => void;
  respondToClose?: (requestId: string, saved: boolean) => void;
  readClipboard: () => Promise<{
    text: string;
    html: string;
    image: string;
    files: { name: string; type: string; base64: string }[];
    fileErrors?: { name: string; code: string; message: string }[];
  }>;
  writeBoardClipboard: (json:string) => Promise<boolean>;
  loadPages: () => Promise<Page[]>;
  savePage: (page: Page, options?: { baseRevision?: number | null }) => Promise<BoardWriteResult>;
  deletePage: (pageId: string, options?: { baseRevision?: number | null }) => Promise<BoardWriteResult>;
  loadPresets: () => Promise<Preset[]>;
  updatePreset: (operation: PresetOperation) => Promise<Preset[]>;
  loadSettings: () => Promise<{ brightness: number }>;
  saveSettings: (settings: { brightness: number }) => Promise<boolean>;
  openBoardsFolder: () => Promise<string>;
  configureWebSession: (payload: WebSessionPayload) => Promise<boolean>;
  configureWebViewport: (payload: { guestId: number; deviceMode: string; width: number; height: number; fullscreenMode?: 'area' | 'real' }) => Promise<boolean>;
  getWebHostZoom: () => number;
  enterWebFullscreen: (guestId: number) => Promise<boolean>;
  sampleBoardColor: (point:{x:number;y:number})=>Promise<string>;
  captureBoardRegion?: (rect:{x:number;y:number;width:number;height:number})=>Promise<{
    dataUrl:string;
    rect:{x:number;y:number;width:number;height:number};
  }>;
  setBoardZoomState: (state: {shortcut:string;active:boolean}) => Promise<boolean>;
  onWebWheel: (callback: (event:{guestId:number;guestX:number;guestY:number;deltaY:number})=>void) => () => void;
  getWebBlockingStatus?: (partition: string) => Promise<WebBlockingStatus | null>;
  clearWebSession: (partition: string) => Promise<boolean>;
  onBoardsChanged: (callback: () => void) => () => void;
}

export type PresetOperation =
  | { type: 'add'; preset: Preset }
  | { type: 'delete'; id: string }
  | { type: 'rename'; id: string; name: string };

type BoardWriteResult = boolean | { ok: false; code: BoardConflictCode | BoardValidationCode; message: string };
const assertAcknowledged = (result: BoardWriteResult, action: string) => {
  if (typeof result === 'object' && result) {
    if (result.code === 'STALE_BOARD_REVISION' || result.code === 'BOARD_ID_PATH_COLLISION') throw new BoardConflictError(result.message, result.code);
    if (result.code === 'INVALID_BOARD_DATA' || result.code === 'BOARD_PRECONDITION_REQUIRED') throw new BoardValidationError(result.message, result.code);
  }
  if (result !== true) throw new Error(`The desktop did not acknowledge ${action}.`);
};

declare global {
  interface Window {
    noteboardAPI?: NoteboardDesktopApi;
  }
}

const desktopApi = () => window.noteboardAPI ?? null;
const baseRevisionHeaders = (baseRevision?: number | null): Record<string, string> =>
  baseRevision === undefined ? {} : baseRevision === null
    ? { 'If-None-Match': '*' } : { 'If-Match': `"${baseRevision}"` };

async function request(url: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    let failure: {code?: string; message?: string} = {};
    try { failure = JSON.parse(body); } catch { /* Older local servers can return a plain error. */ }
    if (response.status === 409) throw new BoardConflictError(failure.message || body || 'A newer board version is already saved.',
      failure.code === 'BOARD_ID_PATH_COLLISION' ? failure.code : 'STALE_BOARD_REVISION');
    if (failure.code === 'INVALID_BOARD_DATA' || failure.code === 'BOARD_PRECONDITION_REQUIRED') throw new BoardValidationError(failure.message || body, failure.code);
    throw new Error(body || `Request failed with status ${response.status}.`);
  }
  return response;
}

export async function loadPages(options: { onRecoveryError?: (reason: unknown) => void } = {}): Promise<Page[]> {
  const api = desktopApi();
  const readStored = async () => api
    ? await api.loadPages()
    : ((await (await request("/api/pages")).json()) as Page[]);
  let pages = new Map((await readStored()).map(page => [page.id, page]));
  const recoveryStorage = getRecoveryStorage();
  if (!recoveryStorage) return [...pages.values()];
  const recoveries = loadBoardRecoveries(recoveryStorage).sort((left, right) => right.savedAt - left.savedAt);
  for (const recovery of recoveries) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const classification = classifyBoardRecovery(pages.get(recovery.page.id), recovery);
        if (classification === 'restore') {
          await enqueueBoardOperation(recovery.page.id, async () => {
            let baseRevision = recovery.baseRevision;
            // The predecessor may have committed without its acknowledgment.
            // Retrying its exact payload is safe and gives the final draft its base.
            if (recovery.predecessor) {
              await persistPage(recovery.predecessor, { baseRevision });
              baseRevision = recovery.predecessor.updatedAt ?? 0;
            }
            await persistPage(recovery.page, { baseRevision });
          });
          pages.set(recovery.page.id, recovery.page);
        } else if (classification === 'conflict') {
          // Keep both documents visible. A deterministic origin also recognizes
          // a recovered copy that was saved, then edited, before a lost ACK retry.
          const copy = await createRecoveredBoard(recovery);
          const existing = pages.get(copy.id);
          if (existing?.recoveryOrigin?.boardId !== copy.recoveryOrigin?.boardId ||
              existing?.recoveryOrigin?.snapshotHash !== copy.recoveryOrigin?.snapshotHash) {
            await enqueueBoardOperation(copy.id, () => persistPage(copy, { baseRevision: null }));
            pages.set(copy.id, copy);
          }
        }
        clearRecoveryEntry(recoveryStorage, recovery);
        break;
      } catch (error) {
        // A concurrent writer can change the recovery decision. Reclassify once
        // against disk; I/O failures keep the exact raw draft for a later retry.
        try { pages = new Map((await readStored()).map(page => [page.id, page])); } catch { /* Retain the last acknowledged pages. */ }
        if (attempt === 0 && error instanceof BoardConflictError) continue;
        options.onRecoveryError?.(error);
        break;
      }
    }
  }
  return [...pages.values()];
}

const getRecoveryStorage = () => {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
};

/** Call only after the user explicitly discards this local draft. */
export function discardBoardRecovery(pageId: string) {
  const storage = getRecoveryStorage();
  if (storage) clearBoardRecovery(storage, pageId);
}

const persistPage = async (
  page: Page,
  options: { keepalive?: boolean; body?: string; baseRevision?: number | null } = {},
) => {
  const api = desktopApi();
  if (api) {
    assertAcknowledged(await api.savePage(page, { baseRevision: options.baseRevision }), 'the saved board');
    return;
  }
  await request(`/api/pages/${encodeURIComponent(page.id)}`, {
    method: "PUT",
    keepalive: options.keepalive,
    headers: { "Content-Type": "application/json", ...baseRevisionHeaders(options.baseRevision) },
    body: options.body ?? JSON.stringify(page),
  });
};

export async function savePage(
  page: Page,
  options: SavePageOptions = {},
): Promise<boolean> {
  let body: string;
  let bodyBytes: number;
  try {
    assertValidBoard(page);
    body = JSON.stringify(page);
    bodyBytes = new TextEncoder().encode(body).byteLength;
    assertFileSize(bodyBytes, MAX_BOARD_FILE_BYTES, "Board");
  } catch (error) { throw new BoardValidationError(error instanceof Error ? error.message : 'Invalid board data.'); }
  const snapshot = JSON.parse(body) as Page;
  const recoveryStorage = getRecoveryStorage();
  const recovered = options.keepalive && recoveryStorage
    ? storeBoardRecovery(recoveryStorage, snapshot, options.baseRevision, options.recoveryPredecessor) : false;
  // Browsers cap the aggregate keepalive body budget near 64 KiB. The local
  // recovery copy is replayed on the next load instead of issuing a request
  // the browser is guaranteed to reject.
  if (options.keepalive && !desktopApi() && bodyBytes > 60 * 1024) {
    if (!recovered) throw new Error("The last changes could not be saved for recovery. Keep the board open and export it.");
    return false;
  }
  await enqueueBoardOperation(snapshot.id, async () => {
    await persistPage(snapshot, { keepalive: options.keepalive, body, baseRevision: options.baseRevision });
    if (recoveryStorage) clearBoardRecovery(recoveryStorage, snapshot.id, snapshot.updatedAt ?? 0);
  });
  return true;
}

export function prepareBrowserUnload(page: Page, baseRevision?: number | null, predecessor?: Page) {
  if (desktopApi()) return true;
  try {
    assertValidBoard(page);
    assertFileSize(new TextEncoder().encode(JSON.stringify(page)).byteLength, MAX_BOARD_FILE_BYTES, "Board");
  } catch { return false; }
  const storage = getRecoveryStorage();
  const recovered = storage ? storeBoardRecovery(storage, page, baseRevision, predecessor) : false;
  return new TextEncoder().encode(JSON.stringify(page)).byteLength <= 60 * 1024 || recovered;
}

export async function deletePage(pageId: string, options: { baseRevision?: number | null } = {}): Promise<void> {
  await enqueueBoardOperation(pageId, async () => {
    const api = desktopApi();
    if (api) {
      assertAcknowledged(await api.deletePage(pageId, options), 'board deletion');
    } else await request(`/api/pages/${encodeURIComponent(pageId)}`, { method: "DELETE",
      headers: baseRevisionHeaders(options.baseRevision),
    });
    const recoveryStorage = getRecoveryStorage();
    if (recoveryStorage) clearBoardRecovery(recoveryStorage, pageId);
  });
}

export async function loadPresets(): Promise<Preset[]> {
  const api = desktopApi();
  if (api) return api.loadPresets();
  return (await (await request("/api/presets")).json()) as Preset[];
}

export async function updatePreset(operation: PresetOperation): Promise<Preset[]> {
  const api = desktopApi();
  if (api) return api.updatePreset(operation);
  return (await (await request('/api/presets', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(operation),
  })).json()) as Preset[];
}

export async function loadSettings(): Promise<{ brightness: number }> {
  const api = desktopApi();
  if (api) return api.loadSettings();
  return (await (await request("/api/settings")).json()) as { brightness: number };
}

export async function saveSettings(settings: { brightness: number }): Promise<void> {
  const snapshot = { ...settings };
  await enqueueBoardOperation("application:settings", async () => {
    const api = desktopApi();
    if (api) {
      if (await api.saveSettings(snapshot) === false) throw new Error("The desktop did not acknowledge the saved settings.");
      return;
    }
    await request("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(snapshot),
    });
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
