import assert from "node:assert/strict";
import test from "node:test";

import JSZip from "jszip";

import {
  BoardPackageCancelledError,
  extensionFromMime,
  getBoardPackageElements,
  mimeFromAssetPath,
  readBoardArchive,
  readBoardPackageFile,
  type BoardPackageLimits,
} from "../src/features/board/board-package";

const basePage = () => ({
  id: "page-exported",
  title: "Exported board",
  width: 1024,
  height: 768,
  elements: [
    {
      id: "media-1",
      type: "media" as const,
      position: { x: 0, y: 0 },
      size: { width: 320, height: 180 },
      content: "assets/media-1.png",
      mediaMime: "image/png",
      zIndex: 1,
    },
  ],
});

const makeArchive = async (
  page: unknown,
  asset: Uint8Array = new Uint8Array([1, 2, 3, 4]),
) => {
  const zip = new JSZip();
  zip.file("board.json", JSON.stringify(page));
  zip.file("assets/media-1.png", asset);
  return zip.generateAsync({ type: "uint8array" });
};

const forgeDeclaredSize = (
  archive: Uint8Array,
  targetPath: string,
  declaredSize: number,
) => {
  const forged = archive.slice();
  const view = new DataView(forged.buffer, forged.byteOffset, forged.byteLength);
  const decoder = new TextDecoder();
  for (let offset = 0; offset <= forged.byteLength - 46; offset += 1) {
    const signature = view.getUint32(offset, true);
    if (signature === 0x04034b50) {
      const nameLength = view.getUint16(offset + 26, true);
      const name = decoder.decode(forged.subarray(offset + 30, offset + 30 + nameLength));
      if (name === targetPath) view.setUint32(offset + 22, declaredSize, true);
    }
    if (signature === 0x02014b50) {
      const nameLength = view.getUint16(offset + 28, true);
      const name = decoder.decode(forged.subarray(offset + 46, offset + 46 + nameLength));
      if (name === targetPath) view.setUint32(offset + 24, declaredSize, true);
    }
  }
  return forged;
};

test("board archive validation restores packaged assets without mutating parsed input", async () => {
  const archive = await makeArchive(basePage());
  const imported = await readBoardArchive(archive, {
    createBoardId: () => "page-imported",
  });

  assert.ok(!Array.isArray(imported));
  assert.equal(imported.id, "page-imported");
  assert.match(imported.elements[0].content, /^data:image\/png;base64,/);
  assert.equal(basePage().elements[0].content, "assets/media-1.png");
});

test("board archive rejects malformed boards before exposing their elements", async () => {
  const page = basePage();
  const archive = await makeArchive({
    ...page,
    elements: [page.elements[0], { ...page.elements[0] }],
  });

  await assert.rejects(() => readBoardArchive(archive), /unique/);
});

test("board archive enforces separate JSON and per-asset expansion limits", async () => {
  const archive = await makeArchive(basePage(), new Uint8Array(64));
  const generous: BoardPackageLimits = {
    boardFileBytes: 1024 * 1024,
    expandedArchiveBytes: 1024 * 1024,
    boardJsonBytes: 1024 * 1024,
    assetBytes: 32,
  };
  await assert.rejects(
    () => readBoardArchive(archive, { limits: generous }),
    /Board asset is too large/,
  );

  await assert.rejects(
    () =>
      readBoardArchive(archive, {
        limits: { ...generous, boardJsonBytes: 8, assetBytes: 1024 },
      }),
    /board\.json is too large/,
  );
});

test("streamed entry limits reject ZIP headers that understate expanded bytes", async () => {
  const archive = forgeDeclaredSize(
    await makeArchive(basePage(), new Uint8Array(64)),
    "assets/media-1.png",
    1,
  );
  await assert.rejects(
    () =>
      readBoardArchive(archive, {
        limits: {
          boardFileBytes: 1024 * 1024,
          expandedArchiveBytes: 1024 * 1024,
          boardJsonBytes: 1024 * 1024,
          assetBytes: 32,
        },
      }),
    /Board asset is too large/,
  );
});

test("board archive rejects unsafe or missing packaged asset paths", async () => {
  const unsafePage = basePage();
  unsafePage.elements[0] = {
    ...unsafePage.elements[0],
    content: "assets/../outside.png",
  };
  const unsafeArchive = await makeArchive(unsafePage);
  await assert.rejects(
    () => readBoardArchive(unsafeArchive),
    /asset path is invalid/,
  );

  const missingZip = new JSZip();
  missingZip.file("board.json", JSON.stringify(basePage()));
  const missingArchive = await missingZip.generateAsync({ type: "uint8array" });
  await assert.rejects(
    () => readBoardArchive(missingArchive),
    /asset is missing/,
  );
});

test("direct JSON files use the same validation contract and reject other formats", async () => {
  const imported = await readBoardPackageFile(
    new File([JSON.stringify(basePage())], "board.json", {
      type: "application/json",
    }),
    { createBoardId: () => "page-json" },
  );
  assert.ok(!Array.isArray(imported));
  assert.equal(imported.id, "page-json");
  assert.equal(getBoardPackageElements(imported).length, 1);

  await assert.rejects(
    () => readBoardPackageFile(new File(["x"], "notes.txt")),
    /Only Noteboard JSON and ZIP/,
  );
  await assert.rejects(
    () => readBoardPackageFile(new File(["not json"], "broken.json")),
    /Board JSON is invalid/,
  );
  await assert.rejects(
    () =>
      readBoardPackageFile(
        new File([JSON.stringify(basePage())], "oversized.json"),
        {
          limits: {
            boardFileBytes: 1024 * 1024,
            expandedArchiveBytes: 1024 * 1024,
            boardJsonBytes: 32,
            assetBytes: 1024,
          },
        },
      ),
    /Board JSON is too large/,
  );
  await assert.rejects(
    () =>
      readBoardPackageFile(
        new File(
          [JSON.stringify({ ...basePage(), version: 999 })],
          "future.json",
        ),
      ),
    /newer than this version of Noteboard/i,
  );
});

test("archive progress is observable and cancellation stops work", async () => {
  const archive = await makeArchive(basePage());
  const stages: string[] = [];
  await readBoardArchive(archive, {
    onProgress: ({ stage }) => stages.push(stage),
  });
  assert.ok(stages.includes("opening"));
  assert.ok(stages.includes("board"));
  assert.ok(stages.includes("assets"));

  await assert.rejects(
    () => readBoardArchive(archive, { isCancelled: () => true }),
    (error) => error instanceof BoardPackageCancelledError,
  );
});

test("direct JSON import observes cancellation after asynchronous text decoding", async () => {
  let cancelled = false;
  const file = new File([JSON.stringify(basePage())], "board.json", {
    type: "application/json",
  });
  Object.defineProperty(file, "text", {
    value: async () => {
      cancelled = true;
      return JSON.stringify(basePage());
    },
  });

  await assert.rejects(
    () => readBoardPackageFile(file, { isCancelled: () => cancelled }),
    (error) => error instanceof BoardPackageCancelledError,
  );
});

test("asset MIME helpers preserve the shared export/import naming convention", () => {
  assert.equal(mimeFromAssetPath("assets/photo.jpeg"), "image/jpeg");
  assert.equal(mimeFromAssetPath("assets/unknown.bin", "custom/type"), "custom/type");
  assert.equal(extensionFromMime("image/jpeg"), "jpg");
  assert.equal(extensionFromMime("image/svg+xml"), "svg");
  assert.equal(extensionFromMime("application/x-custom"), "xcustom");
});
