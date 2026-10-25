import {
  activeWorkbookSheet,
  normalizeCellSize,
  type WorkbookDocument,
} from "./workbook";

export const SPREADSHEET_ROW_HEADER_WIDTH = 46;
export const SPREADSHEET_COLUMN_HEADER_HEIGHT = 20;
export const SPREADSHEET_BORDER = 2;

export type SpreadsheetMode = "advanced" | "simple";

export function spreadsheetMode(
  document: WorkbookDocument | null,
): SpreadsheetMode {
  return (document as (WorkbookDocument & { mode?: string }) | null)?.mode ===
    "simple"
    ? "simple"
    : "advanced";
}

const MAX_ROWS = 1_048_576;
const MAX_COLUMNS = 16_384;

function finiteCount(value: unknown, maximum: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.max(1, Math.min(maximum, Math.floor(value)))
    : 1;
}

function positiveSize(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}

/** Full sheet bounds at 100% zoom, including row/column headings and border. */
export function gridObjectSize(document: WorkbookDocument | null) {
  const sheet = activeWorkbookSheet(document);
  if (!sheet) return { width: SPREADSHEET_BORDER, height: SPREADSHEET_BORDER };

  const columns = finiteCount(sheet.columnCount, MAX_COLUMNS);
  const rows = finiteCount(sheet.rowCount, MAX_ROWS);
  const defaultColumnWidth = positiveSize(sheet.defaultColumnWidth, 100);
  const defaultRowHeight = positiveSize(sheet.defaultRowHeight, 24);
  let width = columns * defaultColumnWidth;
  let height = rows * defaultRowHeight;

  // Worksheet metadata is sparse, so account for custom and hidden dimensions
  // without walking every row or column in a potentially million-cell axis.
  for (const [key, column] of Object.entries(sheet.columnData ?? {})) {
    const index = Number(key);
    if (!column || !Number.isInteger(index) || index < 0 || index >= columns)
      continue;
    if (column.hd === 1) width -= defaultColumnWidth;
    else if (
      typeof column.w === "number" &&
      Number.isFinite(column.w) &&
      column.w > 0
    )
      width += column.w - defaultColumnWidth;
  }
  for (const [key, row] of Object.entries(sheet.rowData ?? {})) {
    const index = Number(key);
    if (!row || !Number.isInteger(index) || index < 0 || index >= rows)
      continue;
    if (row.hd === 1) height -= defaultRowHeight;
    else {
      const useAutoHeight =
        row.ia !== 0 &&
        typeof row.ah === "number" &&
        Number.isFinite(row.ah) &&
        row.ah > 0;
      const customHeight = useAutoHeight ? row.ah : row.h;
      if (
        typeof customHeight === "number" &&
        Number.isFinite(customHeight) &&
        customHeight > 0
      )
        height += customHeight - defaultRowHeight;
    }
  }

  return {
    width:
      SPREADSHEET_BORDER +
      (sheet.rowHeader?.hidden === 1
        ? 0
        : positiveSize(sheet.rowHeader?.width, SPREADSHEET_ROW_HEADER_WIDTH)) +
      width,
    height:
      SPREADSHEET_BORDER +
      (sheet.columnHeader?.hidden === 1
        ? 0
        : positiveSize(
            sheet.columnHeader?.height,
            SPREADSHEET_COLUMN_HEADER_HEIGHT,
          )) +
      height,
  };
}

/** Fit visible row/column counts as closely as possible to a requested bounds. */
export function fitGridObjectSize(
  document: WorkbookDocument | null,
  width: number,
  height: number,
) {
  const sheet = activeWorkbookSheet(document);
  if (!sheet)
    return snapGridObjectSize(width, height, { width: 100, height: 24 });

  const sizeFor = (rows: number, columns: number) => {
    const sheetCopy = { ...sheet, rowCount: rows, columnCount: columns };
    const sheets = { ...document!.workbook.sheets, [sheet.id]: sheetCopy };
    return gridObjectSize({
      ...document!,
      workbook: { ...document!.workbook, sheets },
      activeSheetId: sheet.id,
    });
  };
  const nearestCount = (
    maximum: number,
    requested: number,
    preferredCount: unknown,
    extent: (count: number) => number,
  ) => {
    const target = Number.isFinite(requested) ? requested : extent(1);
    let low = 1;
    let high = maximum;
    const maximumExtent = extent(maximum);
    const searchTarget = Math.min(target, maximumExtent);
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (extent(middle) < searchTarget) low = middle + 1;
      else high = middle;
    }
    const above = low;
    const below = Math.max(1, above - 1);
    const nearest = target >= maximumExtent
      ? above
      : Math.abs(extent(below) - target) <= Math.abs(extent(above) - target)
        ? below
        : above;
    const preferred = finiteCount(preferredCount, maximum);
    return Math.abs(extent(preferred) - target) <= Math.abs(extent(nearest) - target)
      ? preferred
      : nearest;
  };

  const columns = nearestCount(
    MAX_COLUMNS,
    width,
    sheet.columnCount,
    (count) => sizeFor(1, count).width,
  );
  const rows = nearestCount(
    MAX_ROWS,
    height,
    sheet.rowCount,
    (count) => sizeFor(count, columns).height,
  );
  return { ...sizeFor(rows, columns), rows, columns };
}

export function snapGridObjectSize(
  width: number,
  height: number,
  cellSize: { width: number; height: number },
  options: { rounding?: "nearest" | "floor" } = {},
) {
  const size = normalizeCellSize(cellSize.width, cellSize.height);
  const rounding = options.rounding ?? "nearest";
  const count = (
    extent: number,
    inset: number,
    step: number,
    maximum: number,
  ) => {
    const available = Number.isFinite(extent) ? extent - inset : step;
    const raw = available / step;
    const quantized = rounding === "floor" ? Math.floor(raw) : Math.round(raw);
    return Math.max(
      1,
      Math.min(maximum, Number.isFinite(quantized) ? quantized : 1),
    );
  };
  const columns = count(
    width,
    SPREADSHEET_BORDER + SPREADSHEET_ROW_HEADER_WIDTH,
    size.width,
    MAX_COLUMNS,
  );
  const rows = count(
    height,
    SPREADSHEET_BORDER + SPREADSHEET_COLUMN_HEADER_HEIGHT,
    size.height,
    MAX_ROWS,
  );
  return {
    width:
      SPREADSHEET_BORDER + SPREADSHEET_ROW_HEADER_WIDTH + columns * size.width,
    height:
      SPREADSHEET_BORDER +
      SPREADSHEET_COLUMN_HEADER_HEIGHT +
      rows * size.height,
    rows,
    columns,
  };
}
