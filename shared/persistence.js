import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { assertFileSize, MAX_BOARD_FILE_BYTES } from "./board-data.js";

const writeQueues = new Map();
let temporaryFileCounter = 0;
const WINDOWS_REPLACE_RETRY_CODES = new Set(["EACCES", "EBUSY", "EEXIST", "EPERM"]);

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function replaceFile(temporaryPath, filePath, { fileSystem = fs, platform = process.platform } = {}) {
  let initialError;
  try {
    await fileSystem.rename(temporaryPath, filePath);
    return;
  } catch (error) {
    if (
      platform !== "win32" ||
      !WINDOWS_REPLACE_RETRY_CODES.has(error?.code)
    ) {
      throw error;
    }
    initialError = error;
  }

  // Windows may refuse to replace an existing file. Move the old destination
  // aside instead of unlinking it; for .bak this can be the only previous
  // recovery copy, while for the primary the valid .bak remains available.
  const heldPath = `${filePath}.replace-hold-${randomUUID()}`;
  let destinationStat;
  try { destinationStat = await fileSystem.lstat(filePath); }
  catch (error) {
    if (error?.code !== "ENOENT") throw initialError;
  }
  if (!destinationStat) {
    try { await fileSystem.rename(temporaryPath, filePath); return; }
    catch (error) { throw error; }
  }
  if (!destinationStat.isFile() && !destinationStat.isSymbolicLink()) throw initialError;
  try { await fileSystem.rename(filePath, heldPath); }
  catch { throw initialError; }
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fileSystem.rename(temporaryPath, filePath);
      // Once the new destination is installed, the hold file duplicates a
      // valid primary/backup. Cleanup failure must not revoke the write ACK.
      await fileSystem.rm(heldPath, { force: true }).catch(error => {
        console.warn(`Could not clean replaced JSON file ${heldPath}.`, error);
      });
      return;
    } catch (error) {
      lastError = error;
      if (!WINDOWS_REPLACE_RETRY_CODES.has(error?.code)) break;
      await wait(8 * (attempt + 1));
    }
  }
  try {
    await fileSystem.rename(heldPath, filePath);
  } catch (restoreError) {
    lastError.recoveryPath = heldPath;
    lastError.restoreError = restoreError;
  }
  throw lastError;
}

export function enqueueWrite(key, operation) {
  const previous = writeQueues.get(key) ?? Promise.resolve();
  const current = previous.catch(() => undefined).then(operation);
  writeQueues.set(key, current);

  return current.finally(() => {
    if (writeQueues.get(key) === current) writeQueues.delete(key);
  });
}

export async function atomicWriteJson(filePath, value, options = {}) {
  // These overrides are for deterministic filesystem-failure tests only.
  const fileSystem = options.fileSystem ?? fs;
  const platform = options.platform ?? process.platform;
  const maxBytes = options.maxBytes ?? MAX_BOARD_FILE_BYTES;
  const payload = JSON.stringify(value);
  assertFileSize(Buffer.byteLength(payload, "utf8"), maxBytes, "Saved JSON");
  options.validate?.(value);
  await fileSystem.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${
      temporaryFileCounter++
    }.tmp`,
  );
  const backupPath = `${filePath}.bak`;

  try {
    const handle = await fileSystem.open(temporaryPath, "wx");
    try {
      await handle.writeFile(payload, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    let previous;
    try {
      const stat = await fileSystem.stat(filePath);
      if (stat.isFile() && stat.size <= maxBytes)
        previous = await readFileLimited(filePath, maxBytes, "Previous JSON", "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    let validPrevious = previous !== undefined;
    if (validPrevious) {
      try {
        // Parse even when a caller has no schema validator. Otherwise the
        // optional-call short circuit would treat corrupt JSON as a valid
        // previous document and rotate it over the last good backup.
        const previousValue = JSON.parse(previous);
        options.validate?.(previousValue);
      } catch {
        validPrevious = false;
      }
    }
    // A corrupt primary must never rotate over its last valid recovery copy.
    // Filesystem failures abort before replacing the primary.
    if (validPrevious) {
      const backupTemporaryPath = `${temporaryPath}.bak`;
      try {
        await fileSystem.writeFile(backupTemporaryPath, previous, { encoding: "utf8", flag: "wx" });
        await replaceFile(backupTemporaryPath, backupPath, { fileSystem, platform });
      } finally {
        await fileSystem.rm(backupTemporaryPath, { force: true }).catch(() => undefined);
      }
    }
    await replaceFile(temporaryPath, filePath, { fileSystem, platform });
  } catch (error) {
    await fileSystem.rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function readFileLimited(
  filePath,
  maxBytes = MAX_BOARD_FILE_BYTES,
  label = "File",
  encoding,
) {
  const handle = await fs.open(filePath, "r");
  try {
    const stat = await handle.stat();
    assertFileSize(stat.size, maxBytes, label);
    const buffer = Buffer.alloc(Number(stat.size));
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        offset,
        buffer.length - offset,
        offset,
      );
      if (!bytesRead) break;
      offset += bytesRead;
    }
    const output = offset === buffer.length ? buffer : buffer.subarray(0, offset);
    return encoding ? output.toString(encoding) : output;
  } finally {
    await handle.close();
  }
}

export async function readJsonWithBackup(
  filePath,
  fallbackValue,
  options = {},
) {
  const maxBytes = options.maxBytes ?? MAX_BOARD_FILE_BYTES;
  const label = options.label ?? "JSON file";
  let primaryError;
  try {
    const value = JSON.parse(await readFileLimited(filePath, maxBytes, label, "utf8"));
    options.validate?.(value);
    return value;
  } catch (error) {
    primaryError = error;
  }

  try {
    const value = JSON.parse(
      await readFileLimited(`${filePath}.bak`, maxBytes, `${label} backup`, "utf8"),
    );
    options.validate?.(value);
    return value;
  } catch {
    if (fallbackValue !== undefined) return fallbackValue;
    throw primaryError;
  }
}
