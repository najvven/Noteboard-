import fs from "node:fs/promises";
import path from "node:path";
import { assertFileSize, MAX_BOARD_FILE_BYTES } from "./board-data.js";

const writeQueues = new Map();
let temporaryFileCounter = 0;
const WINDOWS_REPLACE_RETRY_CODES = new Set(["EACCES", "EBUSY", "EEXIST", "EPERM"]);

const wait = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function replaceFile(temporaryPath, filePath) {
  try {
    await fs.rename(temporaryPath, filePath);
    return;
  } catch (error) {
    if (
      process.platform !== "win32" ||
      !WINDOWS_REPLACE_RETRY_CODES.has(error?.code)
    ) {
      throw error;
    }
  }

  // Windows can briefly deny replacement while virus scanning or indexing the
  // destination. The readable .bak already exists, so remove only the primary
  // and retry the final move with a short bounded backoff.
  await fs.rm(filePath, { force: true });
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.rename(temporaryPath, filePath);
      return;
    } catch (error) {
      lastError = error;
      if (!WINDOWS_REPLACE_RETRY_CODES.has(error?.code)) throw error;
      await wait(8 * (attempt + 1));
    }
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
  const maxBytes = options.maxBytes ?? MAX_BOARD_FILE_BYTES;
  const payload = JSON.stringify(value);
  assertFileSize(Buffer.byteLength(payload, "utf8"), maxBytes, "Saved JSON");
  options.validate?.(value);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.${
      temporaryFileCounter++
    }.tmp`,
  );
  const backupPath = `${filePath}.bak`;

  try {
    const handle = await fs.open(temporaryPath, "wx");
    try {
      await handle.writeFile(payload, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    let previous;
    try {
      const stat = await fs.stat(filePath);
      if (stat.isFile() && stat.size <= maxBytes)
        previous = await readFileLimited(filePath, maxBytes, "Previous JSON", "utf8");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    let validPrevious = previous !== undefined;
    if (validPrevious) {
      try {
        options.validate?.(JSON.parse(previous));
      } catch {
        validPrevious = false;
      }
    }
    // A corrupt primary must never rotate over its last valid recovery copy.
    // Filesystem failures abort before replacing the primary.
    if (validPrevious) {
      const backupTemporaryPath = `${temporaryPath}.bak`;
      try {
        await fs.writeFile(backupTemporaryPath, previous, { encoding: "utf8", flag: "wx" });
        await replaceFile(backupTemporaryPath, backupPath);
      } finally {
        await fs.rm(backupTemporaryPath, { force: true }).catch(() => undefined);
      }
    }
    await replaceFile(temporaryPath, filePath);
  } catch (error) {
    await fs.rm(temporaryPath, { force: true }).catch(() => undefined);
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
