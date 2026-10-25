import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createSimpleWorkbook,
  resizeSimpleWorkbook,
} from "../src/features/spreadsheet/simple-workbook";
import {
  parseWorkbookDocument,
  withWorkbookCellSize,
} from "../src/features/spreadsheet/workbook";
import { fitSimpleGridSize, gridObjectSize } from "../src/features/spreadsheet/grid-geometry";

test("finite sheets contain exactly their displayed rows/columns and explicit headers", () => {
  const doc = createSimpleWorkbook(348, 142, { width: 100, height: 24 });
  assert.equal(doc.mode, "simple");
  assert.deepEqual(gridObjectSize(doc), { width: 348, height: 142 });
  const sheet = doc.workbook.sheets!["sheet-1"];
  assert.equal(sheet.rowCount, 5);
  assert.equal(sheet.columnCount, 3);
  assert.deepEqual(sheet.rowHeader, { width: 46 });
  assert.deepEqual(sheet.columnHeader, { height: 20 });
  const resized = parseWorkbookDocument(
    withWorkbookCellSize(JSON.stringify(doc), 80, 30),
  )!;
  assert.deepEqual(gridObjectSize(resized), { width: 288, height: 172 });
  assert.equal(resized.mode, "simple");
});

test("shrinking a finite sheet trims outside cells/merges while the original undo snapshot stays intact", () => {
  const doc = createSimpleWorkbook(348, 142, { width: 100, height: 24 });
  const sheet = doc.workbook.sheets!["sheet-1"];
  sheet.cellData = {
    0: { 0: { v: "kept" }, 2: { v: "removed column" } },
    4: { 0: { v: "removed row" } },
  };
  sheet.mergeData = [{ startRow: 0, endRow: 4, startColumn: 0, endColumn: 2 }];
  const original = JSON.stringify(doc),
    result = resizeSimpleWorkbook(original, 248, 70),
    resized = parseWorkbookDocument(result.content)!;
  assert.deepEqual(result.size, { width: 248, height: 70 });
  assert.equal(resized.workbook.sheets!["sheet-1"].rowCount, 2);
  assert.equal(resized.workbook.sheets!["sheet-1"].cellData[0][0].v, "kept");
  assert.equal(resized.workbook.sheets!["sheet-1"].cellData[0][2], undefined);
  assert.equal(resized.workbook.sheets!["sheet-1"].cellData[4], undefined);
  assert.equal(JSON.stringify(doc), original);
  assert.deepEqual(resized.workbook.sheets!["sheet-1"].mergeData, [
    { startRow: 0, endRow: 1, startColumn: 0, endColumn: 1 },
  ]);
});

test("simple placement floors whole cells within board bounds and rejects sub-cell surfaces",()=>{
  assert.deepEqual(fitSimpleGridSize(248,46,{width:100,height:24}),{
    width:248,height:46,rows:1,columns:2,
  });
  assert.deepEqual(fitSimpleGridSize(247,46,{width:100,height:24}),{
    width:148,height:46,rows:1,columns:1,
  });
  assert.equal(fitSimpleGridSize(147,46,{width:100,height:24}),null);
  assert.equal(fitSimpleGridSize(248,45,{width:100,height:24}),null);
});
