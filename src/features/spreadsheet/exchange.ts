import ExcelJS from "exceljs";
import JSZip from "jszip";
import type { ICellData, IStyleData, IWorksheetData } from "@univerjs/core";
import { assertSafeZipDirectory } from "../../../shared/zip-preflight.js";
import { getArchiveDeclaredSize } from "../../../shared/board-data.js";
import {
  cellFromInput,
  createWorkbookDocument,
  type WorkbookDocument,
} from "./workbook";

const MAX_IMPORT_BYTES = 20 * 1024 * 1024;
const MAX_CELLS = 200_000;
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
export function parseDelimited(text: string) {
  text = text.replace(/^\uFEFF/, "");
  const counts = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (inQuotes && text[i + 1] === '"') i++;
      else inQuotes = !inQuotes;
    } else if (!inQuotes) {
      if (ch === "\r" || ch === "\n") break;
      if (ch in counts) counts[ch as keyof typeof counts]++;
    }
  }
  const separator = counts["\t"] ? "\t" : counts[";"] > counts[","] ? ";" : ",";
  const rows: string[][] = [],
    row: string[] = [];
  let cell = "",
    quoted = false,
    count = 0;
  const finish = () => {
    if (++count > MAX_CELLS)
      throw Error("The file contains more than 200,000 cells.");
    row.push(cell);
    cell = "";
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (ch === '"') {
      if (quoted && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (quoted || cell === "") quoted = !quoted;
      else cell += ch;
    } else if (ch === separator && !quoted) finish();
    else if ((ch === "\n" || ch === "\r") && !quoted) {
      finish();
      rows.push(row.splice(0));
      if (ch === "\r" && text[i + 1] === "\n") i++;
    } else cell += ch;
  }
  if (quoted) throw Error("The CSV file contains an unclosed quoted value.");
  if (cell || row.length) {
    finish();
    rows.push(row);
  }
  return rows;
}

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
        parseDelimited(new TextDecoder().decode(bytes)),
      ),
      warnings: [],
    };
  if (!/\.xlsx$/i.test(name)) throw Error("Choose an XLSX, CSV or TSV file.");
  assertSafeZipDirectory(new Uint8Array(bytes));
  const zip = await JSZip.loadAsync(bytes);
  if (getArchiveDeclaredSize(zip.files) > 128 * 1024 * 1024)
    throw Error("The expanded workbook exceeds 128 MB.");
  const warnings: string[] = [];
  if (
    Object.keys(zip.files).some((path) =>
      /^xl\/(charts|drawings|pivotTables)\//.test(path),
    )
  )
    warnings.push("Charts, drawings and pivot tables are not imported.");
  const source = new ExcelJS.Workbook();
  await source.xlsx.load(bytes);
  const document = createWorkbookDocument(name.replace(/\.xlsx$/i, ""));
  document.workbook.sheetOrder = [];
  document.workbook.sheets = {};
  let count = 0;
  source.eachSheet((worksheet) => {
    if (document.workbook.sheetOrder!.length >= 256)
      throw Error("A workbook can contain up to 256 sheets.");
    const id = `sheet-${crypto.randomUUID()}`;
    const sheet = {
      id,
      name: worksheet.name,
      rowCount: Math.min(1_048_576, Math.max(1000, worksheet.rowCount + 100)),
      columnCount: Math.min(16_384, Math.max(26, worksheet.columnCount + 5)),
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
        if (cell.formula) value = { f: `=${cell.formula}` };
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
    (worksheet.columns ?? []).forEach((column, c) => {
      sheet.columnData![c] = {
        ...(column.width ? { w: excelColumnWidthToPixels(column.width) } : {}),
        hd: column.hidden ? 1 : 0,
      };
    });
    for (const address of worksheet.model.merges ?? []) {
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
      Array.from({ length: lastColumn + 1 }, (_, c) => {
        const cell = cells[r]?.[c],
          raw = String(
            cell?.v ??
              (cell?.p || {})?.body?.dataStream?.replace(/\r\n$/, "") ??
              cell?.f ??
              "",
          );
        return /[",\r\n]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
      }).join(","),
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
