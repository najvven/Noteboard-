import assert from "node:assert/strict";
import test from "node:test";

import JSZip from "jszip";

import { loadDesktopBoardArchive } from "../shared/desktop-board-archive.js";

const page = () => ({
  version: 3,
  id: "desktop-board",
  title: "Desktop",
  width: 800,
  height: 600,
  elements: [
    {
      id: "asset-1",
      type: "media",
      position: { x: 0, y: 0 },
      size: { width: 180, height: 96 },
      content: "assets/asset-1.png",
      mediaMime: "image/png",
      zIndex: 1,
    },
  ],
});

const archive = async (value = page()) => {
  const zip = new JSZip();
  zip.file("board.json", JSON.stringify(value));
  zip.file("assets/asset-1.png", new Uint8Array([1, 2, 3]));
  return zip.generateAsync({ type: "uint8array" });
};

test("desktop archive loading validates and restores assets immutably", async () => {
  const source = page();
  const before = structuredClone(source);
  const loaded = await loadDesktopBoardArchive(await archive(source));

  assert.deepEqual(source, before);
  assert.match(loaded.elements[0].content, /^data:image\/png;base64,/);
  assert.notEqual(loaded.elements, source.elements);
});

test("desktop archive loading enforces JSON and asset expansion limits", async () => {
  await assert.rejects(
    async () =>
      loadDesktopBoardArchive(await archive(), {
        limits: {
          boardFileBytes: 1_000_000,
          expandedArchiveBytes: 1_000_000,
          boardJsonBytes: 32,
          assetBytes: 1_000_000,
        },
      }),
    /board\.json is too large/i,
  );

  await assert.rejects(
    async () =>
      loadDesktopBoardArchive(await archive(), {
        limits: {
          boardFileBytes: 1_000_000,
          expandedArchiveBytes: 1_000_000,
          boardJsonBytes: 100_000,
          assetBytes: 2,
        },
      }),
    /Board asset is too large/i,
  );
});

test("desktop archive loading rejects unsafe or missing asset paths", async () => {
  const unsafe = page();
  unsafe.elements[0] = {
    ...unsafe.elements[0],
    content: "assets/../outside.png",
  };
  await assert.rejects(
    async () => loadDesktopBoardArchive(await archive(unsafe)),
    /asset path is invalid/i,
  );
});
