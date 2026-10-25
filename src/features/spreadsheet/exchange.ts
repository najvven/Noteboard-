import ExcelJS from "exceljs";
import JSZip from "jszip";
import type { ICellData, IStyleData, IWorksheetData } from "@univerjs/core";
import { assertSafeZipDirectory } from "../../../shared/zip-preflight.js";
import { getArchiveDeclaredSize } from "../../../shared/board-data.js";
import { assertZipExpansionWithinLimits } from "../../../shared/board-package-stream.js";
import {
  cellFromInput,
  createWorkbookDocument,
  type WorkbookDocument,
} from "./workbook";

const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const MAX_IMPORT_EXPANDED_BYTES = 128 * 1024 * 1024;
const MAX_CELLS = 200_000;
const MAX_ROWS = 1_048_576;
const MIN_COLUMNS = 26;
const MAX_COLUMNS = 16_384;
const borderNames = [
  "none",
  "thin",
  "hair",
  "dotted",
  "dashed",
  "dashDot",
  "dashDotDot",
  "double",
  "medium",
  "mediumDashed",
  "mediumDashDot",
  "mediumDashDotDot",
  "slantDashDot",
  "thick",
] as const;
const color = (value?: Partial<ExcelJS.Color>) =>
  value?.argb ? `#${value.argb.slice(-6)}` : undefined;
const argb = (value: unknown) =>
  typeof value === "string" && /^#[\da-f]{6}$/i.test(value)
    ? `FF${value.slice(1)}`
    : undefined;

// Univer stores dimensions in CSS pixels. ExcelJS stores row heights in points
// and column widths in the workbook's character-width unit.
const POINTS_PER_PIXEL = 0.75;
const EXCEL_COLUMN_PIXELS_PER_UNIT = 7;
const EXCEL_COLUMN_PIXEL_PADDING = 5;
const excelColumnWidthToPixels = (width: number) =>
  width * EXCEL_COLUMN_PIXELS_PER_UNIT + EXCEL_COLUMN_PIXEL_PADDING;
const pixelsToExcelColumnWidth = (width: number) =>
  Math.max(1, (width - EXCEL_COLUMN_PIXEL_PADDING) / EXCEL_COLUMN_PIXELS_PER_UNIT);

function fromStyle(style: Partial<ExcelJS.Style>): IStyleData {
  const result: IStyleData = {};
  if (style.font) {
    result.ff = style.font.name;
    result.fs = style.font.size;
    if (style.font.bold) result.bl = 1;
    if (style.font.italic) result.it = 1;
    if (style.font.underline) result.ul = { s: 1 };
    if (style.font.strike) result.st = { s: 1 };
    if (color(style.font.color)) result.cl = { rgb: color(style.font.color) };
  }
  if (style.fill?.type === "pattern" && color(style.fill.fgColor))
    result.bg = { rgb: color(style.fill.fgColor) };
  if (style.numFmt) result.n = { pattern: style.numFmt };
  if (style.alignment) {
    result.ht = (
      { left: 1, center: 2, right: 3, justify: 4, distributed: 6 } as const
    )[style.alignment.horizontal as "left"];
    result.vt = ({ top: 1, middle: 2, bottom: 3 } as const)[
      style.alignment.vertical as "top"
    ];
    if (style.alignment.wrapText) result.tb = 3;
  }
  for (const [source, dest] of [
    ["top", "t"],
    ["right", "r"],
    ["bottom", "b"],
    ["left", "l"],
  ] as const) {
    const border = style.border?.[source];
    if (!border?.style) continue;
    (result.bd ??= {})[dest] = {
      s: Math.max(0, borderNames.indexOf(border.style as any)),
      cl: { rgb: color(border.color) || "#000000" },
    };
  }
  return result;
}

function toStyle(style: IStyleData): Partial<ExcelJS.Style> {
  const value: Partial<ExcelJS.Style> = {
    font: {
      name: style.ff || "Arial",
      size: style.fs || 11,
      bold: style.bl === 1,
      italic: style.it === 1,
      underline: style.ul?.s === 1,
      strike: style.st?.s === 1,
      ...(argb((style.cl || {}).rgb)
        ? { color: { argb: argb((style.cl || {}).rgb) } }
        : {}),
    },
    alignment: {
      horizontal: (
        {
          1: "left",
          2: "center",
          3: "right",
          4: "justify",
          5: "justify",
          6: "distributed",
        } as const
      )[style.ht || 1],
      vertical: ({ 1: "top", 2: "middle", 3: "bottom" } as const)[
        style.vt || 3
      ],
      wrapText: style.tb === 3,
    },
  };
  if ((style.n || {}).pattern) value.numFmt = (style.n || {}).pattern;
  if (argb((style.bg || {}).rgb))
    value.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: argb((style.bg || {}).rgb) },
    };
  for (const [source, dest] of [
    ["t", "top"],
    ["r", "right"],
    ["b", "bottom"],
    ["l", "left"],
  ] as const) {
    const border = style.bd?.[source];
    if (!border?.s) continue;
    (value.border ??= {})[dest] = {
      style: borderNames[border.s] as ExcelJS.BorderStyle,
      color: { argb: argb(border.cl.rgb) || "FF000000" },
    };
  }
  return value;
}

/** RFC-style quoted rows; also accepts TSV and semicolon-separated spreadsheets. */
export function parseDelimited(text: string, separatorHint?: "," | ";" | "\t") {
  text = text.replace(/^\uFEFF/, "");
  const counts = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false;
  for (let i = 0; !separatorHint && i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') i++;
      else inQuotes = !inQuotes;
    } else if (!inQuotes) {
      if (ch === "\r" || ch === "\n") {
        // A one-cell heading does not describe the later rows' delimiter.
        if (counts[","] || counts[";"] || counts["\t"]) break;
        continue;
      }
      if (ch in counts) counts[ch as keyof typeof counts]++;
    }
  }
  const separator = separatorHint ?? (counts["\t"] ? "\t" : counts[";"] > counts[","] ? ";" : ",");
  const rows: string[][] = [],
    row: string[] = [];
  let cell = "",
    quoted = false,
    fieldStarted = false,
    count = 0;
  const finish = () => {
    if (++count > MAX_CELLS)
      throw Error("The file contains more than 200,000 cells.");
    row.push(cell);
    cell = "";
    fieldStarted = false;
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        fieldStarted = true;
        i++;
      } else if (quoted || cell === "") {
        quoted = !quoted;
        fieldStarted = true;
      } else {
        cell += ch;
        fieldStarted = true;
      }
    } else if (ch === separator && !quoted) finish();
    else if ((ch === "\n" || ch === "\r") && !quoted) {
      finish();
      rows.push(row.splice(0));
      if (ch === "\r" && text[i + 1] === "\n") i++;
    } else {
      cell += ch;
      fieldStarted = true;
    }
  }
  if (quoted) throw Error("The CSV file contains an unclosed quoted value.");
  if (fieldStarted || row.length) {
    finish();
    rows.push(row);
  }
  return rows;
}

const columnNumber = (letters: string) => {
  let result = 0;
  for (const char of letters.toUpperCase()) result = result * 26 + char.charCodeAt(0) - 64;
  return result;
};

function parseCellAddress(address: string) {
  const match = address.match(/^([A-Z]{1,3})(\d+)$/i);
  if (!match) throw Error("The workbook contains an invalid cell reference.");
  const column = columnNumber(match[1]);
  const row = Number(match[2]);
  if (
    column < 1 || column > MAX_COLUMNS || !Number.isSafeInteger(row) ||
    row < 1 || row > MAX_ROWS
  ) throw Error("The workbook contains an invalid cell reference.");
  return { row, column };
}

/** Validate column declarations and bound cells ExcelJS materializes for merges. */
async function assertWorkbookImportBudget(zip: JSZip) {
  let materializedCellBudget = 0;
  let totalRowRecordCount = 0;
  for (const [path, entry] of Object.entries(zip.files)) {
    if (entry.dir || !/^xl\/worksheets\/[^/]+\.xml$/i.test(path)) continue;
    const xml = await entry.async("string");
    let rowRecordCount = 0;
    const explicitRowIndexes = new Set<number>();
    const cellAddresses = new Set<string>();
    for (const match of xml.matchAll(/<(?:[\w.-]+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:[\w.-]+:)?row\s*>)/gi)) {
      const rowText = xmlAttributes(match[1]).get("r")?.trim();
      let rowNumber: number | undefined;
      if (rowText !== undefined) {
        rowNumber = /^\d+$/.test(rowText) ? Number(rowText) : NaN;
        if (!Number.isSafeInteger(rowNumber) || rowNumber < 1 || rowNumber > MAX_ROWS)
          throw Error("The workbook contains an invalid row reference.");
        if (explicitRowIndexes.has(rowNumber))
          throw Error("The workbook contains duplicate worksheet row references.");
        explicitRowIndexes.add(rowNumber);
      }
      rowRecordCount += 1;
      totalRowRecordCount += 1;
      if (rowRecordCount > MAX_ROWS)
        throw Error("The worksheet contains more than 1,048,576 row records.");
      if (totalRowRecordCount > MAX_CELLS)
        throw Error("The workbook contains more than 200,000 row records.");
      let previousAddress: { row: number; column: number } | undefined;
      for (const cellMatch of (match[2] ?? "").matchAll(/<(?:[\w.-]+:)?c\b([^>]*)\/?\s*>/gi)) {
        const address = xmlAttributes(cellMatch[1]).get("r")?.trim();
        let cellAddress: { row: number; column: number };
        if (address !== undefined) {
          cellAddress = parseCellAddress(address);
          if (rowNumber !== undefined && cellAddress.row !== rowNumber)
            throw Error("The workbook contains a cell reference that does not match its worksheet row.");
        } else {
          if (!previousAddress)
            throw Error("The workbook contains a cell without a reference before any explicit cell reference.");
          cellAddress = { row: previousAddress.row, column: previousAddress.column + 1 };
          if (cellAddress.column > MAX_COLUMNS)
            throw Error("The workbook contains an invalid cell reference.");
        }
        const key = `${cellAddress.row}:${cellAddress.column}`;
        if (cellAddresses.has(key))
          throw Error("The workbook contains duplicate cell references.");
        cellAddresses.add(key);
        previousAddress = cellAddress;
      }
    }
    for (const match of xml.matchAll(/<(?:[\w.-]+:)?c\b([^>]*)\/?\s*>/gi)) {
      materializedCellBudget += 1;
      const address = xmlAttributes(match[1]).get("r");
      if (address !== undefined) parseCellAddress(address.trim());
    }
    for (const match of xml.matchAll(/<(?:[\w.-]+:)?col\b([^>]*)\/?\s*>/gi)) {
      const attributes = xmlAttributes(match[1]);
      const minText = attributes.get("min")?.trim();
      const maxText = attributes.get("max")?.trim();
      const min = minText !== undefined && /^\d+$/.test(minText) ? Number(minText) : NaN;
      const max = maxText !== undefined && /^\d+$/.test(maxText) ? Number(maxText) : NaN;
      if (
        !Number.isSafeInteger(min) || !Number.isSafeInteger(max) ||
        min < 1 || max < min || max > MAX_COLUMNS
      ) throw Error("The workbook contains invalid column definitions.");
    }
    for (const match of xml.matchAll(/<(?:[\w.-]+:)?mergeCell\b[^>]*\bref=(?:"([^"]+)"|'([^']+)')[^>]*\/?\s*>/gi)) {
      const range = (match[1] ?? match[2]).match(/^\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?$/i);
      if (!range) throw Error("The workbook contains an invalid merged range.");
      const startColumn = columnNumber(range[1]);
      const startRow = Number(range[2]);
      const endColumn = range[3] ? columnNumber(range[3]) : startColumn;
      const endRow = range[4] ? Number(range[4]) : startRow;
      if (
        startColumn < 1 || endColumn < startColumn || endColumn > MAX_COLUMNS ||
        startRow < 1 || endRow < startRow || endRow > MAX_ROWS
      ) throw Error("The workbook contains an invalid merged range.");
      materializedCellBudget += (endColumn - startColumn + 1) * (endRow - startRow + 1);
      if (materializedCellBudget > MAX_CELLS)
        throw Error("The workbook contains merged ranges exceeding the 200,000 cell limit.");
    }
    if (materializedCellBudget > MAX_CELLS)
      throw Error("The workbook contains more than 200,000 cells.");
  }
}

const xmlAttributes = (source: string) => {
  const attributes = new Map<string, string>();
  for (const match of source.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
    attributes.set(match[1], match[2] ?? match[3] ?? "");
  return attributes;
};

async function readEmptyFormulaCacheCells(zip: JSZip) {
  const emptyCellsByPath = new Map<string, Set<string>>();
  const workbook = zip.file("xl/workbook.xml");
  const relationships = zip.file("xl/_rels/workbook.xml.rels");
  if (!workbook || !relationships) return { emptyCellsByPath, orderedPaths: [] as string[] };
  const [workbookXml, relationshipsXml] = await Promise.all([
    workbook.async("string"),
    relationships.async("string"),
  ]);
  const targetsById = new Map<string, string>();
  for (const match of relationshipsXml.matchAll(/<(?:[\w.-]+:)?Relationship\b([^>]*)\/?\s*>/gi)) {
    const attributes = xmlAttributes(match[1]);
    if (attributes.has("Id") && attributes.has("Target"))
      targetsById.set(attributes.get("Id")!, attributes.get("Target")!);
  }
  const orderedPaths: string[] = [];
  for (const match of workbookXml.matchAll(/<(?:[\w.-]+:)?sheet\b([^>]*)\/?\s*>/gi)) {
    const relationshipId = xmlAttributes(match[1]).get("r:id");
    const target = relationshipId ? targetsById.get(relationshipId) : undefined;
    if (!target) continue;
    const segments: string[] = [];
    for (const segment of (target.startsWith("/") ? target.slice(1) : `xl/${target}`).split("/")) {
      if (!segment || segment === ".") continue;
      if (segment === "..") segments.pop();
      else segments.push(segment);
    }
    const path = segments.join("/");
    orderedPaths.push(/^xl\/worksheets\/[^/]+\.xml$/i.test(path) ? path : "");
  }
  for (const path of orderedPaths) {
    if (!path) continue;
    const entry = zip.file(path);
    if (!entry) continue;
    const xml = await entry.async("string");
    const cells = new Set<string>();
    let cursor = 0;
    while (cursor < xml.length) {
      const start = xml.indexOf("<c", cursor);
      if (start < 0) break;
      const afterName = xml[start + 2];
      if (afterName && !/[\s/>]/.test(afterName)) {
        cursor = start + 2;
        continue;
      }
      const openEnd = xml.indexOf(">", start + 2);
      if (openEnd < 0) break;
      const close = xml.indexOf("</c>", openEnd + 1);
      if (close < 0) break;
      const attributes = xmlAttributes(xml.slice(start + 2, openEnd));
      const body = xml.slice(openEnd + 1, close);
      const address = attributes.get("r");
      if (
        address && attributes.get("t") === "str" &&
        /<(?:[\w.-]+:)?f\b/.test(body) &&
        /<(?:[\w.-]+:)?v(?:\s[^>]*)?>\s*<\/(?:[\w.-]+:)?v\s*>/i.test(body)
      ) cells.add(address);
      cursor = close + 4;
    }
    emptyCellsByPath.set(path, cells);
  }
  return { emptyCellsByPath, orderedPaths };
}

const csvCell = (cell: ICellData | undefined) => {
  const richText = (cell?.p || {})?.body?.dataStream?.replace(/\r\n$/, "");
  let value: unknown = cell?.v ?? richText ?? "";
  let literalText = cell?.t === 1 || cell?.t === 4 || typeof cell?.v === "string" || typeof richText === "string";
  if (cell?.f && cell.v === undefined) {
    value = cell.f;
    literalText = true;
  }
  let raw = String(value ?? "");
  if (literalText && (raw.startsWith("'") || /^[\s\uFEFF]*[=+\-@]/.test(raw)))
    raw = `'${raw}`;
  return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
};

export async function importSpreadsheet(
  bytes: ArrayBuffer,
  name: string,
): Promise<{ document: WorkbookDocument; warnings: string[] }> {
  if (bytes.byteLength > MAX_IMPORT_BYTES)
    throw Error("Spreadsheet files can be up to 20 MB.");
  if (/\.(csv|tsv)$/i.test(name))
    return {
      document: createWorkbookDocument(
        name.replace(/\.[^.]+$/, ""),
        parseDelimited(new TextDecoder().decode(bytes), /\.tsv$/i.test(name) ? "\t" : undefined),
      ),
      warnings: [],
    };
  if (!/\.xlsx$/i.test(name)) throw Error("Choose an XLSX, CSV or TSV file.");
  assertSafeZipDirectory(new Uint8Array(bytes));
  const zip = await JSZip.loadAsync(bytes);
  if (getArchiveDeclaredSize(zip.files) > MAX_IMPORT_EXPANDED_BYTES)
    throw Error("The expanded workbook exceeds 128 MB.");
  await assertZipExpansionWithinLimits(Object.values(zip.files), {
    maxEntryBytes: MAX_IMPORT_EXPANDED_BYTES,
    maxArchiveBytes: MAX_IMPORT_EXPANDED_BYTES,
    archiveLabel: "Expanded workbook",
  });
  await assertWorkbookImportBudget(zip);
  const warnings: string[] = [];
  if (
    Object.keys(zip.files).some((path) =>
      /^xl\/(charts|drawings|pivotTables)\//.test(path),
    )
  )
    warnings.push("Charts, drawings and pivot tables are not imported.");
  const emptyFormulaCache = await readEmptyFormulaCacheCells(zip);
  const source = new ExcelJS.Workbook();
  await source.xlsx.load(bytes);
  const document = createWorkbookDocument(name.replace(/\.xlsx$/i, ""));
  document.workbook.sheetOrder = [];
  document.workbook.sheets = {};
  let count = 0;
  let worksheetIndex = 0;
  source.eachSheet((worksheet) => {
    const worksheetPath = emptyFormulaCache.orderedPaths[worksheetIndex++];
    const emptyFormulaCells = worksheetPath
      ? emptyFormulaCache.emptyCellsByPath.get(worksheetPath)
      : undefined;
    if (document.workbook.sheetOrder!.length >= 256)
      throw Error("A workbook can contain up to 256 sheets.");
    const id = `sheet-${crypto.randomUUID()}`;
    const declaredColumns = (worksheet.model as unknown as {
      cols?: Array<{ min?: number; max?: number; width?: number; hidden?: boolean }>;
    }).cols ?? [];
    const mergedRanges = worksheet.model.merges ?? [];
    const declaredColumnCount = declaredColumns.reduce(
      (maximum, column) => Math.max(maximum, column.max ?? column.min ?? 0),
      0,
    );
    const mergedColumnCount = mergedRanges.reduce((maximum, address) => {
      const endpoint = address.split(":").at(-1) ?? address;
      return Math.max(maximum, worksheet.getCell(endpoint).fullAddress.col);
    }, 0);
    const requiredColumnCount = Math.max(
      worksheet.columnCount,
      declaredColumnCount,
      mergedColumnCount,
    );
    if (requiredColumnCount > MAX_COLUMNS)
      throw Error("The workbook contains columns beyond the 16,384 column limit.");
    const sheet = {
      id,
      name: worksheet.name,
      rowCount: Math.min(MAX_ROWS, Math.max(1000, worksheet.rowCount + 100)),
      columnCount: Math.min(
        MAX_COLUMNS,
        Math.max(MIN_COLUMNS, worksheet.columnCount + 5, requiredColumnCount),
      ),
      cellData: {},
      rowData: {},
      columnData: {},
      defaultRowHeight: 24,
      defaultColumnWidth: 100,
      mergeData: [],
    } as Partial<IWorksheetData>;
    sheet.defaultRowHeight =
      worksheet.properties.defaultRowHeight / POINTS_PER_PIXEL;
    sheet.defaultColumnWidth = worksheet.properties.defaultColWidth
      ? excelColumnWidthToPixels(worksheet.properties.defaultColWidth)
      : 100;
    worksheet.eachRow((row, r) => {
      sheet.rowData![r - 1] = {
        ...(row.height ? { h: row.height / POINTS_PER_PIXEL } : {}),
        hd: row.hidden ? 1 : 0,
      };
      row.eachCell((cell, c) => {
        if (++count > MAX_CELLS)
          throw Error("The workbook contains more than 200,000 cells.");
        if (cell.isMerged && cell.master.address !== cell.address) return;
        let value: ICellData;
        if (cell.formula) {
          value = { f: `=${cell.formula}` };
          const cached = cell.result;
          const cachedError = cached !== null && typeof cached === "object"
            ? (cached as { error?: unknown }).error
            : undefined;
          if (cached instanceof Date) {
            value.v = cached.getTime() / 86400000 + 25569;
            value.t = 2;
          } else if (typeof cached === "number" && Number.isFinite(cached)) {
            value.v = cached;
            value.t = 2;
          } else if (typeof cached === "boolean") {
            value.v = cached;
            value.t = 3;
          } else if (typeof cached === "string") {
            value.v = cached;
            value.t = 1;
          } else if (typeof cachedError === "string") {
            value.v = cachedError;
            value.t = 4;
          } else if (emptyFormulaCells?.has(cell.address)) {
            value.v = "";
            value.t = 1;
          }
        }
        else if (cell.value instanceof Date)
          value = { v: cell.value.getTime() / 86400000 + 25569, t: 2 };
        else if (
          typeof cell.value === "number" ||
          typeof cell.value === "boolean"
        )
          value = { v: cell.value, t: typeof cell.value === "number" ? 2 : 3 };
        else value = cellFromInput(cell.text, true);
        value.s = fromStyle(cell.style);
        (sheet.cellData![r - 1] ??= {})[c - 1] = value;
      });
    });
    for (const column of declaredColumns) {
      const first = column.min ?? 0;
      const last = column.max ?? 0;
      if (
        !Number.isInteger(first) || !Number.isInteger(last) ||
        first < 1 || last < first || last > MAX_COLUMNS
      ) throw Error("The workbook contains invalid column definitions.");
      for (let c = first; c <= last; c += 1) {
        sheet.columnData![c - 1] = {
          ...(column.width ? { w: excelColumnWidthToPixels(column.width) } : {}),
          hd: column.hidden ? 1 : 0,
        };
      }
    }
    for (const address of mergedRanges) {
      const [start, end] = address
        .split(":")
        .map((value) => worksheet.getCell(value));
      sheet.mergeData!.push({
        startRow: Number(start.row) - 1,
        startColumn: Number(start.col) - 1,
        endRow: Number((end ?? start).row) - 1,
        endColumn: Number((end ?? start).col) - 1,
      });
    }
    document.workbook.sheetOrder!.push(id);
    document.workbook.sheets![id] = sheet as IWorksheetData;
  });
  if (!document.workbook.sheetOrder.length)
    throw Error("The file contains no worksheets.");
  document.activeSheetId = document.workbook.sheetOrder[0];
  return { document, warnings };
}

export async function exportSpreadsheet(
  document: WorkbookDocument,
  format: "xlsx" | "csv",
): Promise<Uint8Array> {
  const sheets = document.workbook.sheets!;
  if (format === "csv") {
    const sheet =
        sheets[document.activeSheetId || document.workbook.sheetOrder![0]],
      cells = sheet.cellData || {};
    let lastRow = -1,
      lastColumn = -1;
    for (const [r, row] of Object.entries(cells)) {
      lastRow = Math.max(lastRow, Number(r));
      for (const c of Object.keys(row || {}))
        lastColumn = Math.max(lastColumn, Number(c));
    }
    if ((lastRow + 1) * (lastColumn + 1) > MAX_CELLS)
      throw Error("The CSV range contains more than 200,000 cells.");
    const lines = Array.from({ length: lastRow + 1 }, (_, r) =>
      Array.from({ length: lastColumn + 1 }, (_, c) => csvCell(cells[r]?.[c])).join(","),
    );
    return new TextEncoder().encode("\uFEFF" + lines.join("\r\n"));
  }
  const workbook = new ExcelJS.Workbook();
  workbook.calcProperties.fullCalcOnLoad = true;
  for (const id of document.workbook.sheetOrder!) {
    const sheet = sheets[id],
      target = workbook.addWorksheet(sheet.name);
    target.properties.defaultRowHeight =
      (sheet.defaultRowHeight ?? 24) * POINTS_PER_PIXEL;
    target.properties.defaultColWidth = pixelsToExcelColumnWidth(
      sheet.defaultColumnWidth ?? 100,
    );
    for (const [r, row] of Object.entries(sheet.cellData || {}))
      for (const [c, cell] of Object.entries(
        (row || {}) as Record<string, ICellData>,
      )) {
        if (!cell) continue;
        const targetCell = target.getCell(Number(r) + 1, Number(c) + 1);
        targetCell.value = cell.f
          ? {
              formula: cell.f.replace(/^=/, ""),
              ...(cell.v != null ? { result: cell.v as any } : {}),
            }
          : typeof cell.v === "string" ||
              typeof cell.v === "number" ||
              typeof cell.v === "boolean"
            ? cell.v
            : ((cell.p || {}).body?.dataStream?.replace(/\r\n$/, "") ?? null);
        const style =
          typeof cell.s === "string"
            ? document.workbook.styles?.[cell.s]
            : cell.s;
        if (style) targetCell.style = toStyle(style);
      }
    for (const [r, data] of Object.entries(sheet.rowData || {})) {
      const row = target.getRow(Number(r) + 1);
      if (data.h) row.height = data.h * POINTS_PER_PIXEL;
      row.hidden = data.hd === 1;
    }
    for (const [c, data] of Object.entries(sheet.columnData || {})) {
      const column = target.getColumn(Number(c) + 1);
      if (data.w) column.width = pixelsToExcelColumnWidth(data.w);
      column.hidden = data.hd === 1;
    }
    for (const merge of sheet.mergeData || [])
      target.mergeCells(
        merge.startRow + 1,
        merge.startColumn + 1,
        merge.endRow + 1,
        merge.endColumn + 1,
      );
  }
  return new Uint8Array(await workbook.xlsx.writeBuffer());
}
