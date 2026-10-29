import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
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
const DELETE_TRANSACTIONS_DIRECTORY = ".noteboard-delete-transactions";
const DELETE_TRANSACTION_PATTERN = /^\.delete-([0-9a-f-]{36})$/i;
const hashBytes = value => createHash("sha256").update(value).digest("hex");

const snapshotBoard = board => {
  try {
    // Saving and ACK verification must compare the same migrated shape that
    // loading will expose (e.g. new Layers default missing content to "").
    const normalized = repairLegacyBoard(board);
    assertValidBoard(normalized);
    const payload = JSON.stringify(normalized);
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
// Board IDs are case-preserving, but their filenames must be portable across
// the case-insensitive volumes commonly used by Windows and macOS. Reject
// case-only collisions rather than silently changing a user's ID.
const canonicalPathKey = id => id.toLowerCase();
const physicalNameKey = name => name.toLowerCase();

function assertNoCanonicalPathCollision(id, scan) {
  const targetPaths = new Set([
    physicalNameKey(canonicalName(id)),
    physicalNameKey(`${canonicalName(id)}.bak`),
  ]);
  const pathCollision = (scan.candidatesByCanonicalPathKey.get(canonicalPathKey(id)) ?? [])
    .find(candidate => candidate.board.id !== id);
  const nameCollision = [...targetPaths]
    .map(name => scan.byName.get(name))
    .find(candidate => candidate && candidate.board.id !== id);
  const collision = pathCollision || nameCollision;
  if (!collision) return;
  const error = new Error(`Board id "${id}" conflicts with the physical source "${collision.name}" owned by "${collision.board.id}".`);
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
  const candidatesById = new Map();
  const candidatesByCanonicalPathKey = new Map();
  const byName = new Map();
  for (const candidate of candidates) {
    const idGroup = candidatesById.get(candidate.board.id) ?? [];
    idGroup.push(candidate);
    candidatesById.set(candidate.board.id, idGroup);
    const pathKey = canonicalPathKey(candidate.board.id);
    const pathGroup = candidatesByCanonicalPathKey.get(pathKey) ?? [];
    pathGroup.push(candidate);
    candidatesByCanonicalPathKey.set(pathKey, pathGroup);
    byName.set(physicalNameKey(candidate.name), candidate);
    const previous = byId.get(candidate.board.id);
    if (!previous || revisionOf(candidate.board) > revisionOf(previous.board) ||
      (revisionOf(candidate.board) === revisionOf(previous.board) &&
        (candidate.rank > previous.rank ||
          (candidate.rank === previous.rank && candidate.name < previous.name)))) {
      byId.set(candidate.board.id, candidate);
    }
  }
  return { names, candidates, byId, candidatesById, candidatesByCanonicalPathKey, byName };
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
      const bytes = await readFileLimited(sourcePath(directory, name), MAX_BOARD_FILE_BYTES, "Board JSON");
      const value = JSON.parse(bytes.toString("utf8"));
      const board = assertValidBoard(repairLegacyBoard(value));
      return { name, board, rank: sourceRank(name, board.id), sourceHash: hashBytes(bytes) };
    } catch (error) {
      onWarning(`Skipping unreadable board file: ${name}`, error);
      return null;
    }
  });
  return indexSources(names, candidates.filter(Boolean));
}

async function readMutationSources(directory, onWarning = console.warn) {
  const scan = await readBoardSources(directory, onWarning);
  const archives = scan.names.filter(name => name.endsWith('.zip'));
  if (!archives.length) return scan;
  const candidates = await mapInBatches(archives, 4, async name => {
    try {
      const bytes = await readFileLimited(sourcePath(directory, name), MAX_BOARD_FILE_BYTES, 'Board archive');
      const legacy = await loadDesktopBoardArchive(bytes, { fallbackId: path.basename(name, '.zip') });
      const board = snapshotBoard(repairLegacyBoard(legacy));
      return { name, board, rank: sourceRank(name, board.id), sourceHash: hashBytes(bytes) };
    } catch (error) {
      onWarning(`Skipping unreadable board archive: ${name}`, error);
      return null;
    }
  });
  // Include ZIP-only IDs in create/update/delete ownership checks. The
  // mutation paths retire any matching ZIP as an inert recovery archive.
  return indexSources(scan.names, [...scan.candidates, ...candidates.filter(Boolean)]);
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

const deletionTransactionsDirectory = directory => path.join(directory, DELETE_TRANSACTIONS_DIRECTORY);
const deletionTransactionDirectory = (directory, transactionId) =>
  path.join(deletionTransactionsDirectory(directory), `.delete-${transactionId}`);
const deletionFilesDirectory = transactionDirectory => path.join(transactionDirectory, "files");
const deletionManifestPath = transactionDirectory => path.join(transactionDirectory, "manifest.json");
const deletionCommitPath = transactionDirectory => path.join(transactionDirectory, "committed");

function deletionRecoveryError(transactionId, message) {
  const error = new Error(`Board deletion ${transactionId} needs recovery: ${message}`);
  error.code = "BOARD_DELETE_RECOVERY_REQUIRED";
  return error;
}

function isSafeStoreFileName(name) {
  return typeof name === "string" && name.length > 0 && name !== "." && name !== ".." &&
    !name.includes("/") && !name.includes("\\") && !name.includes("\0");
}

function validateDeletionManifest(manifest, expectedId) {
  if (!manifest || manifest.version !== 1 || typeof manifest.transactionId !== "string" ||
      !DELETE_TRANSACTION_PATTERN.test(`.delete-${manifest.transactionId}`) ||
      manifest.boardId !== expectedId || !Array.isArray(manifest.sources) || manifest.sources.length > 10_000) {
    throw deletionRecoveryError(String(manifest?.transactionId ?? "unknown"), "the transaction manifest is invalid");
  }
  try { normalizeBoardId(manifest.boardId); }
  catch { throw deletionRecoveryError(manifest.transactionId, "the board ID in the transaction manifest is invalid"); }
  for (const source of manifest.sources) {
    if (!isSafeStoreFileName(source?.sourceName) || !isSafeStoreFileName(source?.stagedName) ||
        !/^[0-9a-f]{64}$/i.test(source?.sha256 ?? "") ||
        typeof source?.preserveAsRetired !== "boolean" ||
        (source.preserveAsRetired && !isSafeStoreFileName(source.retiredName))) {
      throw deletionRecoveryError(manifest.transactionId, "the transaction source list is invalid");
    }
  }
  return manifest;
}

async function pathExists(filePath) {
  try { await fs.lstat(filePath); return true; }
  catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}

async function readDeletionManifest(transactionDirectory) {
  const manifestBytes = await readFileLimited(deletionManifestPath(transactionDirectory), 4 * 1024 * 1024, "Board deletion manifest");
  let manifest;
  try { manifest = JSON.parse(manifestBytes.toString("utf8")); }
  catch { throw deletionRecoveryError(path.basename(transactionDirectory), "the transaction manifest is unreadable"); }
  const match = DELETE_TRANSACTION_PATTERN.exec(path.basename(transactionDirectory));
  if (!match) throw deletionRecoveryError(path.basename(transactionDirectory), "the transaction directory name is invalid");
  validateDeletionManifest(manifest, manifest.boardId);
  if (manifest.transactionId.toLowerCase() !== match[1].toLowerCase())
    throw deletionRecoveryError(manifest.transactionId, "the transaction ID does not match its directory");
  return { manifest, manifestBytes, manifestHash: hashBytes(manifestBytes) };
}

async function isCommittedDeletion(transactionDirectory, manifest, manifestHash) {
  const commitPath = deletionCommitPath(transactionDirectory);
  if (!(await pathExists(commitPath))) return false;
  try {
    const marker = JSON.parse((await readFileLimited(commitPath, 4096, "Board deletion commit marker", "utf8")));
    return marker?.version === 1 && marker.transactionId === manifest.transactionId &&
      marker.manifestSha256 === manifestHash;
  } catch {
    // A malformed marker cannot establish an acknowledged deletion. Restore
    // from the pending manifest instead of guessing that deletion committed.
    return false;
  }
}

async function writeExclusiveSynced(filePath, contents) {
  const handle = await fs.open(filePath, "wx");
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function syncDirectoryIfSupported(directory) {
  let handle;
  try {
    handle = await fs.open(directory, "r");
    await handle.sync();
  } catch (error) {
    if (!["EACCES", "EBADF", "EISDIR", "EINVAL", "ENOTSUP", "EPERM"].includes(error?.code)) throw error;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

async function removeTransactionDirectory(transactionDirectory, transactionRoot) {
  const filesDirectory = deletionFilesDirectory(transactionDirectory);
  await fs.rm(deletionManifestPath(transactionDirectory), { force: true });
  await fs.rm(deletionCommitPath(transactionDirectory), { force: true });
  await fs.rmdir(filesDirectory).catch(error => { if (error?.code !== "ENOENT" && error?.code !== "ENOTEMPTY") throw error; });
  await fs.rmdir(transactionDirectory).catch(error => { if (error?.code !== "ENOENT" && error?.code !== "ENOTEMPTY") throw error; });
  await fs.rmdir(transactionRoot).catch(error => { if (error?.code !== "ENOENT" && error?.code !== "ENOTEMPTY") throw error; });
}

async function finishCommittedDeletion(directory, transactionDirectory, manifest, transactionRoot, onWarning = console.warn) {
  const filesDirectory = deletionFilesDirectory(transactionDirectory);
  try {
    for (const source of manifest.sources) {
      const stagedPath = path.join(filesDirectory, source.stagedName);
      if (!(await pathExists(stagedPath))) continue;
      const bytes = await readFileLimited(stagedPath, MAX_BOARD_FILE_BYTES, "Board deletion recovery source");
      if (hashBytes(bytes) !== source.sha256)
        throw deletionRecoveryError(manifest.transactionId, `recovery source ${source.sourceName} failed its integrity check`);
      if (source.preserveAsRetired) {
        const retiredPath = sourcePath(directory, source.retiredName);
        if (await pathExists(retiredPath)) {
          const existing = await readFileLimited(retiredPath, MAX_BOARD_FILE_BYTES, "Retired board source");
          if (hashBytes(existing) !== source.sha256)
            throw deletionRecoveryError(manifest.transactionId, `retired path ${source.retiredName} is occupied`);
          await fs.rm(stagedPath);
        } else {
          await fs.rename(stagedPath, retiredPath);
        }
      } else {
        await fs.rm(stagedPath);
      }
    }
    await removeTransactionDirectory(transactionDirectory, transactionRoot);
  } catch (error) {
    // The durable committed marker decides the delete. Cleanup is idempotent
    // and retries on load; it must not turn an acknowledged deletion into an
    // apparent write failure or cause the client to replay it as a new intent.
    onWarning(`Could not clean committed board deletion ${manifest.transactionId}; cleanup will retry on next load.`, error);
  }
}

async function restorePendingDeletion(directory, transactionDirectory, manifest, transactionRoot, assertHeld, onWarning = console.warn) {
  const filesDirectory = deletionFilesDirectory(transactionDirectory);
  for (const source of manifest.sources) {
    assertHeld();
    const originalPath = sourcePath(directory, source.sourceName);
    const stagedPath = path.join(filesDirectory, source.stagedName);
    const originalExists = await pathExists(originalPath);
    const stagedExists = await pathExists(stagedPath);
    if (stagedExists) {
      const stagedBytes = await readFileLimited(stagedPath, MAX_BOARD_FILE_BYTES, "Board deletion recovery source");
      if (hashBytes(stagedBytes) !== source.sha256)
        throw deletionRecoveryError(manifest.transactionId, `recovery source ${source.sourceName} failed its integrity check`);
      if (originalExists) {
        const originalBytes = await readFileLimited(originalPath, MAX_BOARD_FILE_BYTES, "Board source during deletion recovery");
        if (hashBytes(originalBytes) !== source.sha256)
          throw deletionRecoveryError(manifest.transactionId, `original path ${source.sourceName} changed while deletion was pending`);
        await fs.rm(stagedPath);
      } else {
        await fs.rename(stagedPath, originalPath);
      }
    } else if (!originalExists) {
      throw deletionRecoveryError(manifest.transactionId, `both original and recovery source ${source.sourceName} are missing`);
    }
  }
  try { await removeTransactionDirectory(transactionDirectory, transactionRoot); }
  catch (error) { onWarning(`Could not clean restored board deletion ${manifest.transactionId}; cleanup will retry on next load.`, error); }
}

async function recoverBoardDeletionTransactions(directory, assertHeld = () => {}, onWarning = console.warn) {
  const transactionRoot = deletionTransactionsDirectory(directory);
  let entries;
  try { entries = await fs.readdir(transactionRoot, { withFileTypes: true }); }
  catch (error) { if (error?.code === "ENOENT") return; throw error; }
  for (const entry of entries) {
    const match = entry.isDirectory() && DELETE_TRANSACTION_PATTERN.exec(entry.name);
    if (!match) continue;
    assertHeld();
    const transactionDirectory = path.join(transactionRoot, entry.name);
    const { manifest, manifestHash } = await readDeletionManifest(transactionDirectory);
    if (await isCommittedDeletion(transactionDirectory, manifest, manifestHash)) {
      await finishCommittedDeletion(directory, transactionDirectory, manifest, transactionRoot, onWarning);
    } else {
      await restorePendingDeletion(directory, transactionDirectory, manifest, transactionRoot, assertHeld, onWarning);
    }
  }
}

async function deleteOwnedBoardSources(directory, boardId, candidates, assertHeld, onWarning) {
  const sourcesByName = new Map();
  for (const candidate of candidates) {
    if (candidate.board.id === boardId) sourcesByName.set(candidate.name, candidate);
  }
  const sources = [...sourcesByName.values()].sort((a, b) =>
    b.rank - a.rank || a.name.localeCompare(b.name));
  if (!sources.length) return true;

  // Re-read every source immediately before moving any of them. A local
  // external writer that ignores our lease must not trick the index into
  // retiring bytes owned by another logical board.
  const verified = [];
  for (const source of sources) {
    const bytes = await readFileLimited(sourcePath(directory, source.name), MAX_BOARD_FILE_BYTES, "Board source before deletion");
    if (!source.sourceHash || hashBytes(bytes) !== source.sourceHash)
      throw boardWriteError("BOARD_ID_PATH_COLLISION", `Board source ${source.name} changed during deletion preflight.`);
    verified.push({
      sourceName: source.name,
      stagedName: `${verified.length}-${Buffer.from(source.name, "utf8").toString("base64url")}`,
      sha256: source.sourceHash,
      preserveAsRetired: !isCanonicalSource(source.name, boardId),
      retiredName: !isCanonicalSource(source.name, boardId) ? `${source.name}.retired-${randomUUID()}` : undefined,
    });
  }

  const transactionId = randomUUID();
  const transactionRoot = deletionTransactionsDirectory(directory);
  const transactionDirectory = deletionTransactionDirectory(directory, transactionId);
  const filesDirectory = deletionFilesDirectory(transactionDirectory);
  let manifestWritten = false;
  let manifest;
  let manifestHash;
  await fs.mkdir(transactionRoot, { recursive: true });
  await fs.mkdir(transactionDirectory);
  await fs.mkdir(filesDirectory);
  manifest = { version: 1, transactionId, boardId, sources: verified };
  const manifestBytes = Buffer.from(JSON.stringify(manifest), "utf8");
  try {
    await writeExclusiveSynced(deletionManifestPath(transactionDirectory), manifestBytes);
    manifestWritten = true;
    manifestHash = hashBytes(manifestBytes);
    await syncDirectoryIfSupported(transactionDirectory);
    await syncDirectoryIfSupported(transactionRoot);

    for (const source of verified) {
      assertHeld();
      await fs.rename(sourcePath(directory, source.sourceName), path.join(filesDirectory, source.stagedName));
    }
    await syncDirectoryIfSupported(directory);
    await syncDirectoryIfSupported(filesDirectory);
    assertHeld();
    const marker = JSON.stringify({ version: 1, transactionId, manifestSha256: manifestHash });
    await writeExclusiveSynced(deletionCommitPath(transactionDirectory), marker);
  } catch (error) {
    if (!manifestWritten) {
      await fs.rm(deletionManifestPath(transactionDirectory), { force: true }).catch(() => undefined);
      await fs.rmdir(filesDirectory).catch(() => undefined);
      await fs.rmdir(transactionDirectory).catch(() => undefined);
      await fs.rmdir(transactionRoot).catch(() => undefined);
      throw error;
    }
    try {
      const { manifest: currentManifest, manifestHash: currentHash } = await readDeletionManifest(transactionDirectory);
      if (await isCommittedDeletion(transactionDirectory, currentManifest, currentHash)) {
        await finishCommittedDeletion(directory, transactionDirectory, currentManifest, transactionRoot, onWarning);
        return true;
      }
      await restorePendingDeletion(directory, transactionDirectory, currentManifest, transactionRoot, assertHeld, onWarning);
    } catch (recoveryError) {
      error.recoveryError = recoveryError;
      onWarning(`Board deletion ${transactionId} failed and needs store recovery.`, recoveryError);
    }
    throw error;
  }

  await finishCommittedDeletion(directory, transactionDirectory, manifest, transactionRoot, onWarning);
  return true;
}

async function writeCanonical(directory, snapshot, options, scan, assertHeld = () => {}, batchState, preflighted = false) {
  assertHeld();
  if (!preflighted) {
    assertNoCanonicalPathCollision(snapshot.id, scan);
    await assertCurrentRevision(snapshot, options?.baseRevision, scan.byId);
  }
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
        const bytes = await readFileLimited(sourcePath(directory, name), MAX_BOARD_FILE_BYTES, 'Board JSON');
        const board = validateStoredBoard(JSON.parse(bytes.toString('utf8')));
        refreshed.push({ name, board, rank: sourceRank(name, board.id), sourceHash: hashBytes(bytes) });
      } catch (error) {
        if (name === canonicalName(snapshot.id)) throw error;
        // An unreadable old backup does not invalidate a verified primary.
      }
    }
    const acknowledged = refreshed.find(candidate => candidate.name === canonicalName(snapshot.id));
    if (!acknowledged || JSON.stringify(acknowledged.board) !== JSON.stringify(snapshot))
      throw new Error('Canonical board write could not be acknowledged.');
    const changedNames = new Set([canonicalName(snapshot.id), `${canonicalName(snapshot.id)}.bak`]);
    if (!batchState) {
      scan = indexSources([...new Set([...scan.names, ...refreshed.map(candidate => candidate.name)])],
        [...scan.candidates.filter(candidate => !changedNames.has(candidate.name)), ...refreshed]);
    }
  }
  const ownedSources = scan.candidatesById.get(snapshot.id) ?? [];
  const retired = await retireAliasSources(directory, snapshot.id, ownedSources, assertHeld);
  assertHeld();
  if (batchState) return scan;
  return retired.size ? indexSources(scan.names.filter(name => !retired.has(name)),
    scan.candidates.filter(candidate => !retired.has(candidate.name))) : scan;
}

export function saveStoredBoard(directory, board, options = {}) {
  const snapshot = snapshotBoard(board);
  return withBoardStoreLock(directory, async assertHeld => {
    await recoverBoardDeletionTransactions(directory, assertHeld);
    const scan = await readMutationSources(directory);
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
    await recoverBoardDeletionTransactions(directory, assertHeld);
    let scan = await readMutationSources(directory);
    assertUniqueCanonicalPathIds(snapshots);
    for (const board of snapshots) assertNoCanonicalPathCollision(board.id, scan);
    // Preflight every revision before changing any canonical file.
    for (let index = 0; index < snapshots.length; index++) await assertCurrentRevision(snapshots[index], bases[index], scan.byId);
    const batchState = {};
    for (let index = 0; index < snapshots.length; index++)
      await writeCanonical(directory, snapshots[index], { baseRevision: bases[index] }, scan, assertHeld, batchState, true);
  });
}

export function deleteStoredBoard(directory, id, options = {}) {
  let boardId;
  try { boardId = normalizeBoardId(id); }
  catch (error) { throw boardWriteError('INVALID_BOARD_DATA', error.message); }
  return withBoardStoreLock(directory, async assertHeld => {
    await recoverBoardDeletionTransactions(directory, assertHeld);
    const scan = await readMutationSources(directory);
    assertNoCanonicalPathCollision(boardId, scan);
    const baseRevision = options.baseRevision;
    if (baseRevision !== undefined) {
      if (baseRevision !== null && (!Number.isSafeInteger(baseRevision) || baseRevision < 0)) throw boardWriteError('INVALID_BOARD_DATA', 'Board base revision is invalid.');
      const previous = scan.byId.get(boardId)?.board;
      if (previous && revisionOf(previous) !== baseRevision) {
        const error = new Error('The board changed before deletion. Reload before deleting it.');
        error.code = 'STALE_BOARD_REVISION';
        throw error;
      }
    }
    return deleteOwnedBoardSources(directory, boardId, scan.candidates, assertHeld);
  }, { create: false });
}

async function loadStoredBoardsInQueue(directory, onWarning, assertHeld) {
  await fs.mkdir(directory, { recursive: true });
  await recoverBoardDeletionTransactions(directory, assertHeld, onWarning);
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
      assertNoCanonicalPathCollision(page.id, scan);
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
