import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { assertValidBoard, assertFileSize, normalizeBoardId, MAX_BOARD_FILE_BYTES } from "./board-data.js";
import { atomicWriteJson, readFileLimited } from "./persistence.js";
import { withBoardStoreLock } from "./store-lock.js";
import { boardWriteError } from "./board-errors.js";
import { repairLegacyBoard } from "./board-migration.js";
import { loadDesktopBoardArchive } from "./desktop-board-archive.js";
import { mapInBatches } from "./batch.js";

export const boardFile = (directory, id) => {
  try { return path.join(directory, `${normalizeBoardId(id)}.json`); }
  catch (error) { throw boardWriteError('INVALID_BOARD_DATA', error.message); }
};
const validateStoredBoard = value => assertValidBoard(repairLegacyBoard(value));

const snapshotBoard = board => {
  try {
    assertValidBoard(board);
    const payload = JSON.stringify(board);
    assertFileSize(Buffer.byteLength(payload, "utf8"), MAX_BOARD_FILE_BYTES, "Saved board");
    return JSON.parse(payload);
  } catch (error) { throw boardWriteError('INVALID_BOARD_DATA', error.message); }
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

function indexSources(names, candidates) {
  const byId = new Map();
  for (const candidate of candidates) {
    const previous = byId.get(candidate.board.id);
    if (!previous || revisionOf(candidate.board) > revisionOf(previous.board) ||
      (revisionOf(candidate.board) === revisionOf(previous.board) &&
        (candidate.rank > previous.rank ||
          (candidate.rank === previous.rank && candidate.name < previous.name)))) {
      byId.set(candidate.board.id, candidate);
    }
  }
  return { names, candidates, byId };
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
  return indexSources(names, candidates.filter(Boolean));
}

const staleRevisionError = () => {
  const error = new Error("A newer version of this board is already saved. Reload before replacing it.");
  error.code = "STALE_BOARD_REVISION";
  return error;
};

async function assertCurrentRevision(snapshot, baseRevision, byId) {
  if (baseRevision !== undefined && baseRevision !== null && (!Number.isSafeInteger(baseRevision) || baseRevision < 0))
    throw boardWriteError('INVALID_BOARD_DATA', 'Board base revision is invalid.');
  const previous = byId.get(snapshot.id)?.board;
  const sameSnapshot = previous && JSON.stringify(previous) === JSON.stringify(snapshot);
  const currentRevision = previous ? revisionOf(previous) : null;
  const conflict = baseRevision !== undefined && currentRevision !== baseRevision;
  if (!sameSnapshot && (conflict || (previous && revisionOf(previous) >= revisionOf(snapshot)))) throw staleRevisionError();
}

async function retireAliasSources(directory, id, candidates, assertHeld = () => {}) {
  const retiredNames = new Set();
  for (const { name, board } of candidates) {
    if (board.id !== id || isCanonicalSource(name, id)) continue;
    const retired = `${sourcePath(directory, name)}.retired-${randomUUID()}`;
    try {
      assertHeld();
      await fs.rename(sourcePath(directory, name), retired);
      retiredNames.add(name);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return retiredNames;
}

async function writeCanonical(directory, snapshot, options, scan, assertHeld = () => {}) {
  assertHeld();
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
    assertHeld();
    // Verify only the files this write can change. A directory rescan for
    // every migrated board made a normal workspace load quadratic in I/O.
    const refreshed = [];
    for (const name of [canonicalName(snapshot.id), `${canonicalName(snapshot.id)}.bak`]) {
      try {
        const board = validateStoredBoard(JSON.parse(await readFileLimited(sourcePath(directory, name), MAX_BOARD_FILE_BYTES, 'Board JSON', 'utf8')));
        refreshed.push({ name, board, rank: sourceRank(name, board.id) });
      } catch (error) {
        if (name === canonicalName(snapshot.id)) throw error;
        // An unreadable old backup does not invalidate a verified primary.
      }
    }
    const acknowledged = refreshed.find(candidate => candidate.name === canonicalName(snapshot.id));
    if (!acknowledged || JSON.stringify(acknowledged.board) !== JSON.stringify(snapshot))
      throw new Error('Canonical board write could not be acknowledged.');
    const changedNames = new Set([canonicalName(snapshot.id), `${canonicalName(snapshot.id)}.bak`]);
    scan = indexSources([...new Set([...scan.names, ...refreshed.map(candidate => candidate.name)])],
      [...scan.candidates.filter(candidate => !changedNames.has(candidate.name)), ...refreshed]);
  }
  const retired = await retireAliasSources(directory, snapshot.id, scan.candidates, assertHeld);
  assertHeld();
  return retired.size ? indexSources(scan.names.filter(name => !retired.has(name)),
    scan.candidates.filter(candidate => !retired.has(candidate.name))) : scan;
}

export function saveStoredBoard(directory, board, options = {}) {
  const snapshot = snapshotBoard(board);
  return withBoardStoreLock(directory, async assertHeld => {
    const scan = await readBoardSources(directory);
    await writeCanonical(directory, snapshot, options, scan, assertHeld);
    return true;
  });
}

export async function saveStoredBoards(directory, boards, options = {}) {
  if (!Array.isArray(boards)) throw boardWriteError('INVALID_BOARD_DATA', "Boards must be an array.");
  const snapshots = boards.map(snapshotBoard);
  const ids = new Set();
  for (const board of snapshots) {
    if (ids.has(board.id)) throw boardWriteError('INVALID_BOARD_DATA', "Imported board ids must be unique.");
    ids.add(board.id);
  }
  const bases = snapshots.map(board => {
    if (options.baseRevisions === undefined) return null; // Legacy import is create-only.
    if (!options.baseRevisions || typeof options.baseRevisions !== 'object' ||
      !Object.hasOwn(options.baseRevisions, board.id)) throw boardWriteError('BOARD_PRECONDITION_REQUIRED', 'Every imported board needs a base revision.');
    const base = options.baseRevisions[board.id];
    if (base !== null && (!Number.isSafeInteger(base) || base < 0)) throw boardWriteError('INVALID_BOARD_DATA', 'Board base revision is invalid.');
    return base;
  });
  await withBoardStoreLock(directory, async assertHeld => {
    let scan = await readBoardSources(directory);
    assertUniqueCanonicalPathIds(snapshots);
    for (const board of snapshots) assertNoCanonicalPathCollision(board.id, scan.candidates);
    // Preflight every revision before changing any canonical file.
    for (let index = 0; index < snapshots.length; index++) await assertCurrentRevision(snapshots[index], bases[index], scan.byId);
    for (let index = 0; index < snapshots.length; index++) {
      scan = await writeCanonical(directory, snapshots[index], { baseRevision: bases[index] }, scan, assertHeld);
    }
  });
}

export function deleteStoredBoard(directory, id, options = {}) {
  const file = boardFile(directory, id);
  return withBoardStoreLock(directory, async assertHeld => {
    const scan = await readBoardSources(directory);
    assertNoCanonicalPathCollision(normalizeBoardId(id), scan.candidates);
    const baseRevision = options.baseRevision;
    if (baseRevision !== undefined) {
      if (baseRevision !== null && (!Number.isSafeInteger(baseRevision) || baseRevision < 0)) throw boardWriteError('INVALID_BOARD_DATA', 'Board base revision is invalid.');
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
    await retireAliasSources(directory, boardId, scan.candidates, assertHeld);
    for (const name of [`${file}.bak`, file]) {
      assertHeld();
      await fs.unlink(name).catch(error => { if (error.code !== "ENOENT") throw error; });
    }
    return true;
  }, { create: false });
}

async function loadStoredBoardsInQueue(directory, onWarning, assertHeld) {
  await fs.mkdir(directory, { recursive: true });
  let scan = await readBoardSources(directory, onWarning);
  const byId = new Map([...scan.byId].map(([id, candidate]) => [id, candidate.board]));

  // Normalize filename aliases only after the canonical file is durably
  // readable. Retired source files remain available for manual recovery.
  for (const [id, candidate] of scan.byId) {
    try {
      scan = await writeCanonical(directory, candidate.board, undefined, scan, assertHeld);
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
        scan = await writeCanonical(directory, page, undefined, scan, assertHeld);
        byId.set(page.id, page);
      }
      assertHeld();
      await fs.rename(file, `${file}.imported-${randomUUID()}`);
    } catch (error) {
      onWarning(`Could not import stored archive: ${name}`, error);
    }
  }
  return [...byId.values()].sort((a, b) => revisionOf(b) - revisionOf(a));
}

export function loadStoredBoards(directory, onWarning = console.warn) {
  return withBoardStoreLock(directory, assertHeld => loadStoredBoardsInQueue(directory, onWarning, assertHeld));
}
