import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import test from "node:test";

import { readNativeClipboard } from "../shared/native-clipboard.js";

test("native clipboard keeps text, HTML, image, and readable files when another file is missing", async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "noteboard-clipboard-"));
  try {
    const imagePath = path.join(directory, "valid.png");
    await writeFile(imagePath, Buffer.from([1, 2, 3, 4]));
    const missingPath = path.join(directory, "missing.png");
    const uris = [missingPath, imagePath].map((name) => pathToFileURL(name).href).join("\r\n");
    const clipboard = {
      readText: () => "clipboard text",
      readHTML: () => "<b>clipboard html</b>",
      readImage: () => ({ isEmpty: () => false, toDataURL: () => "data:image/png;base64,AQID" }),
      availableFormats: () => ["text/uri-list"],
      readBuffer: () => Buffer.alloc(0),
      read: () => uris,
    };

    const result = await readNativeClipboard(clipboard);
    assert.equal(result.text, "clipboard text");
    assert.equal(result.html, "<b>clipboard html</b>");
    assert.equal(result.image, "data:image/png;base64,AQID");
    assert.deepEqual(result.files, [
      { name: "valid.png", type: "image/png", base64: "AQIDBA==" },
    ]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
