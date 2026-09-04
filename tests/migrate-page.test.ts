import assert from "node:assert/strict";
import test from "node:test";

import { migratePage } from "../src/features/board/migrate-page";
import { createSectionSheetFromSections } from "../src/features/spreadsheet/model";

const sequentialIds = () => {
  let value = 0;
  return () => `migrate-${++value}`;
};

test("page migration recomputes spreadsheet-derived values instead of trusting storage", () => {
  const created = createSectionSheetFromSections([], {
    sectionIds: [],
    layout: "rows",
    rows: 1,
    columns: 2,
    createId: sequentialIds(),
  });
  const [a1, b1] = created.sheet.cellIds[0];
  const storedElements = created.elements.map((element) => {
    if (element.id === a1) return { ...element, content: "7" };
    if (element.id === b1) {
      return {
        ...element,
        content: "=A1*2",
        sheetCell: {
          ...element.sheetCell!,
          computedValue: { untrusted: true } as unknown as string,
          error: "stale",
        },
      };
    }
    return element;
  });
  const stored = {
    id: "page-migrate",
    title: "Migrate",
    elements: storedElements,
    sectionSheets: [created.sheet],
  };

  const migrated = migratePage(stored);
  const formula = migrated.elements.find((element) => element.id === b1);

  assert.equal(formula?.sheetCell?.computedValue, 14);
  assert.equal(formula?.sheetCell?.error, undefined);
  assert.notEqual(migrated.elements, storedElements);
});

test("page migration scales with spreadsheet cells instead of sheets times all elements", () => {
  const count = 10_000;
  const elements = Array.from({ length: count }, (_, index) => ({
    id: `cell-${index}`,
    type: "section" as const,
    position: { x: index, y: 0 },
    size: { width: 72, height: 36 },
    content: String(index),
    zIndex: index,
    sheetCell: {
      sheetId: `sheet-${index}`,
      rowId: `row-${index}`,
      columnId: `column-${index}`,
      address: "A1",
    },
  }));
  const sectionSheets = Array.from({ length: count }, (_, index) => ({
    id: `sheet-${index}`,
    version: 1 as const,
    name: `Sheet ${index}`,
    rowOrder: [`row-${index}`],
    columnOrder: [`column-${index}`],
    rows: { [`row-${index}`]: { id: `row-${index}`, height: 36 } },
    columns: {
      [`column-${index}`]: { id: `column-${index}`, width: 72 },
    },
    cellIds: [[`cell-${index}`]],
    headerRows: 1,
    headerColumns: 0,
    showHeaders: true,
    shortcuts: {},
    automations: [],
    createdAt: 1,
    updatedAt: 1,
  }));

  const startedAt = performance.now();
  const migrated = migratePage({
    id: "many-sheets",
    title: "Many sheets",
    elements,
    sectionSheets,
  });
  const elapsed = performance.now() - startedAt;

  assert.equal(migrated.elements.length, count);
  assert.equal(migrated.elements.at(-1)?.sheetCell?.computedValue, count - 1);
  assert.ok(elapsed < 4_000, `migration took ${Math.round(elapsed)} ms`);
});

test("page migration rejects unsupported future document versions", () => {
  assert.throws(
    () =>
      migratePage({
        version: 999,
        id: "future-page",
        title: "Future",
        elements: [],
      }),
    /newer than this version of Noteboard/i,
  );
});

test("page migration repairs legacy dangling relations and optional element fields", () => {
  const migrated = migratePage({
    id: "legacy-page",
    title: "Legacy",
    width: 800,
    height: 600,
    elements: [
      {
        id: "legacy-element",
        type: "section",
        position: { x: 0, y: 0 },
        parentId: "missing-parent",
        linkToId: "missing-target",
      },
    ],
  });

  assert.equal(migrated.elements[0].parentId, undefined);
  assert.equal(migrated.elements[0].linkToId, undefined);
  assert.equal(migrated.elements[0].content, "");
  assert.equal(migrated.elements[0].zIndex, 0);
});
