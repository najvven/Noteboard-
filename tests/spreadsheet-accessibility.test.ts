import assert from "node:assert/strict";
import test from "node:test";

import {
  parseSectionSheetAddress,
  shouldNavigateSpreadsheetCell,
} from "../src/features/spreadsheet/accessibility";

test("spreadsheet addresses expose one-based ARIA coordinates", () => {
  assert.deepEqual(parseSectionSheetAddress("A1"), { row: 1, column: 1 });
  assert.deepEqual(parseSectionSheetAddress("AA12"), { row: 12, column: 27 });
  assert.equal(parseSectionSheetAddress("bad"), undefined);
});

test("arrow navigation preserves caret editing until a horizontal boundary", () => {
  assert.equal(shouldNavigateSpreadsheetCell("ArrowLeft", 5, 2, true), false);
  assert.equal(shouldNavigateSpreadsheetCell("ArrowRight", 5, 2, true), false);
  assert.equal(shouldNavigateSpreadsheetCell("ArrowLeft", 5, 0, true), true);
  assert.equal(shouldNavigateSpreadsheetCell("ArrowRight", 5, 5, true), true);
  assert.equal(shouldNavigateSpreadsheetCell("ArrowDown", 5, 5, true), false);
  assert.equal(shouldNavigateSpreadsheetCell("ArrowDown", 0, 0, true), true);
  assert.equal(shouldNavigateSpreadsheetCell("Tab", 5, 2, true), true);
  assert.equal(shouldNavigateSpreadsheetCell("Enter", 5, 2, true), true);
});
