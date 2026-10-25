import assert from "node:assert/strict";
import test from "node:test";
import {
  createUniqueSheetNames,
  createWorkbookDocument,
  parseWorkbookDocument,
  renameFormulaSheetReferences,
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
});
