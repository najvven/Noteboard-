import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  assertFileSize,
  assertValidBoard,
  formatBytes,
  getArchiveDeclaredSize,
  MAX_BOARD_DIMENSION,
  MAX_BOARD_ELEMENTS,
  MAX_SECTION_SHEETS,
  normalizeBoardId,
} from "../shared/board-data.js";
import {
  atomicWriteJson,
  enqueueWrite,
  readFileLimited,
  readJsonWithBackup,
} from "../shared/persistence.js";
import { mapInBatches } from "../shared/batch.js";

test("board ids keep their identity and unsafe ids are rejected", () => {
  assert.equal(normalizeBoardId("page-1_bad"), "page-1_bad");
  assert.throws(() => normalizeBoardId("../page-2"));
  assert.throws(() => normalizeBoardId("page/2"));
  assert.throws(() => normalizeBoardId("../"));
});

test("board validation accepts the current data shape", () => {
  const page = {
    id: "page-1",
    title: "Example",
    width: 1024,
    height: 768,
    elements: [],
  };
  assert.equal(assertValidBoard(page), page);
  assert.throws(() => assertValidBoard({ ...page, width: -1 }));
});

test("board validation accepts only supported per-element preview overrides", () => {
  const element = {
    id: "line-1",
    type: "line",
    position: { x: 10, y: 20 },
    size: { width: 120, height: 40 },
    content: "",
    zIndex: 1,
  };
  const page = {
    id: "preview-page",
    title: "Preview",
    width: 1024,
    height: 768,
    elements: [element],
  };

  assert.equal(
    assertValidBoard({
      ...page,
      elements: [{ ...element, previewMode: "box" }],
    }).elements[0].previewMode,
    "box",
  );
  assert.equal(
    assertValidBoard({
      ...page,
      elements: [{ ...element, previewMode: "realistic" }],
    }).elements[0].previewMode,
    "realistic",
  );
  assert.throws(
    () =>
      assertValidBoard({
        ...page,
        elements: [{ ...element, previewMode: "surprise" }],
      }),
    /preview mode/i,
  );
});

test("board validation rejects dangling and cyclic element relationships", () => {
  const element = (id, parentId) => ({
    id,
    type: "section",
    position: { x: 0, y: 0 },
    content: "",
    zIndex: 1,
    ...(parentId ? { parentId } : {}),
  });
  const page = (elements) => ({
    version: 3,
    id: "hierarchy-page",
    title: "Hierarchy",
    width: 100,
    height: 100,
    elements,
  });

  assert.throws(
    () => assertValidBoard(page([element("a", "missing")])),
    /parent.*missing|relationship/i,
  );
  assert.throws(
    () => assertValidBoard(page([element("a", "b"), element("b", "a")])),
    /cycle/i,
  );
  assert.throws(
    () =>
      assertValidBoard(
        page([{ ...element("a"), linkToId: "missing-target" }]),
      ),
    /link.*missing|relationship/i,
  );
});

test("board validation rejects malformed elements and spreadsheet references", () => {
  const baseElement = {
    id: "section-1",
    type: "section",
    position: { x: 0, y: 0 },
    size: { width: 120, height: 48 },
    content: "",
    zIndex: 1,
  };
  const page = {
    id: "page-safe",
    title: "Safe",
    width: 1024,
    height: 768,
    elements: [baseElement],
  };

  assert.throws(() =>
    assertValidBoard({
      ...page,
      elements: [baseElement, { ...baseElement }],
    }),
    /unique/,
  );
  assert.throws(() =>
    assertValidBoard({
      ...page,
      elements: [{ ...baseElement, position: { x: Number.NaN, y: 0 } }],
    }),
    /position/,
  );
  assert.throws(() =>
    assertValidBoard({
      ...page,
      elements: [{ ...baseElement, content: { unsafe: true } }],
    }),
    /content/,
  );
  assert.throws(() =>
    assertValidBoard({
      ...page,
      sectionSheets: [
        {
          id: "sheet-1",
          version: 1,
          rowOrder: ["row-1"],
          columnOrder: ["column-1"],
          rows: { "row-1": { id: "row-1", height: 48 } },
          columns: { "column-1": { id: "column-1", width: 120 } },
          cellIds: [["missing-cell"]],
        },
      ],
    }),
    /cell/,
  );
});

test("board validation rejects every malformed boundary shape", () => {
  const element = {
    id: "section-1",
    type: "section",
    position: { x: 0, y: 0 },
    size: { width: 120, height: 48 },
    content: "",
    zIndex: 1,
  };
  const page = {
    id: "page-safe",
    title: "Safe",
    width: 1024,
    height: 768,
    elements: [element],
  };
  const invalidPages = [
    null,
    [],
    { ...page, id: "../page-safe" },
    { ...page, id: "x".repeat(201) },
    { ...page, title: null },
    { ...page, title: "x".repeat(501) },
    { ...page, elements: null },
    { ...page, elements: new Array(MAX_BOARD_ELEMENTS + 1) },
    { ...page, width: Number.POSITIVE_INFINITY },
    { ...page, workspaceHeight: MAX_BOARD_DIMENSION + 1 },
    { ...page, elements: [null] },
    { ...page, elements: [[element]] },
    { ...page, elements: [{ ...element, id: null }] },
    { ...page, elements: [{ ...element, id: "bad id" }] },
    { ...page, elements: [{ ...element, id: "x".repeat(201) }] },
    { ...page, elements: [{ ...element, type: null }] },
    { ...page, elements: [{ ...element, type: "x".repeat(51) }] },
    { ...page, elements: [{ ...element, mediaMime: { unsafe: true } }] },
    { ...page, elements: [{ ...element, mediaKind: "script" }] },
    { ...page, elements: [{ ...element, webDeviceMode: "television" }] },
    { ...page, elements: [{ ...element, webCookieBlocker: "maybe" }] },
    { ...page, elements: [{ ...element, webAdBlock: "yes" }] },
    { ...page, elements: [{ ...element, mediaPlaybackRate: 0 }] },
    { ...page, elements: [{ ...element, mediaVolume: 2 }] },
    { ...page, elements: [{ ...element, position: null }] },
    { ...page, elements: [{ ...element, position: { x: 0, y: Number.NaN } }] },
    { ...page, elements: [{ ...element, position: { x: MAX_BOARD_DIMENSION + 1, y: 0 } }] },
    { ...page, elements: [{ ...element, size: { width: "wide", height: 1 } }] },
    { ...page, elements: [{ ...element, size: { width: 1, height: 0 } }] },
    { ...page, elements: [{ ...element, size: { width: 1, height: MAX_BOARD_DIMENSION + 1 } }] },
    { ...page, elements: [{ ...element, zIndex: Number.NaN }] },
    { ...page, elements: [{ ...element, points: "invalid" }] },
    { ...page, elements: [{ ...element, points: new Array(1_000_001) }] },
    { ...page, elements: [{ ...element, points: [null] }] },
    { ...page, elements: [{ ...element, points: [{ x: 0, y: Number.NaN }] }] },
    { ...page, sectionSheets: null },
    { ...page, sectionSheets: new Array(MAX_SECTION_SHEETS + 1) },
  ];

  invalidPages.forEach((candidate) => assert.throws(() => assertValidBoard(candidate)));
});

test("spreadsheet persistence validation rejects malformed structures and reused cells", () => {
  const elements = [
    {
      id: "cell-1",
      type: "section",
      position: { x: 0, y: 0 },
      size: { width: 120, height: 48 },
      content: "1",
      sheetCell: {
        sheetId: "sheet-1",
        rowId: "row-1",
        columnId: "column-1",
        address: "A1",
      },
    },
  ];
  const sheet = {
    id: "sheet-1",
    version: 1,
    rowOrder: ["row-1"],
    columnOrder: ["column-1"],
    rows: { "row-1": { id: "row-1", height: 48 } },
    columns: { "column-1": { id: "column-1", width: 120 } },
    cellIds: [["cell-1"]],
    shortcuts: { addRow: "Alt+Shift+ArrowDown" },
    automations: [
      {
        id: "automation-1",
        name: "Auto fit",
        enabled: true,
        trigger: "manual",
        action: "auto-fit",
      },
    ],
  };
  const page = { id: "sheet-page", title: "Sheet", elements, sectionSheets: [sheet] };

  assert.equal(assertValidBoard(page), page);
  [
    null,
    { ...sheet, version: 2 },
    { ...sheet, id: null },
    { ...sheet, rowOrder: null },
    { ...sheet, columnOrder: null },
    { ...sheet, cellIds: null },
    { ...sheet, cellIds: [] },
  ].forEach((candidate) =>
    assert.throws(() => assertValidBoard({ ...page, sectionSheets: [candidate] })),
  );
  assert.throws(() => assertValidBoard({ ...page, sectionSheets: [sheet, sheet] }));
  assert.throws(() =>
    assertValidBoard({ ...page, sectionSheets: [{ ...sheet, cellIds: ["cell-1"] }] }),
  );
  assert.throws(() =>
    assertValidBoard({
      ...page,
      sectionSheets: [{ ...sheet, cellIds: [["cell-1", "cell-1"]] }],
    }),
  );
  assert.throws(() =>
    assertValidBoard({
      ...page,
      sectionSheets: [
        sheet,
        { ...sheet, id: "sheet-2", cellIds: [["cell-1"]] },
      ],
    }),
  );
  assert.throws(() =>
    assertValidBoard({
      ...page,
      elements: [{ ...elements[0], type: "note" }],
    }),
  );
  assert.throws(() =>
    assertValidBoard({
      ...page,
      elements: [{ ...elements[0], sheetCell: undefined }],
    }),
  );
  assert.throws(() =>
    assertValidBoard({
      ...page,
      sectionSheets: [
        {
          ...sheet,
          rowOrder: ["row-1", "row-1"],
          cellIds: [["cell-1"], ["cell-1"]],
        },
      ],
    }),
  );
  assert.throws(() =>
    assertValidBoard({
      ...page,
      sectionSheets: [
        {
          ...sheet,
          automations: [{ ...sheet.automations[0], action: "run-code" }],
        },
      ],
    }),
  );
  assert.throws(() =>
    assertValidBoard({
      ...page,
      sectionSheets: [{ ...sheet, shortcuts: { addRow: 42 } }],
    }),
  );
  for (const sheetCell of [
    { ...elements[0].sheetCell, computedValue: { unsafe: true } },
    { ...elements[0].sheetCell, computedValue: Number.POSITIVE_INFINITY },
    { ...elements[0].sheetCell, error: 42 },
    { ...elements[0].sheetCell, valueType: "object" },
  ]) {
    assert.throws(() =>
      assertValidBoard({
        ...page,
        elements: [{ ...elements[0], sheetCell }],
      }),
    );
  }
});

test("board-specific editor and toolbar settings survive persistence", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "noteboard-settings-"));
  const filePath = path.join(directory, "page.json");
  const page = {
    id: "page-settings",
    title: "Settings",
    width: 1024,
    height: 768,
    elements: [],
    editorSettings: {
      activeTool: "section",
      alwaysOnTop: false,
      previewMode: "box",
      selectionLockTime: 250,
      toolMenuSettingsOverrides: {
        media: { previewMode: "realistic" },
        "object-presets": { alwaysOnTop: true },
      },
      toolbarLayout: {
        order: [
          "toolDefaults",
          "presetSettings",
          "behaviorSettings",
          "shortcutSettings",
          "select",
          "pan",
          "grid",
        ],
        more: ["presetSettings", "shortcutSettings", "eraser"],
        slots: { toolDefaults: 0, select: 2, pan: 4, grid: 7 },
      },
      objectDefaults: {
        section: { borderColor: "#2563eb", borderWidth: 2 },
      },
      objectPresets: [
        {
          id: "preset-1",
          name: "Blue section",
          element: {
            id: "preset-source",
            type: "section",
            position: { x: 0, y: 0 },
            zIndex: 1,
            borderColor: "#2563eb",
          },
        },
      ],
    },
  };

  try {
    await atomicWriteJson(filePath, page);
    assert.deepEqual(await readJsonWithBackup(filePath), page);
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("file and archive limits reject oversized input", () => {
  assert.equal(formatBytes(Number.NaN), "0 MB");
  assert.equal(formatBytes(0), "0 MB");
  assert.throws(() => assertFileSize(Number.NaN, 10), /invalid/);
  assert.throws(() => assertFileSize(-1, 10), /invalid/);
  assert.doesNotThrow(() => assertFileSize(10, 10));
  assert.throws(() => assertFileSize(11, 10, "Board"), /too large/);
  assert.equal(
    getArchiveDeclaredSize({
      a: { dir: false, _data: { uncompressedSize: 12 } },
      b: { dir: false, _data: { uncompressedSize: 8 } },
      folder: { dir: true, _data: { uncompressedSize: 100 } },
    }),
    20,
  );
  assert.equal(getArchiveDeclaredSize(undefined), 0);
  assert.equal(
    getArchiveDeclaredSize({
      missing: null,
      negative: { dir: false, _data: { uncompressedSize: -1 } },
      invalid: { dir: false, _data: { uncompressedSize: "not-a-number" } },
    }),
    0,
  );
});

test("batch mapping limits concurrent work", async () => {
  let active = 0;
  let maximumActive = 0;
  const result = await mapInBatches([1, 2, 3, 4, 5], 2, async (value) => {
    active += 1;
    maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 2));
    active -= 1;
    return value * 2;
  });
  assert.deepEqual(result, [2, 4, 6, 8, 10]);
  assert.equal(maximumActive, 2);
});

test("atomic writes keep a readable backup and serialize queued writes", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "noteboard-test-"));
  const filePath = path.join(directory, "page.json");
  try {
    await atomicWriteJson(filePath, { version: 1 });
    await Promise.all([
      enqueueWrite(filePath, () => atomicWriteJson(filePath, { version: 2 })),
      enqueueWrite(filePath, () => atomicWriteJson(filePath, { version: 3 })),
    ]);

    assert.deepEqual(await readJsonWithBackup(filePath), { version: 3 });
    assert.deepEqual(JSON.parse(await fs.readFile(`${filePath}.bak`, "utf8")), {
      version: 2,
    });

    await fs.writeFile(filePath, "broken", "utf8");
    assert.deepEqual(await readJsonWithBackup(filePath), { version: 2 });
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("JSON reads use an explicit fallback and surface missing primary data", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "noteboard-fallback-"));
  const filePath = path.join(directory, "missing.json");
  try {
    assert.deepEqual(await readJsonWithBackup(filePath, { safe: true }), { safe: true });
    await assert.rejects(() => readJsonWithBackup(filePath));
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});

test("bounded file reads reject oversized primary and backup files before allocation", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "noteboard-limit-"));
  const filePath = path.join(directory, "oversized.json");
  try {
    await fs.writeFile(filePath, JSON.stringify({ payload: "x".repeat(256) }));
    await assert.rejects(
      () => readFileLimited(filePath, 32, "Board JSON"),
      /too large/i,
    );
    await assert.rejects(
      () => readJsonWithBackup(filePath, undefined, { maxBytes: 32 }),
      /too large/i,
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
