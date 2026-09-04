import assert from "node:assert/strict";
import test from "node:test";
import type { BoardElement, SectionSheet } from "../src/types";
import {
  attachBoardDocumentRoots,
  cloneBoardDocument,
} from "../src/features/board/clone-board-document";

test("cloning a board remaps element and spreadsheet references without mutating source", () => {
  const elements: BoardElement[] = [
    {
      id: "section-a",
      type: "section",
      position: { x: 0, y: 0 },
      size: { width: 100, height: 40 },
      content: "1",
      zIndex: 1,
      sheetCell: {
        sheetId: "sheet-old",
        rowId: "row-old",
        columnId: "column-old",
        address: "A1",
      },
    },
    {
      id: "text-a",
      type: "text",
      position: { x: 10, y: 10 },
      content: "Linked",
      zIndex: 2,
      parentId: "section-a",
      linkToId: "section-a",
    },
  ];
  const sheets: SectionSheet[] = [
    {
      id: "sheet-old",
      version: 1,
      name: "Sheet",
      rowOrder: ["row-old"],
      columnOrder: ["column-old"],
      rows: { "row-old": { id: "row-old", height: 40 } },
      columns: { "column-old": { id: "column-old", width: 100 } },
      cellIds: [["section-a"]],
      headerRows: 1,
      headerColumns: 0,
      showHeaders: true,
      shortcuts: {
        addRow: "A",
        addColumn: "B",
        fillDown: "C",
        fillRight: "D",
        autoFit: "E",
        series: "F",
      },
      automations: [],
      createdAt: 1,
      updatedAt: 1,
    },
  ];
  let nextId = 0;

  const clone = cloneBoardDocument(elements, sheets, () => `new-${++nextId}`);

  assert.notEqual(clone.elements[0].id, elements[0].id);
  assert.equal(clone.elements[1].parentId, clone.elements[0].id);
  assert.equal(clone.elements[1].linkToId, clone.elements[0].id);
  assert.equal(clone.sheets[0].cellIds[0][0], clone.elements[0].id);
  assert.equal(clone.elements[0].sheetCell?.sheetId, clone.sheets[0].id);
  assert.equal(
    clone.elements[0].sheetCell?.rowId,
    clone.sheets[0].rowOrder[0],
  );
  assert.equal(elements[0].id, "section-a");
  assert.equal(sheets[0].cellIds[0][0], "section-a");
});

test("cloning across a document boundary clears external references", () => {
  const source: BoardElement[] = [
    {
      id: "text-a",
      type: "text",
      position: { x: 0, y: 0 },
      content: "External references",
      zIndex: 1,
      parentId: "parent-outside-document",
      linkToId: "target-outside-document",
    },
  ];

  const clone = cloneBoardDocument(source, [], () => "new-id");

  assert.equal(clone.elements[0].parentId, undefined);
  assert.equal(clone.elements[0].linkToId, undefined);
});

test("cloning remaps rich-text target links and neutralizes external targets", () => {
  const source: BoardElement[] = [
    {
      id: "target-a",
      type: "section",
      position: { x: 0, y: 0 },
      content: "Target",
      zIndex: 1,
    },
    {
      id: "text-a",
      type: "text",
      position: { x: 20, y: 20 },
      content:
        '<a href="#target-target-a">Internal</a><a href="#target-external-a">External</a>',
      zIndex: 2,
    },
  ];
  let nextId = 0;

  const clone = cloneBoardDocument(source, [], () => `rich-${++nextId}`);
  const clonedTarget = clone.elements[0];
  const clonedText = clone.elements[1];

  assert.match(clonedText.content, new RegExp(`#target-${clonedTarget.id}`));
  assert.doesNotMatch(clonedText.content, /#target-target-a/);
  assert.doesNotMatch(clonedText.content, /#target-external-a/);
});

test("attaching a cloned document parents roots without changing descendants", () => {
  const elements: BoardElement[] = [
    {
      id: "root",
      type: "section",
      position: { x: 0, y: 0 },
      content: "Root",
      zIndex: 1,
    },
    {
      id: "child",
      type: "text",
      parentId: "root",
      position: { x: 0, y: 0 },
      content: "Child",
      zIndex: 2,
    },
  ];

  const attached = attachBoardDocumentRoots(elements, "board-target");

  assert.equal(attached[0].parentId, "board-target");
  assert.equal(attached[1].parentId, "root");
  assert.equal(elements[0].parentId, undefined);
});

test("cloning preserves web links and normalizes legacy optional fields", () => {
  const source = [
    {
      id: "legacy",
      type: "section",
      position: { x: 0, y: 0 },
      linkToId: "https://example.com/path",
    },
  ] as unknown as BoardElement[];

  const cloned = cloneBoardDocument(source, [], () => "clone-id").elements[0];

  assert.equal(cloned.linkToId, "https://example.com/path");
  assert.equal(cloned.content, "");
  assert.equal(cloned.zIndex, 0);
});
