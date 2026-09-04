import type { Page } from "../../types";

const RECOVERY_PREFIX = "noteboard:page-recovery:";

interface BoardRecoveryEnvelope {
  savedAt: number;
  page: Page;
}

const recoveryKey = (pageId: string) => `${RECOVERY_PREFIX}${pageId}`;

const isRecoveryEnvelope = (value: unknown): value is BoardRecoveryEnvelope => {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<BoardRecoveryEnvelope>;
  return (
    Number.isFinite(candidate.savedAt) &&
    !!candidate.page &&
    typeof candidate.page.id === "string" &&
    Array.isArray(candidate.page.elements)
  );
};

export const storeBoardRecovery = (storage: Storage, page: Page) => {
  try {
    storage.setItem(
      recoveryKey(page.id),
      JSON.stringify({ savedAt: Date.now(), page } satisfies BoardRecoveryEnvelope),
    );
    return true;
  } catch {
    return false;
  }
};

export const loadBoardRecoveries = (storage: Storage) => {
  const recoveries: BoardRecoveryEnvelope[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (!key?.startsWith(RECOVERY_PREFIX)) continue;
    try {
      const parsed: unknown = JSON.parse(storage.getItem(key) ?? "null");
      if (isRecoveryEnvelope(parsed)) recoveries.push(parsed);
      else storage.removeItem(key);
    } catch {
      storage.removeItem(key);
    }
  }
  return recoveries;
};

export const clearBoardRecovery = (
  storage: Storage,
  pageId: string,
  savedRevision = Number.POSITIVE_INFINITY,
) => {
  const key = recoveryKey(pageId);
  try {
    const parsed: unknown = JSON.parse(storage.getItem(key) ?? "null");
    if (
      !isRecoveryEnvelope(parsed) ||
      (parsed.page.updatedAt ?? 0) <= savedRevision
    ) {
      storage.removeItem(key);
    }
  } catch {
    storage.removeItem(key);
  }
};

export const mergeBoardRecoveries = (
  storedPages: readonly Page[],
  recoveries: readonly BoardRecoveryEnvelope[],
) => {
  const pagesById = new Map(storedPages.map((page) => [page.id, page]));
  const recoveredPages: Page[] = [];
  const staleRecoveryIds: string[] = [];
  recoveries.forEach(({ page }) => {
    const stored = pagesById.get(page.id);
    if (stored && (stored.updatedAt ?? 0) > (page.updatedAt ?? 0)) {
      staleRecoveryIds.push(page.id);
      return;
    }
    pagesById.set(page.id, page);
    recoveredPages.push(page);
  });
  return {
    pages: [...pagesById.values()].sort(
      (left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0),
    ),
    recoveredPages,
    staleRecoveryIds,
  };
};
