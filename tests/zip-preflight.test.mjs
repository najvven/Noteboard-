import assert from "node:assert/strict";
import test from "node:test";
import JSZip from "jszip";

import { assertSafeZipDirectory, MAX_ZIP_ENTRY_COUNT } from "../shared/zip-preflight.js";

test("ZIP preflight accepts a normal archive and reports its entries", async () => {
  const zip = new JSZip();
  zip.file("board.json", "{}");
  zip.file("assets/image.txt", "asset");
  const buffer = await zip.generateAsync({ type: "uint8array" });
  assert.deepEqual(assertSafeZipDirectory(buffer), { entryCount: 3 });
});

test("ZIP preflight rejects metadata bombs before JSZip parsing", async () => {
  const zip = new JSZip();
  for (let index = 0; index <= MAX_ZIP_ENTRY_COUNT; index += 1) {
    zip.file(`empty-${index}.txt`, "");
  }
  const buffer = await zip.generateAsync({ type: "uint8array" });
  assert.throws(() => assertSafeZipDirectory(buffer), /too many entries/i);
});

test("ZIP preflight rejects malformed central directories", () => {
  assert.throws(
    () => assertSafeZipDirectory(new Uint8Array([1, 2, 3, 4])),
    /directory|archive/i,
  );
});
