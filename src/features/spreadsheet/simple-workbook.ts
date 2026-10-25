import {
  activeWorkbookSheet,
  createWorkbookDocument,
  parseWorkbookDocument,
  type WorkbookDocument,
} from "./workbook";
import {
  gridObjectSize,
  snapGridObjectSize,
  fitGridObjectSize,
  SPREADSHEET_COLUMN_HEADER_HEIGHT,
  SPREADSHEET_ROW_HEADER_WIDTH,
} from "./grid-geometry";

/** A simple sheet contains exactly the cells visible on the board. */
export function createSimpleWorkbook(
  width: number,
  height: number,
  cellSize: { width: number; height: number },
) {
  const document = createWorkbookDocument("Spreadsheet", [], cellSize);
  document.mode = "simple";
  const size = snapGridObjectSize(width, height, cellSize);
  const sheet = activeWorkbookSheet(document)!;
  sheet.rowCount = size.rows;
  sheet.columnCount = size.columns;
  sheet.rowHeader = { width: SPREADSHEET_ROW_HEADER_WIDTH };
  sheet.columnHeader = { height: SPREADSHEET_COLUMN_HEADER_HEIGHT };
  sheet.zoomRatio = 1;
  return document;
}

export function resizeSimpleWorkbook(
  content: string,
  width: number,
  height: number,
) {
  const document = parseWorkbookDocument(content);
  if (!document || document.mode !== "simple")
    return { content, size: undefined };
  const sheet = activeWorkbookSheet(document)!;
  const size = fitGridObjectSize(document, width, height);
  if (sheet.rowCount === size.rows && sheet.columnCount === size.columns)
    return { content, size: gridObjectSize(document) };
  sheet.rowCount = size.rows;
  sheet.columnCount = size.columns;
  // Removed cells belong to the canvas Undo snapshot; they cannot remain as an
  // invisible second portion of a finite sheet.
  for (const [key, row] of Object.entries(sheet.cellData ?? {})) {
    if (Number(key) >= size.rows) {
      delete sheet.cellData[Number(key)];
      continue;
    }
    for (const column of Object.keys(row ?? {}))
      if (Number(column) >= size.columns) delete row[Number(column)];
  }
  for (const key of Object.keys(sheet.rowData ?? {}))
    if (Number(key) >= size.rows) delete sheet.rowData[Number(key)];
  for (const key of Object.keys(sheet.columnData ?? {}))
    if (Number(key) >= size.columns) delete sheet.columnData[Number(key)];
  sheet.mergeData = (sheet.mergeData ?? [])
    .filter(
      (range) => range.startRow < size.rows && range.startColumn < size.columns,
    )
    .map((range) => ({
      ...range,
      endRow: Math.min(range.endRow, size.rows - 1),
      endColumn: Math.min(range.endColumn, size.columns - 1),
    }));
  clearSimpleView(document);
  return { content: JSON.stringify(document), size: gridObjectSize(document) };
}

export function clearSimpleView(document: WorkbookDocument) {
  delete document.preview;
  delete document.previewViewport;
  delete document.views;
  const sheet = activeWorkbookSheet(document);
  if (sheet) {
    sheet.zoomRatio = 1;
    sheet.scrollLeft = 0;
    sheet.scrollTop = 0;
  }
}
