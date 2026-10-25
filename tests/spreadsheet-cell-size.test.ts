import assert from "node:assert/strict";
import test from "node:test";
import {
  createWorkbookDocument,
  parseWorkbookDocument,
  workbookCellSize,
  withWorkbookCellSize,
} from "../src/features/spreadsheet/workbook";

test('invalid spreadsheet data is not replaced by a blank workbook during resizing',()=>{
  assert.throws(()=>withWorkbookCellSize('unrecognized workbook',80,28),/Invalid spreadsheet data/);
  const workbook=createWorkbookDocument('Imported',[[7]],{width:140,height:32});workbook.activeSheetId='missing';
  assert.deepEqual(workbookCellSize(workbook),{width:140,height:32});
  const changed=parseWorkbookDocument(withWorkbookCellSize(JSON.stringify(workbook),80,28))!;
  assert.equal(changed.activeSheetId,'sheet-1');assert.equal(changed.workbook.sheets!['sheet-1'].cellData[0][0].v,7);
});

test("workbook cell sizing keeps values, formulas, formatting and row visibility independent", () => {
  const first = createWorkbookDocument("First", [[12, "=A1*2"]], {
    width: 80,
    height: 28,
  });
  const sheet = first.workbook.sheets!["sheet-1"];
  sheet.columnData = { 0: { w: 160, hd: 1 } };
  sheet.rowData = { 0: { h: 40, hd: 1 } };
  sheet.cellData[0][0].s = { bl: 1 };
  const original = JSON.stringify(first),
    changed = parseWorkbookDocument(withWorkbookCellSize(original, 120, 32))!;
  assert.deepEqual(workbookCellSize(changed), { width: 120, height: 32 });
  assert.equal(changed.workbook.sheets!["sheet-1"].columnData![0].hd, 1);
  assert.equal(changed.workbook.sheets!["sheet-1"].rowData![0].hd, 1);
  assert.deepEqual(
    changed.workbook.sheets!["sheet-1"].cellData[0],
    sheet.cellData[0],
  );
  assert.equal(JSON.stringify(first), original);
  assert.deepEqual(workbookCellSize(createWorkbookDocument("Second")), {
    width: 100,
    height: 24,
  });
});
