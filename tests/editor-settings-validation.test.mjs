import assert from "node:assert/strict";
import test from "node:test";

import { readBoardPackageFile } from "../src/features/board/board-package.ts";

const board = (editorSettings) => ({
  id: "settings-board",
  title: "Settings board",
  width: 800,
  height: 600,
  elements: [],
  editorSettings,
});

const importBoard = (value) =>
  readBoardPackageFile(
    new File([JSON.stringify(value)], "settings.json", { type: "application/json" }),
  );

test("board import rejects malformed editor settings before returning a page", async () => {
  const malformedSettings = [
    [],
    { toolbarLayout: { order: "select", more: [] } },
    { toolbarLayout: { order: [], more: [], slots: [] } },
    { toolbarLayout: { order: [], more: [], slots: { select: "first" } } },
    { customColors: [] },
    { customColors: { bg: "#ffffff" } },
    { pendingProps: [] },
    { pendingProps: { points: "not-points" } },
    { toolMenuSettingsOverrides: [] },
    { toolMenuSettingsOverrides: { select: [] } },
    { objectPresets: {} },
    {
      objectPresets: [
        { id: "preset-1", name: "Broken", element: { id: "item", type: "text", position: "0,0" } },
      ],
    },
    { objectDefaults: [] },
    { objectDefaults: { text: [] } },
    { keepToolActive: "yes" },
    { spreadsheetMode: "compact" },
  ];

  for (const editorSettings of malformedSettings) {
    await assert.rejects(
      () => importBoard(board(editorSettings)),
      /editor settings|toolbarLayout|customColors|pendingProps|toolMenuSettingsOverrides|objectPresets|objectDefaults|spreadsheetMode/i,
    );
  }
});

test("board import preserves valid legacy and current editor settings records", async () => {
  const legacy = {
    activeTool: "polygon-select",
    toolbarLayout: { more: ["embed", "board", "table"] },
    customColors: { bg: ["#ffffff", ""], legacyPalette: ["rebeccapurple"] },
    pendingProps: { isSmooth: true, borderWidth: 3 },
    toolMenuSettingsOverrides: {
      select: { allowEditing: true, legacyFlag: "kept" },
    },
    objectPresets: [
      {
        id: "legacy preset 1",
        name: "Legacy preset",
        element: {
          id: "legacy-element",
          type: "text",
          position: { x: 10, y: 20 },
          content: "Text",
          parentId: "legacy-external-parent",
          linkToId: "legacy-external-target",
          zIndex: 1,
        },
      },
    ],
    objectDefaults: { text: { color: "#111111", fontSize: 20 } },
    futureOptionalSetting: { retained: true },
  };
  const current = {
    activeTool: "select",
    selectMode: "polygon",
    spreadsheetMode: "simple",
    spreadsheetCellWidth: 112,
    spreadsheetCellHeight: 28,
    alwaysOnTop: false,
    keepToolActive: true,
    keepToolActiveFallback: "select",
    previewMode: "realistic",
    selectionLockTime: 250,
    scrollZoomSensitivity: 1,
    overlapMode: "none",
    customColors: { grid: ["#e2e8f0"] },
    pendingProps: { color: "#ffffff", opacity: 80 },
    toolMenuSettingsOverrides: {
      text: { alwaysOnTop: true, previewMode: "box", pageInteractionWithHand: false },
    },
    toolbarLayout: {
      order: ["select", "text"],
      more: ["table"],
      general: ["grid", "toolDefaults"],
      slots: { select: 0, text: 1 },
    },
    objectPresets: [
      {
        id: "preset-current",
        name: "Current preset",
        elements: [
          { id: "preset-item", type: "rectangle", position: { x: 0, y: 0 }, size: { width: 20, height: 20 }, content: "", zIndex: 1 },
        ],
        shortcut: "P",
      },
    ],
    objectDefaults: { rectangle: { color: "#dbeafe", keepRatio: true } },
  };

  const legacyImported = await importBoard(board(legacy));
  const currentImported = await importBoard(board(current));
  assert.equal(legacyImported.editorSettings.activeTool, "polygon-select");
  assert.deepEqual(legacyImported.editorSettings.toolbarLayout, legacy.toolbarLayout);
  assert.deepEqual(legacyImported.editorSettings.objectPresets, legacy.objectPresets);
  assert.deepEqual(legacyImported.editorSettings.futureOptionalSetting, { retained: true });
  assert.equal(currentImported.editorSettings.selectMode, "polygon");
  assert.deepEqual(currentImported.editorSettings.toolbarLayout, current.toolbarLayout);
  assert.deepEqual(currentImported.editorSettings.objectPresets, current.objectPresets);
});
