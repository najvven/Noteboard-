import assert from "node:assert/strict";
import test from "node:test";
import { createWorkbookDocument } from "../src/features/spreadsheet/workbook";
import {
  gridObjectSize,
  fitGridObjectSize,
  snapGridObjectSize,
  spreadsheetMode,
  SPREADSHEET_BORDER,
  SPREADSHEET_COLUMN_HEADER_HEIGHT,
  SPREADSHEET_ROW_HEADER_WIDTH,
} from "../src/features/spreadsheet/grid-geometry";

test("full grid bounds include headers and border", () => {
  const document = createWorkbookDocument();
  const sheet = document.workbook.sheets!["sheet-1"];
  sheet.rowCount = 3;
  sheet.columnCount = 3;

  assert.deepEqual(gridObjectSize(document), {
    width: SPREADSHEET_BORDER + SPREADSHEET_ROW_HEADER_WIDTH + 3 * 100,
    height: SPREADSHEET_BORDER + SPREADSHEET_COLUMN_HEADER_HEIGHT + 3 * 24,
  });
});

test("custom and hidden dimensions affect bounds without changing other axes", () => {
  const document = createWorkbookDocument();
  const sheet = document.workbook.sheets!["sheet-1"];
  sheet.rowCount = 3;
  sheet.columnCount = 3;
  sheet.columnData = {
    1: { w: 150 },
    2: { w: 500, hd: 1 },
  };
  sheet.rowData = {
    0: { h: 36 },
    2: { ah: 48 },
  };

  assert.deepEqual(gridObjectSize(document), {
    width: SPREADSHEET_BORDER + SPREADSHEET_ROW_HEADER_WIDTH + 250,
    height: SPREADSHEET_BORDER + SPREADSHEET_COLUMN_HEADER_HEIGHT + 108,
  });
});

test("row auto-height follows Univer ia and accepts small manual dimensions", () => {
  const document = createWorkbookDocument();
  const sheet = document.workbook.sheets!["sheet-1"];
  sheet.rowCount = 3;
  sheet.columnCount = 1;
  sheet.rowData = {
    0: { h: 5 },
    1: { h: 30, ah: 50, ia: 0 },
    2: { h: 30, ah: 8, ia: 1 },
  };

  assert.equal(gridObjectSize(document).height, 22 + 5 + 30 + 8);
});

test("fit preserves sparse variable dimensions and selects a closest bounded grid", () => {
  const document = createWorkbookDocument();
  const sheet = document.workbook.sheets!["sheet-1"];
  sheet.rowCount = 10;
  sheet.columnCount = 4;
  sheet.columnData = { 1: { w: 200 }, 3: { hd: 1 } };
  sheet.rowData = { 0: { h: 5 }, 1: { h: 35 } };

  assert.deepEqual(fitGridObjectSize(document, 450, 65), {
    width: 448,
    height: 62,
    rows: 2,
    columns: 4,
  });
  assert.deepEqual(fitGridObjectSize(document, 100_000_000, 100_000_000), {
    width: 48 + 16_384 * 100,
    height: 22 + 1_048_576 * 24 - 8,
    rows: 1_048_576,
    columns: 16_384,
  });
});

test("fit preserves current counts when hidden trailing dimensions give the same bounds", () => {
  const document = createWorkbookDocument();
  const sheet = document.workbook.sheets!["sheet-1"];
  sheet.rowCount = 3;
  sheet.columnCount = 3;
  sheet.columnData = { 1: { hd: 1 }, 2: { hd: 1 } };
  sheet.rowData = { 1: { hd: 1 }, 2: { hd: 1 } };
  const current = gridObjectSize(document);

  assert.deepEqual(fitGridObjectSize(document, current.width, current.height), {
    ...current,
    rows: 3,
    columns: 3,
  });
  assert.deepEqual(
    fitGridObjectSize(document, current.width + 100, current.height),
    { width: current.width + 100, height: current.height, rows: 3, columns: 4 },
  );
});

test("snap quantizes both axes after accounting for headings", () => {
  assert.deepEqual(
    snapGridObjectSize(46 + 2 + 252, 20 + 2 + 61, { width: 100, height: 24 }),
    { width: 348, height: 94, rows: 3, columns: 3 },
  );
  assert.deepEqual(
    snapGridObjectSize(
      46 + 2 + 252,
      20 + 2 + 61,
      { width: 100, height: 24 },
      { rounding: "floor" },
    ),
    { width: 248, height: 70, rows: 2, columns: 2 },
  );
});

test("snap enforces one cell minimum and worksheet dimension limits", () => {
  assert.deepEqual(snapGridObjectSize(-500, -500, { width: 100, height: 24 }), {
    width: 148,
    height: 46,
    rows: 1,
    columns: 1,
  });
  const maximum = snapGridObjectSize(Number.MAX_VALUE, Number.MAX_VALUE, {
    width: 20,
    height: 12,
  });
  assert.deepEqual(maximum, {
    width: 48 + 16_384 * 20,
    height: 22 + 1_048_576 * 12,
    rows: 1_048_576,
    columns: 16_384,
  });
});

test("mode defaults to advanced unless explicitly simple", () => {
  const document = createWorkbookDocument();
  assert.equal(spreadsheetMode(document), "advanced");
  assert.equal(
    spreadsheetMode({ ...document, mode: "simple" } as typeof document),
    "simple",
  );
  assert.equal(spreadsheetMode(null), "advanced");
});
