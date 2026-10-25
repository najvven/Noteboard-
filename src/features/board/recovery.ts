import type { Page } from "../../types";
import { assertValidBoard, normalizeBoardId } from "../../../shared/board-data.js";
import { cloneBoardDocument } from "./clone-board-document";

const RECOVERY_PREFIX = "noteboard:page-recovery:";
const LEGACY_OWNER_ID = "legacy";

export interface BoardRecoveryEnvelope {
  savedAt: number;
  baseRevision?: number | null;
  predecessor?: Page;
  ownerId: string;
  page: Page;
}

export interface BoardRecoveryEntry extends BoardRecoveryEnvelope {
  /** Exact localStorage key and serialized envelope observed during loading. */
  storageKey: string;
  rawValue: string;
  legacy: boolean;
}

export type BoardRecoveryClassification = "acknowledged" | "restore" | "conflict";

const randomOwnerId = () => {
  const cryptoApi = globalThis.crypto;
  if (typeof cryptoApi?.randomUUID === "function") return cryptoApi.randomUUID().replaceAll("-", "");
  // Never use sessionStorage: duplicated tabs copy it and would share an owner.
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;
};

const DEFAULT_OWNER_ID = randomOwnerId();

export const getBoardRecoveryOwnerId = () => DEFAULT_OWNER_ID;

const recoveryKey = (pageId: string, ownerId: string) =>
  `${RECOVERY_PREFIX}${pageId}:${ownerId}`;
const legacyRecoveryKey = (pageId: string) => `${RECOVERY_PREFIX}${pageId}`;

const isRecoveryEnvelope = (value: unknown): value is BoardRecoveryEnvelope => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const candidate = value as Partial<BoardRecoveryEnvelope>;
  if (candidate.baseRevision !== undefined && candidate.baseRevision !== null &&
      (!Number.isSafeInteger(candidate.baseRevision) || candidate.baseRevision < 0)) return false;
  if (candidate.ownerId !== undefined &&
      (typeof candidate.ownerId !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(candidate.ownerId))) return false;
  try { assertValidBoard(candidate.page); } catch { return false; }
  if (candidate.predecessor) {
    try { assertValidBoard(candidate.predecessor); } catch { return false; }
    if (candidate.predecessor.id !== candidate.page?.id ||
        (candidate.predecessor.updatedAt ?? 0) >= (candidate.page.updatedAt ?? 0)) return false;
  }
  return Number.isFinite(candidate.savedAt) && !!candidate.page &&
    typeof candidate.page.id === "string" && Array.isArray(candidate.page.elements);
};

export const storeBoardRecovery = (
  storage: Storage,
  page: Page,
  baseRevision?: number | null,
  predecessor?: Page,
  ownerId = DEFAULT_OWNER_ID,
) => {
  try {
    normalizeBoardId(page.id);
    if (!/^[a-zA-Z0-9_-]{1,200}$/.test(ownerId)) return false;
    storage.setItem(
      recoveryKey(page.id, ownerId),
      JSON.stringify({
        savedAt: Date.now(),
        baseRevision,
        ownerId,
        page,
        ...(predecessor && predecessor.id === page.id &&
          (predecessor.updatedAt ?? 0) < (page.updatedAt ?? 0) ? { predecessor } : {}),
      } satisfies BoardRecoveryEnvelope),
    );
    return true;
  } catch {
    return false;
  }
};

export const loadBoardRecoveries = (storage: Storage): BoardRecoveryEntry[] => {
  const recoveries: BoardRecoveryEntry[] = [];
  const keys = Array.from({ length: storage.length }, (_, index) => storage.key(index));
  for (const storageKey of keys) {
    if (!storageKey?.startsWith(RECOVERY_PREFIX)) continue;
    const rawValue = storage.getItem(storageKey);
    if (rawValue === null) continue;
    try {
      const parsed: unknown = JSON.parse(rawValue);
      if (isRecoveryEnvelope(parsed)) {
        const legacy = parsed.ownerId === undefined && storageKey === legacyRecoveryKey(parsed.page.id);
        if ((!legacy && parsed.ownerId === undefined) ||
            (!legacy && storageKey !== recoveryKey(parsed.page.id, parsed.ownerId!))) {
          storage.removeItem(storageKey);
          continue;
        }
        recoveries.push({
          ...parsed,
          ownerId: parsed.ownerId ?? LEGACY_OWNER_ID,
          storageKey,
          rawValue,
          legacy,
        });
      } else {
        storage.removeItem(storageKey);
      }
    } catch {
      storage.removeItem(storageKey);
    }
  }
  return recoveries;
};

/** Clear only the calling document's recovery entry, retaining the legacy revision guard. */
export const clearBoardRecovery = (
  storage: Storage,
  pageId: string,
  savedRevision = Number.POSITIVE_INFINITY,
) => {
  const key = recoveryKey(pageId, DEFAULT_OWNER_ID);
  try {
    const rawValue = storage.getItem(key);
    if (rawValue === null) return;
    let parsed: unknown;
    try { parsed = JSON.parse(rawValue); }
    catch { storage.removeItem(key); return; }
    if (!isRecoveryEnvelope(parsed) || (parsed.page.updatedAt ?? 0) <= savedRevision) {
      storage.removeItem(key);
    }
  } catch {
    // Recovery cleanup is best effort; a denied localStorage operation must
    // not turn a successfully acknowledged disk save into a failed save.
  }
};

/** Remove only the exact recovery value loaded earlier; never erase a replacement. */
export const clearRecoveryEntry = (storage: Storage, entry: BoardRecoveryEntry) => {
  try {
    if (storage.getItem(entry.storageKey) !== entry.rawValue) return false;
    storage.removeItem(entry.storageKey);
    return true;
  } catch {
    return false;
  }
};

export const stableValue = (value: unknown): string => {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.map(stableValue).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableValue(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
};

const samePayloadIgnoringRevision = (left: Page, right: Page) => {
  const { updatedAt: _leftRevision, ...leftPayload } = left;
  const { updatedAt: _rightRevision, ...rightPayload } = right;
  return stableValue(leftPayload) === stableValue(rightPayload);
};

const sameExactPage = (left: Page, right: Page) => stableValue(left) === stableValue(right);

export const classifyBoardRecovery = (
  storedPage: Page | undefined,
  recovery: BoardRecoveryEntry | BoardRecoveryEnvelope,
): BoardRecoveryClassification => {
  if (storedPage && samePayloadIgnoringRevision(storedPage, recovery.page)) return "acknowledged";
  if (!storedPage) return recovery.baseRevision === null ? "restore" : "conflict";
  if (recovery.baseRevision !== undefined && recovery.baseRevision !== null &&
      (storedPage.updatedAt ?? 0) === recovery.baseRevision) return "restore";
  if (recovery.predecessor && sameExactPage(storedPage, recovery.predecessor)) return "restore";
  return "conflict";
};

const sha256 = async (value: string) => {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
};

export const createRecoveredBoard = async (recovery: BoardRecoveryEntry): Promise<Page> => {
  const rawPage = JSON.stringify(recovery.page);
  const [snapshotHash, recoveryIdHash] = await Promise.all([
    sha256(rawPage),
    sha256(`${recovery.storageKey}\n${rawPage}`),
  ]);
  let nextId = 0;
  const createId = () => `recovery-${recoveryIdHash.slice(0, 16)}-${(nextId++).toString(36)}`;
  const cloned = cloneBoardDocument(
    recovery.page.elements,
    recovery.page.sectionSheets ?? [],
    createId,
  );
  return {
    ...recovery.page,
    id: `recovered-${recoveryIdHash}`,
    title: `Recovered — ${recovery.page.title}`.slice(0, 500),
    elements: cloned.elements,
    sectionSheets: cloned.sheets,
    updatedAt: recovery.page.updatedAt ?? 0,
    isPinned: false,
    recoveryOrigin: { boardId: recovery.page.id, snapshotHash },
  };
};
