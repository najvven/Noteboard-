import assert from "node:assert/strict";
import test from "node:test";
import type { Page, Preset } from "../src/types";
import {
  clonePageAsAdditionalBoard,
  pagePresentationFromPreset,
} from "../src/features/board/board-transfer";

const page = (overrides: Partial<Page> = {}): Page => ({
  id: "page",
  title: "Page",
  width: 600,
  height: 400,
  updatedAt: 1,
  isPinned: false,
  elements: [],
  ...overrides,
});

const sequentialIds = () => {
  let value = 0;
  return () => `copy-${++value}`;
};

test("additional source boards outside Main keep their peer surface and child ownership when moved", () => {
  const source = page({ elements: [
    { id: 'outside-board', type: 'board', position: { x: 900, y: 0 }, size: { width: 300, height: 200 }, content: '', zIndex: -2 },
    { id: 'outside-text', type: 'text', parentId: 'outside-board', position: { x: 940, y: 20 }, content: 'Outside', zIndex: 1 },
  ] });
  const result = clonePageAsAdditionalBoard(source, page({ id: 'destination' }), sequentialIds());
  const additional = result.elements.find(e => e.type === 'board' && e.id !== result.surface.id)!;
  const text = result.elements.find(e => e.content === 'Outside')!;
  assert.equal(additional.parentId, undefined);
  assert.equal(text.parentId, additional.id);
  assert.equal(text.position.x - additional.position.x, 40);
});

test("page transfer uses destination-local geometry and keeps all cloned content aligned with its surface", () => {
  const destination = page({
    id: "destination",
    width: 800,
    height: 600,
    workspaceWidth: 20_000,
    workspaceHeight: 20_000,
    boardX: 15_000,
    boardY: 14_000,
    elements: [
      {
        id: "destination-item",
        type: "rectangle",
        position: { x: 820, y: 20 },
        size: { width: 40, height: 30 },
        content: "",
        zIndex: 2,
      },
    ],
  });
  const source = page({
    id: "source",
    title: "Source board",
    width: 300,
    height: 200,
    workspaceWidth: 50_000,
    workspaceHeight: 40_000,
    boardX: 35_000,
    boardY: 27_000,
    boardColor: "#e0f2fe",
    elements: [
      {
        id: "root-item",
        type: "rectangle",
        position: { x: 25, y: 35 },
        size: { width: 60, height: 40 },
        content: "",
        zIndex: 1,
      },
      {
        id: "internal-board",
        type: "board",
        position: { x: 160, y: 80 },
        size: { width: 100, height: 90 },
        content: "Nested surface",
        zIndex: -2,
      },
      {
        id: "nested-item",
        type: "text",
        parentId: "internal-board",
        position: { x: 170, y: 90 },
        size: { width: 50, height: 20 },
        content: "Nested content",
        zIndex: 1,
      },
    ],
  });

  const result = clonePageAsAdditionalBoard(source, destination, sequentialIds());
  const rootItem = result.elements.find((element) => element.name === undefined && element.type === "rectangle" && element.id !== "destination-item")!;
  const internalBoard = result.elements.find((element) => element.type === "board" && element.id !== result.surface.id)!;
  const nestedItem = result.elements.find((element) => element.content === "Nested content")!;
  const offsetX = result.surface.position.x;

  assert.equal(result.surface.position.x, 910);
  assert.equal(result.surface.position.y, 0);
  assert.equal(result.surface.color, "#e0f2fe");
  assert.equal(result.surface.content, source.title);
  assert.equal(rootItem.position.x, 25 + offsetX);
  assert.equal(rootItem.position.y, 35);
  assert.equal(rootItem.parentId, result.surface.id);
  assert.ok(rootItem.position.x + rootItem.size!.width <= result.surface.position.x + result.surface.size!.width);
  assert.ok(rootItem.position.y + rootItem.size!.height <= result.surface.position.y + result.surface.size!.height);
  assert.equal(internalBoard.position.x, 160 + offsetX);
  assert.equal(internalBoard.parentId, result.surface.id);
  assert.equal(nestedItem.position.x, 170 + offsetX);
  assert.equal(nestedItem.parentId, internalBoard.id);
  assert.ok(nestedItem.position.x + nestedItem.size!.width <= internalBoard.position.x + internalBoard.size!.width);
  assert.ok(nestedItem.position.y + nestedItem.size!.height <= internalBoard.position.y + internalBoard.size!.height);
});

test("source workspace origins do not affect transfer geometry", () => {
  const destination = page({
    width: 800,
    boardX: 900_000,
    boardY: -800_000,
    workspaceWidth: 1_000_000,
    workspaceHeight: 1_000_000,
  });
  const source = page({
    width: 200,
    height: 100,
    boardX: 700_000,
    boardY: 600_000,
    workspaceWidth: 800_000,
    workspaceHeight: 700_000,
    elements: [
      {
        id: "item",
        type: "rectangle",
        position: { x: 10, y: 20 },
        size: { width: 30, height: 40 },
        content: "",
        zIndex: 1,
      },
    ],
  });

  const result = clonePageAsAdditionalBoard(source, destination, sequentialIds());
  const item = result.elements.find((element) => element.type === "rectangle")!;
  assert.deepEqual(result.surface.position, { x: 850, y: 0 });
  assert.deepEqual(item.position, { x: 860, y: 20 });
});

test("preset presentation retains board background and grid/workspace values", () => {
  const preset: Preset = {
    id: "preset",
    name: "Preset",
    description: "",
    icon: "LayoutGrid",
    isBuiltIn: false,
    elements: [],
    width: 900,
    height: 700,
    workspaceWidth: 4000,
    workspaceHeight: 3000,
    showGrid: true,
    snapToGrid: true,
    showWorkspaceGrid: true,
    brightness: 90,
    gridColor: "#111111",
    boardColor: "#fef3c7",
    gridThickness: 2,
    gridSize: 32,
    workspaceGridColor: "#334155",
    workspaceGridThickness: 3,
    workspaceGridSize: 48,
    editorSettings: { activeTool: "select" },
  };
  const presentation = pagePresentationFromPreset(preset, {
    width: 1024,
    height: 768,
    workspaceWidth: 5000,
    workspaceHeight: 4000,
    snapToGrid: false,
  });

  assert.deepEqual(presentation, {
    width: 900,
    height: 700,
    workspaceWidth: 4000,
    workspaceHeight: 3000,
    showGrid: true,
    snapToGrid: true,
    showWorkspaceGrid: true,
    brightness: 90,
    gridColor: "#111111",
    boardColor: "#fef3c7",
    gridThickness: 2,
    gridSize: 32,
    workspaceGridColor: "#334155",
    workspaceGridThickness: 3,
    workspaceGridSize: 48,
    editorSettings: { activeTool: "select" },
  });
  assert.notEqual(presentation.editorSettings, preset.editorSettings);
});
