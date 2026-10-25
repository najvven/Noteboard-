import assert from "node:assert/strict";
import test from "node:test";
import {
  createUniqueSheetNames,
  createWorkbookDocument,
  parseWorkbookDocument,
  readLiveWorkbookSnapshots,
  renameFormulaSheetReferences,
  workbookCellDimensionsMatch,
  upgradeLegacyWorkbooks,
} from "../src/features/spreadsheet/workbook";

test("formula sheet renaming updates both 3D endpoints and keeps string literals", () => {
  const names = createUniqueSheetNames(
    ["Sheet1", "Sheet3", "Sheet 1", "Sheet 3", "O'Brien"],
    ["sheet1", "sheet3", "Sheet 1", "Sheet 3", "O'Brien"],
  );
  assert.equal(names.get("sheet1"), "Sheet1 2");
  assert.equal(names.get("sheet3"), "Sheet3 2");
  assert.equal(names.get("sheet 1"), "Sheet 1 2");
  assert.equal(names.get("o'brien"), "O'Brien 2");
  const formula =
    '=SUM(Sheet1:Sheet3!A1)+SUM(\'Sheet 1:Sheet 3\'!B2)+\'O\'\'Brien\'!C1+"Sheet1:Sheet3!A1"+"said ""Sheet3!"""';
  assert.equal(
    renameFormulaSheetReferences(formula, names),
    '=SUM(\'Sheet1 2:Sheet3 2\'!A1)+SUM(\'Sheet 1 2:Sheet 3 2\'!B2)+\'O\'\'Brien 2\'!C1+"Sheet1:Sheet3!A1"+"said ""Sheet3!"""',
  );
});

test("formula sheet renaming terminates on a long malformed apostrophe run", () => {
  const formula = "'" + "''".repeat(12_000);
  assert.equal(renameFormulaSheetReferences(formula, new Map([["sheet1", "Renamed"]])), formula);
});

test("uniform cell dimensions account for overrides and auto-height rows", () => {
  const size = { width: 100, height: 24 };
  assert.equal(workbookCellDimensionsMatch({ defaultColumnWidth: 100, defaultRowHeight: 24 }, size), true);
  assert.equal(workbookCellDimensionsMatch({
    defaultColumnWidth: 100, defaultRowHeight: 24, columnData: { 1: { w: 200 } },
  }, size), false);
  assert.equal(workbookCellDimensionsMatch({
    defaultColumnWidth: 100, defaultRowHeight: 24, rowData: { 1: { h: 48 } },
  }, size), false);
  assert.equal(workbookCellDimensionsMatch({
    defaultColumnWidth: 100, defaultRowHeight: 24, rowData: { 1: { h: 24, ia: 1 } },
  }, size), false);
});

test("a not-ready spreadsheet bridge cannot replace workbook history with an empty snapshot", () => {
  const original = createWorkbookDocument("Saved", [[7]]);
  const content = JSON.stringify(original);
  const element = {
    id: "live-sheet", type: "table" as const, content,
    position: {x: 0, y: 0}, size: {width: 300, height: 200}, zIndex: 1,
  };
  let ready = false;
  let value = "";
  const frame = {
    dataset: {spreadsheetElementId: element.id, spreadsheetReadonly: "false"},
    contentWindow: {noteboardSheet: {
      isReady: () => ready,
      historySnapshot: () => value,
      snapshot: () => value,
    }},
  };
  const previous = Object.getOwnPropertyDescriptor(globalThis, "document");
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: {querySelectorAll: () => [frame]},
  });
  try {
    assert.deepEqual(readLiveWorkbookSnapshots([element], true), [element]);
    ready = true;
    assert.deepEqual(readLiveWorkbookSnapshots([element], true), [element]);
    value = content;
    assert.equal(readLiveWorkbookSnapshots([element], true)[0].content, content);
  } finally {
    if (previous) Object.defineProperty(globalThis, "document", previous);
    else delete (globalThis as any).document;
  }
});

test("workbook parser rejects malformed nested sheet data before Univer initialization", () => {
  const valid = createWorkbookDocument("Legacy", [[7, "=A1*2"]]);
  const serialized = JSON.stringify(valid);
  assert.equal(parseWorkbookDocument(serialized)?.mode, undefined);

  const simple = createWorkbookDocument("Simple", [[7]]);
  simple.mode = "simple";
  assert.equal(parseWorkbookDocument(JSON.stringify(simple))?.mode, "simple");

  const invalid = createWorkbookDocument("Invalid", [[7]]);
  const sheet = invalid.workbook.sheets!["sheet-1"] as any;
  sheet.rowData = [];
  assert.equal(parseWorkbookDocument(JSON.stringify(invalid)), null);

  sheet.rowData = { 0: { h: "tall" } };
  assert.equal(parseWorkbookDocument(JSON.stringify(invalid)), null);

  sheet.rowData = {};
  sheet.cellData = [];
  assert.equal(parseWorkbookDocument(JSON.stringify(invalid)), null);

  sheet.cellData = null;
  assert.equal(parseWorkbookDocument(JSON.stringify(invalid)), null);

  sheet.cellData = { 0: { 0: { p: { body: { dataStream: {} } } } } };
  assert.equal(parseWorkbookDocument(JSON.stringify(invalid)), null);

  sheet.cellData = {};
  sheet.mergeData = [{ startRow: 0, endRow: 1000, startColumn: 0, endColumn: 0 }];
  assert.equal(parseWorkbookDocument(JSON.stringify(invalid)), null);

  const oversizedMerge = createWorkbookDocument("Oversized merge", []);
  const oversizedSheet = oversizedMerge.workbook.sheets!["sheet-1"];
  oversizedSheet.rowCount = 1000;
  oversizedSheet.columnCount = 300;
  oversizedSheet.mergeData = [{ startRow: 0, endRow: 999, startColumn: 0, endColumn: 200 }];
  assert.equal(parseWorkbookDocument(JSON.stringify(oversizedMerge)), null);
});

test("legacy rich-text conversion handles unmatched tags linearly and preserves basic text semantics", () => {
  const content = "<".repeat(50_000);
  const element = { id: "cell", type: "section" as const, position: { x: 0, y: 0 }, size: { width: 100, height: 30 }, content, zIndex: 1 };
  const sheet = { id: "legacy", name: "Legacy", cellIds: [["cell"]], columnOrder: [], columns: {}, rowOrder: [], rows: {} } as any;
  const [table] = upgradeLegacyWorkbooks([element], [sheet]);
  const document = parseWorkbookDocument(table.content)!;
  assert.equal(document.workbook.sheets!["sheet-1"].cellData[0][0].v, content);

  const html = { ...element, content: "before<br/>after &amp;lt;" };
  const [converted] = upgradeLegacyWorkbooks([html], [{ ...sheet, cellIds: [["cell"]] }]);
  const result = parseWorkbookDocument(converted.content)!.workbook.sheets!["sheet-1"].cellData[0][0].v;
  assert.equal(result, "before\nafter &lt;");
});

test("legacy conversion rejects repeated cell references before duplicating workbook content", () => {
  const element = { id: "cell", type: "section" as const, position: { x: 0, y: 0 }, size: { width: 100, height: 30 }, content: "x".repeat(2048), zIndex: 1 };
  const sheet = { id: "legacy", name: "Legacy", cellIds: [["cell", "cell"]], columnOrder: [], columns: {}, rowOrder: [], rows: {} } as any;
  assert.throws(() => upgradeLegacyWorkbooks([element], [sheet]), /referenced more than once/);
});

test("legacy sheet migration keeps alignment and all four cell borders", () => {
  const element = { id: "cell", type: "section" as const, position: { x: 0, y: 0 }, size: { width: 100, height: 30 }, content: "value", textAlign: "right" as const, borderColor: "#123456", borderWidth: 2, zIndex: 1 };
  const sheet = { id: "legacy", name: "Legacy", cellIds: [["cell"]], columnOrder: [], columns: {}, rowOrder: [], rows: {} } as any;
  const [table] = upgradeLegacyWorkbooks([element], [sheet]);
  const cell = parseWorkbookDocument(table.content)!.workbook.sheets!["sheet-1"].cellData[0][0];
  const style = cell.s as any;
  assert.equal(style.ht, 3);
  for (const edge of ["t", "r", "b", "l"]) {
    assert.equal(style.bd[edge].s, 8);
    assert.equal(style.bd[edge].cl.rgb, "#123456");
  }
});
