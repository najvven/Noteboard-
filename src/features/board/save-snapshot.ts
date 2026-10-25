import type { Page } from "../../types";
import { isDefinitiveBoardWriteError } from '../../lib/storage-errors';

export interface StableBoardRevision {
  payloadKey: string;
  revision: number;
}

export interface PendingBoardSave {
  snapshot: Page;
  baseRevision: number | null;
}

export interface BoardSaveSequenceResult {
  accepted: boolean;
  baseRevision: number | null;
  pending: PendingBoardSave | null;
  error?: unknown;
}

/** Serialize every persisted Page field while ignoring only its revision. */
export function boardSnapshotPayloadKey(page: Page): string {
  const { updatedAt: _updatedAt, ...payload } = page;
  return JSON.stringify(payload);
}

/** Reuse a revision when the complete persisted payload has not changed. */
export function stabilizeBoardSnapshotRevision(
  page: Page,
  previous: StableBoardRevision | null,
  createRevision: () => number,
  pending?: PendingBoardSave | null,
): { snapshot: Page; stableRevision: StableBoardRevision } {
  const payloadKey = boardSnapshotPayloadKey(page);
  const pendingHasSamePayload = pending &&
    boardSnapshotPayloadKey(pending.snapshot) === payloadKey;
  const revision = pendingHasSamePayload
    ? pending.snapshot.updatedAt
    : previous?.payloadKey === payloadKey
      ? previous.revision
      : createRevision();
  return {
    snapshot: { ...page, updatedAt: revision },
    stableRevision: { payloadKey, revision },
  };
}

/** Retry an uncertain write exactly before attempting its newer replacement. */
export async function persistLatestBoardSnapshot(
  latestSnapshot: Page,
  pending: PendingBoardSave | null,
  acknowledgedBaseRevision: number | null,
  write: (save: PendingBoardSave) => Promise<void | boolean>,
  onPendingChange: (save: PendingBoardSave | null) => void,
): Promise<BoardSaveSequenceResult> {
  let baseRevision = acknowledgedBaseRevision;

  // stabilizeBoardSnapshotRevision changes the revision for every changed
  // payload. An already acknowledged revision needs no repeated disk write.
  if (!pending && latestSnapshot.updatedAt === baseRevision)
    return { accepted: true, baseRevision, pending: null };

  if (pending) {
    try {
      const result = await write(pending);
      if (result === false) {
        onPendingChange(pending);
        return { accepted: false, baseRevision, pending };
      }
    } catch (error) {
      const retry = isDefinitiveBoardWriteError(error) ? null : pending;
      onPendingChange(retry);
      return { accepted: false, baseRevision, pending: retry, error };
    }

    baseRevision = pending.snapshot.updatedAt;
    onPendingChange(null);
    if (boardSnapshotPayloadKey(pending.snapshot) === boardSnapshotPayloadKey(latestSnapshot)) {
      return { accepted: true, baseRevision, pending: null };
    }
  }

  const latestSave = { snapshot: latestSnapshot, baseRevision };
  onPendingChange(latestSave);
  try {
    const result = await write(latestSave);
    if (result === false) {
      onPendingChange(latestSave);
      return { accepted: false, baseRevision, pending: latestSave };
    }
  } catch (error) {
    const retry = isDefinitiveBoardWriteError(error) ? null : latestSave;
    onPendingChange(retry);
    return { accepted: false, baseRevision, pending: retry, error };
  }

  baseRevision = latestSnapshot.updatedAt;
  onPendingChange(null);
  return { accepted: true, baseRevision, pending: null };
}
