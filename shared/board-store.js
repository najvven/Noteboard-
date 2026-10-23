import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { assertValidBoard, assertFileSize, normalizeBoardId, MAX_BOARD_FILE_BYTES } from "./board-data.js";
import { atomicWriteJson, enqueueWrite, readFileLimited } from "./persistence.js";
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

const isBoardJsonSource = name => /\.json(?:\.bak)?$/.test(name);
const sourcePath = (directory, source) => path.join(directory, source);
const canonicalName = id => `${id}.json`;
const isCanonicalSource = (name, id) => name === canonicalName(id) || name === `${canonicalName(id)}.bak`;
const sourceRank = (name, id) => name === canonicalName(id) ? 3 :
  name === `${canonicalName(id)}.bak` ? 2 : name.endsWith(".bak") ? 0 : 1;
const revisionOf = board => board?.updatedAt ?? 0;
const canonicalPathKey = id => process.platform === "win32" ? id.toLowerCase() : id;

function assertNoCanonicalPathCollision(id, candidates) {
  if (process.platform !== "win32") return;
  const collision = candidates.find(candidate => candidate.board.id !== id &&
    canonicalPathKey(candidate.board.id) === canonicalPathKey(id));
  if (!collision) return;
  const error = new Error(`Board id "${id}" conflicts with "${collision.board.id}" on this filesystem.`);
  error.code = "BOARD_ID_PATH_COLLISION";
  throw error;
}

function assertUniqueCanonicalPathIds(boards) {
  const idsByPath = new Map();
  for (const board of boards) {
    const key = canonicalPathKey(board.id);
    const previousId = idsByPath.get(key);
    if (previousId !== undefined && previousId !== board.id) {
      const error = new Error(`Imported board ids "${previousId}" and "${board.id}" conflict on this filesystem.`);
      error.code = "BOARD_ID_PATH_COLLISION";
      throw error;
    }
    idsByPath.set(key, board.id);
  }
}

async function readBoardSources(directory, onWarning = console.warn) {
  let names;
  try {
    names = await fs.readdir(directory);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    names = [];
  }
  const jsonNames = names.filter(isBoardJsonSource);
  const candidates = await mapInBatches(jsonNames, 8, async name => {
    try {
      const value = JSON.parse(await readFileLimited(sourcePath(directory, name), MAX_BOARD_FILE_BYTES, "Board JSON", "utf8"));
      const board = assertValidBoard(repairLegacyBoard(value));
      return { name, board, rank: sourceRank(name, board.id) };
    } catch (error) {
      onWarning(`Skipping unreadable board file: ${name}`, error);
      return null;
    }
  });
  const byId = new Map();
  for (const candidate of candidates.filter(Boolean)) {
    const previous = byId.get(candidate.board.id);
    if (!previous || revisionOf(candidate.board) > revisionOf(previous.board) ||
      (revisionOf(candidate.board) === revisionOf(previous.board) &&
        (candidate.rank > previous.rank ||
          (candidate.rank === previous.rank && candidate.name < previous.name)))) {
      byId.set(candidate.board.id, candidate);
    }
  }
  return { names, candidates: candidates.filter(Boolean), byId };
}

const staleRevisionError = () => {
  const error = new Error("A newer version of this board is already saved. Reload before replacing it.");
  error.code = "STALE_BOARD_REVISION";
  return error;
};

async function assertCurrentRevision(snapshot, baseRevision, byId) {
  if (baseRevision !== undefined && baseRevision !== null && (!Number.isSafeInteger(baseRevision) || baseRevision < 0))
    throw new Error('Board base revision is invalid.');
  const previous = byId.get(snapshot.id)?.board;
  const sameSnapshot = previous && JSON.stringify(previous) === JSON.stringify(snapshot);
  const currentRevision = previous ? revisionOf(previous) : null;
  const conflict = baseRevision !== undefined && currentRevision !== baseRevision;
  if (!sameSnapshot && (conflict || (previous && revisionOf(previous) >= revisionOf(snapshot)))) throw staleRevisionError();
}

async function retireAliasSources(directory, id, candidates) {
  for (const { name, board } of candidates) {
    if (board.id !== id || isCanonicalSource(name, id)) continue;
    const retired = `${sourcePath(directory, name)}.retired-${randomUUID()}`;
    try {
      await fs.rename(sourcePath(directory, name), retired);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
}

async function writeCanonical(directory, snapshot, options, scan) {
  assertNoCanonicalPathCollision(snapshot.id, scan.candidates);
  await assertCurrentRevision(snapshot, options?.baseRevision, scan.byId);
  const file = boardFile(directory, snapshot.id);
  const current = scan.byId.get(snapshot.id);
  // A valid canonical primary is already an acknowledged source when it is
  // the winning revision. Otherwise the canonical write must finish first.
  const canonicalPrimaryIsWinner = current?.name === canonicalName(snapshot.id) &&
    JSON.stringify(current.board) === JSON.stringify(snapshot);
  if (!canonicalPrimaryIsWinner) {
    await atomicWriteJson(file, snapshot, { validate: validateStoredBoard });
  }
  const after = await readBoardSources(directory, () => undefined);
  const acknowledged = after.candidates.some(candidate => candidate.name === canonicalName(snapshot.id) &&
    JSON.stringify(candidate.board) === JSON.stringify(snapshot));
  if (!acknowledged) throw new Error("Canonical board write could not be acknowledged.");
  await retireAliasSources(directory, snapshot.id, after.candidates);
  return { ...after, byId: new Map(after.byId).set(snapshot.id, { name: canonicalName(snapshot.id), board: snapshot, rank: 2 }) };
}

export function saveStoredBoard(directory, board, options = {}) {
  const snapshot = snapshotBoard(board);
  return enqueueWrite(path.resolve(directory), async () => {
    const scan = await readBoardSources(directory);
    await writeCanonical(directory, snapshot, options, scan);
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
    let scan = await readBoardSources(directory);
    assertUniqueCanonicalPathIds(snapshots);
    for (const board of snapshots) assertNoCanonicalPathCollision(board.id, scan.candidates);
    // Preflight every revision before changing any canonical file.
    for (const board of snapshots) await assertCurrentRevision(board, undefined, scan.byId);
    for (const board of snapshots) {
      scan = await writeCanonical(directory, board, undefined, scan);
    }
  });
}

export function deleteStoredBoard(directory, id, options = {}) {
  const file = boardFile(directory, id);
  return enqueueWrite(path.resolve(directory), async () => {
    const scan = await readBoardSources(directory);
    assertNoCanonicalPathCollision(normalizeBoardId(id), scan.candidates);
    const baseRevision = options.baseRevision;
    if (baseRevision !== undefined) {
      if (baseRevision !== null && (!Number.isSafeInteger(baseRevision) || baseRevision < 0)) throw new Error('Board base revision is invalid.');
      const previous = scan.byId.get(normalizeBoardId(id))?.board;
      if (previous && revisionOf(previous) !== baseRevision) {
        const error = new Error('The board changed before deletion. Reload before deleting it.');
        error.code = 'STALE_BOARD_REVISION';
        throw error;
      }
    }
    const boardId = normalizeBoardId(id);
    // Retire mismatched-name sources first. If retirement fails, keep the
    // canonical files intact so a failed deletion cannot expose stale data.
    await retireAliasSources(directory, boardId, scan.candidates);
    for (const name of [`${file}.bak`, file]) {
      await fs.unlink(name).catch(error => { if (error.code !== "ENOENT") throw error; });
    }
    return true;
  });
}

async function loadStoredBoardsInQueue(directory, onWarning) {
  await fs.mkdir(directory, { recursive: true });
  let scan = await readBoardSources(directory, onWarning);
  const byId = new Map([...scan.byId].map(([id, candidate]) => [id, candidate.board]));

  // Normalize filename aliases only after the canonical file is durably
  // readable. Retired source files remain available for manual recovery.
  for (const [id, candidate] of scan.byId) {
    try {
      scan = await writeCanonical(directory, candidate.board, undefined, scan);
    } catch (error) {
      onWarning(`Could not migrate stored board: ${id}`, error);
    }
    byId.set(id, candidate.board);
  }

  // Normalize legacy ZIP-backed storage once. Preserve the archive as
  // recovery material, but don't keep loading an unmanaged second copy.
  const archiveNames = scan.names.filter(name => name.endsWith(".zip"));
  for (const name of archiveNames) {
    const file = path.join(directory, name);
    try {
      const bytes = await readFileLimited(file, MAX_BOARD_FILE_BYTES, "Board archive");
      const page = snapshotBoard(repairLegacyBoard(await loadDesktopBoardArchive(bytes, { fallbackId: path.basename(name, ".zip") })));
      assertNoCanonicalPathCollision(page.id, scan.candidates);
      const existing = scan.byId.get(page.id)?.board;
      if (!existing || revisionOf(page) > revisionOf(existing)) {
        scan = await writeCanonical(directory, page, undefined, scan);
        byId.set(page.id, page);
      }
      await fs.rename(file, `${file}.imported-${randomUUID()}`);
    } catch (error) {
      onWarning(`Could not import stored archive: ${name}`, error);
    }
  }
  return [...byId.values()].sort((a, b) => revisionOf(b) - revisionOf(a));
}

export function loadStoredBoards(directory, onWarning = console.warn) {
  return enqueueWrite(path.resolve(directory), () => loadStoredBoardsInQueue(directory, onWarning));
}
