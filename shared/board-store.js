import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { assertValidBoard, assertFileSize, normalizeBoardId, MAX_BOARD_FILE_BYTES } from "./board-data.js";
import { atomicWriteJson, enqueueWrite, readFileLimited, readJsonWithBackup } from "./persistence.js";
import { repairLegacyBoard } from "./board-migration.js";
import { loadDesktopBoardArchive } from "./desktop-board-archive.js";
import { mapInBatches } from "./batch.js";

export const boardFile = (directory, id) => path.join(directory, `${normalizeBoardId(id)}.json`);
const validateStoredBoard = value => assertValidBoard(repairLegacyBoard(value));

const snapshotBoard = board => {
  assertValidBoard(board);
  const payload = JSON.stringify(board);
  assertFileSize(Buffer.byteLength(payload, "utf8"), MAX_BOARD_FILE_BYTES, "Saved board");
  return JSON.parse(payload);
};

const assertCurrentRevision = async (file, snapshot, baseRevision) => {
  if (baseRevision !== undefined && baseRevision !== null && (!Number.isSafeInteger(baseRevision) || baseRevision < 0))
    throw new Error('Board base revision is invalid.');
  const previous = await readJsonWithBackup(file, null, { validate: validateStoredBoard });
  const sameSnapshot = previous && JSON.stringify(previous) === JSON.stringify(snapshot);
  const conflict = baseRevision !== undefined && (previous ? previous.updatedAt ?? 0 : null) !== baseRevision;
  if (!sameSnapshot && (conflict || (previous && (previous.updatedAt ?? 0) >= (snapshot.updatedAt ?? 0)))) {
    const error = new Error("A newer version of this board is already saved. Reload before replacing it.");
    error.code = "STALE_BOARD_REVISION";
    throw error;
  }
};

// One store queue makes a batch's revision preflight indivisible with respect
// to other saves/deletes. Files still use atomic replacement and backups.
export function saveStoredBoard(directory, board, options = {}) {
  const snapshot = snapshotBoard(board);
  const file = boardFile(directory, snapshot.id);
  return enqueueWrite(path.resolve(directory), async () => {
    await assertCurrentRevision(file, snapshot, options.baseRevision);
    await atomicWriteJson(file, snapshot, { validate: validateStoredBoard });
    return true;
  });
}

export async function saveStoredBoards(directory, boards) {
  if (!Array.isArray(boards)) throw new Error("Boards must be an array.");
  const snapshots = boards.map(snapshotBoard);
  const ids = new Set();
  for (const board of snapshots) {
    if (ids.has(board.id)) throw new Error("Imported board ids must be unique.");
    ids.add(board.id);
  }
  await enqueueWrite(path.resolve(directory), async () => {
    for (const board of snapshots) await assertCurrentRevision(boardFile(directory, board.id), board);
    for (const board of snapshots) await atomicWriteJson(boardFile(directory, board.id), board, { validate: validateStoredBoard });
  });
}

export function deleteStoredBoard(directory, id, options = {}) {
  const file = boardFile(directory, id);
  return enqueueWrite(path.resolve(directory), async () => {
    const baseRevision = options.baseRevision;
    if (baseRevision !== undefined) {
      if (baseRevision !== null && (!Number.isSafeInteger(baseRevision) || baseRevision < 0)) throw new Error('Board base revision is invalid.');
      const previous = await readJsonWithBackup(file, null, { validate: validateStoredBoard });
      if (previous && (previous.updatedAt ?? 0) !== baseRevision) {
        const error = new Error('The board changed before deletion. Reload before deleting it.');
        error.code = 'STALE_BOARD_REVISION';
        throw error;
      }
    }
    for (const name of [`${file}.bak`, file]) {
      await fs.unlink(name).catch(error => { if (error.code !== "ENOENT") throw error; });
    }
    return true;
  });
}

export async function loadStoredBoards(directory, onWarning = console.warn) {
  await fs.mkdir(directory, { recursive: true });
  const files = await fs.readdir(directory);
  const primaryNames = [...new Set(files.filter(file => /\.json(?:\.bak)?$/.test(file))
    .map(file => file.replace(/\.bak$/, "")))];
  const primary = await mapInBatches(primaryNames, 8, async name => {
    try {
      const page = repairLegacyBoard(await readJsonWithBackup(path.join(directory, name), undefined,
        { validate: validateStoredBoard }));
      return assertValidBoard(page);
    } catch (error) {
      onWarning(`Skipping unreadable board file: ${name}`, error);
      return null;
    }
  });
  const byId = new Map();
  for (const page of primary.filter(Boolean)) {
    if (!byId.has(page.id) || (page.updatedAt ?? 0) > (byId.get(page.id).updatedAt ?? 0)) byId.set(page.id, page);
  }
  // Normalize legacy ZIP-backed storage once. Preserve the archive as recovery
  // material, but don't keep loading an unmanaged second copy of the board.
  for (const name of files.filter(file => file.endsWith(".zip"))) {
    const file = path.join(directory, name);
    try {
      const bytes = await readFileLimited(file, MAX_BOARD_FILE_BYTES, "Board archive");
      const page = assertValidBoard(repairLegacyBoard(await loadDesktopBoardArchive(bytes,
        { fallbackId: path.basename(name, ".zip") })));
      const existing = byId.get(page.id);
      if (!existing || (page.updatedAt ?? 0) > (existing.updatedAt ?? 0)) {
        await saveStoredBoard(directory, page);
        byId.set(page.id, page);
      }
      await fs.rename(file, `${file}.imported-${randomUUID()}`);
    } catch (error) {
      onWarning(`Could not import stored archive: ${name}`, error);
    }
  }
  return [...byId.values()].sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
}
