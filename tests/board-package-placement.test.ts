import assert from "node:assert/strict";
import test from "node:test";

import type { Page } from "../src/types";
import { placeBoardPackage } from "../src/features/board/board-package-placement";
import { createLegacySheet } from './helpers/legacy-sheet';
import { parseWorkbookDocument } from '../src/features/spreadsheet/workbook';

const sequentialIds = () => {
  let value = 0;
  return () => `placed-${++value}`;
};

test("placing a legacy board package converts old spreadsheet cells into an independent workbook", () => {
  const created = createLegacySheet({
    sectionIds: [],
    layout: "rows",
    rows: 1,
    columns: 2,
    createId: sequentialIds(),
  });
  const [a1, b1] = created.sheet.cellIds[0];
  const linkedElements = created.elements.map((element) =>
    element.id === b1 ? { ...element, linkToId: a1 } : element,
  );
  const source: Page = {
    id: "source-page",
    title: "Source",
    width: 500,
    height: 300,
    updatedAt: 1,
    isPinned: false,
    elements: linkedElements,
    sectionSheets: [created.sheet],
  };

  const result = placeBoardPackage(source, {
    existingElements: [],
    existingSheets: [],
    pageSize: { width: 1_000, height: 800 },
    position: { x: 200, y: 150 },
    parentId: "target-layer",
    createId: sequentialIds(),
  });

  assert.equal(result.importedSheets.length, 0);
  assert.equal(result.importedElements.length, 1);
  assert.equal(result.importedElements[0].type,'table');
  assert.ok(parseWorkbookDocument(result.importedElements[0].content));
  assert.ok(
    result.importedElements.every(
      (element) => element.parentId === "target-layer",
    ),
  );
  assert.deepEqual(source.elements, linkedElements);
});

test("placing a legacy sheet supplies optional defaults before cloning", () => {
  const created = createLegacySheet({
    sectionIds: [],
    layout: "rows",
    rows: 1,
    columns: 1,
    createId: sequentialIds(),
  });
  const legacy = {
    id: "legacy-page",
    title: "Legacy",
    width: 500,
    height: 300,
    updatedAt: 1,
    isPinned: false,
    elements: created.elements,
    sectionSheets: [
      {
        ...created.sheet,
        shortcuts: undefined,
        automations: undefined,
      },
    ],
  } as unknown as Page;

  const result = placeBoardPackage(legacy, {
    existingElements: [],
    existingSheets: [],
    pageSize: { width: 1_000, height: 800 },
    position: { x: 0, y: 0 },
    createId: sequentialIds(),
  });

  assert.equal(result.importedSheets.length,0);
  assert.ok(parseWorkbookDocument(result.importedElements[0].content));
});

test("placing a package preserves source stacking independently of array order", () => {
  const source: Page = {
    id: "stack-page",
    title: "Stack",
    width: 500,
    height: 300,
    updatedAt: 1,
    isPinned: false,
    elements: [
      {
        id: "top",
        type: "section",
        position: { x: 0, y: 0 },
        content: "Top",
        zIndex: 100,
      },
      {
        id: "bottom",
        type: "section",
        position: { x: 0, y: 0 },
        content: "Bottom",
        zIndex: 1,
      },
    ],
  };

  const result = placeBoardPackage(source, {
    existingElements: [],
    existingSheets: [],
    pageSize: { width: 1_000, height: 800 },
    position: { x: 0, y: 0 },
    createId: sequentialIds(),
  });
  const top = result.importedElements.find((element) => element.content === "Top")!;
  const bottom = result.importedElements.find(
    (element) => element.content === "Bottom",
  )!;

  assert.ok(top.zIndex > bottom.zIndex);
});
