import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";

import { mapInBatches } from "../shared/batch.js";
import { atomicWriteJson, readJsonWithBackup } from "../shared/persistence.js";

const directory = await fs.mkdtemp(path.join(os.tmpdir(), "noteboard-stress-"));
const smallBoardCount = 500;
const largeBoardCount = 3;
const largeContent = "x".repeat(16 * 1024 * 1024);
const memoryBefore = process.memoryUsage().rss;

try {
  const writeStarted = performance.now();
  await mapInBatches(
    Array.from({ length: smallBoardCount }, (_, index) => index),
    16,
    (index) =>
      atomicWriteJson(path.join(directory, `small-${index}.json`), {
        id: `small-${index}`,
        title: `Small ${index}`,
        width: 1024,
        height: 768,
        elements: [{ id: `text-${index}`, type: "text", content: "note" }],
      }),
  );
  await mapInBatches(
    Array.from({ length: largeBoardCount }, (_, index) => index),
    2,
    (index) =>
      atomicWriteJson(path.join(directory, `large-${index}.json`), {
        id: `large-${index}`,
        title: `Large ${index}`,
        width: 4096,
        height: 4096,
        elements: [{ id: `media-${index}`, type: "media", content: largeContent }],
      }),
  );
  const writeMs = performance.now() - writeStarted;

  const files = (await fs.readdir(directory)).filter((file) => file.endsWith(".json"));
  const readStarted = performance.now();
  const boards = await mapInBatches(files, 8, (file) =>
    readJsonWithBackup(path.join(directory, file)),
  );
  const readMs = performance.now() - readStarted;
  const memoryAfter = process.memoryUsage().rss;

  console.log(
    JSON.stringify(
      {
        smallBoards: smallBoardCount,
        largeBoards: largeBoardCount,
        largeBoardSizeMiB: 16,
        writeMs: Math.round(writeMs),
        readMs: Math.round(readMs),
        rssIncreaseMiB: Math.round((memoryAfter - memoryBefore) / (1024 * 1024)),
        verifiedBoards: boards.length,
      },
      null,
      2,
    ),
  );
} finally {
  await fs.rm(directory, { recursive: true, force: true });
}
