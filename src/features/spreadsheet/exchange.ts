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
const MAX_EDGE_COLUMN_SPAN = 64;
const MAX_DECLARED_COLUMN_INDEXES = 400_000;
const MAX_XML_DEPTH = 128;
const MAX_XML_ATTRIBUTES = 256;
const MAX_XML_NAME_LENGTH = 256;
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
  const fontColor = style.cl ? style.cl.rgb : undefined;
  const numberFormat = style.n ? style.n.pattern : undefined;
  const fillColor = style.bg ? style.bg.rgb : undefined;
  const value: Partial<ExcelJS.Style> = {
    font: {
      name: style.ff || "Arial",
      size: style.fs || 11,
      bold: style.bl === 1,
      italic: style.it === 1,
      underline: style.ul?.s === 1,
      strike: style.st?.s === 1,
      ...(argb(fontColor)
        ? { color: { argb: argb(fontColor) } }
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
  if (numberFormat) value.numFmt = numberFormat;
  if (argb(fillColor))
    value.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: argb(fillColor) },
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
      throw new Error("The file contains more than 200,000 cells.");
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
  if (quoted) throw new Error("The CSV file contains an unclosed quoted value.");
  if (fieldStarted || row.length) {
    finish();
    rows.push(row);
  }
  return rows;
}

const isXmlWhitespace = (code: number) => code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;
const isXmlNameStart = (code: number) =>
  code === 0x3a || code === 0x5f || (code >= 0x41 && code <= 0x5a) ||
  (code >= 0x61 && code <= 0x7a) || code >= 0x80;
const isXmlNameChar = (code: number) => isXmlNameStart(code) ||
  (code >= 0x30 && code <= 0x39) || code === 0x2d || code === 0x2e;

type XmlToken = {
  type: "start" | "end" | "text";
  name?: string;
  localName?: string;
  parentLocalName?: string;
  attributes?: Map<string, string>;
  selfClosing?: boolean;
  start: number;
  end: number;
};

/** A bounded, single-pass XML tokenizer for the untrusted XLSX parts we inspect. */
type XmlScannerState = {
  stack: Array<{ name: string; localName: string }>;
  rootSeen: boolean;
};

type XmlElementContext = {
  open: number;
  name: string;
  localName: string;
  parentLocalName: string | undefined;
};

function getXmlLocalName(name: string, malformed: () => never) {
  const separator = name.indexOf(":");
  if (separator === 0 || separator === name.length - 1 ||
      (separator >= 0 && name.includes(":", separator + 1))) malformed();
  return separator < 0 ? name : name.slice(separator + 1);
}

function readXmlName(xml: string, start: number, malformed: () => never) {
  let end = start;
  if (end >= xml.length || !isXmlNameStart(xml.codePointAt(end)!)) malformed();
  end += 1;
  while (end < xml.length && isXmlNameChar(xml.codePointAt(end)!)) end += 1;
  if (end - start > MAX_XML_NAME_LENGTH) malformed();
  const name = xml.slice(start, end);
  const localName = getXmlLocalName(name, malformed);
  return { name, localName, end };
}

function emitXmlText(
  xml: string,
  start: number,
  end: number,
  insideElement: boolean,
  visit: (token: XmlToken) => void,
  malformed: () => never,
) {
  if (start >= end) return;
  if (insideElement) {
    visit({ type: "text", start, end });
    return;
  }
  for (let index = start; index < end; index += 1) {
    const code = xml.codePointAt(index)!;
    if (!isXmlWhitespace(code) && code !== 0xfeff) malformed();
  }
}

function skipXmlWhitespace(xml: string, start: number) {
  let index = start;
  while (index < xml.length && isXmlWhitespace(xml.codePointAt(index)!)) index += 1;
  return index;
}

function readClosingXmlElement(
  xml: string,
  element: XmlElementContext,
  index: number,
  state: XmlScannerState,
  visit: (token: XmlToken) => void,
  malformed: () => never,
) {
  const endMarker = skipXmlWhitespace(xml, index);
  if (xml[endMarker] !== ">" || state.stack.at(-1)?.name !== element.name) malformed();
  visit({
    type: "end",
    name: element.name,
    localName: element.localName,
    parentLocalName: element.parentLocalName,
    start: element.open,
    end: endMarker + 1,
  });
  state.stack.pop();
  return endMarker + 1;
}

function readXmlAttribute(xml: string, start: number, malformed: () => never) {
  const attribute = readXmlName(xml, start, malformed);
  let index = skipXmlWhitespace(xml, attribute.end);
  if (xml[index] !== "=") malformed();
  index = skipXmlWhitespace(xml, index + 1);
  const quote = xml[index];
  if (quote !== "\"" && quote !== "'") malformed();
  const valueStart = index + 1;
  index = valueStart;
  while (index < xml.length && xml[index] !== quote) {
    if (xml[index] === "<") malformed();
    index += 1;
  }
  if (index >= xml.length) malformed();
  return { name: attribute.name, value: xml.slice(valueStart, index), end: index + 1 };
}

function readXmlOpeningAttributes(xml: string, start: number, malformed: () => never) {
  const attributes = new Map<string, string>();
  let index = start;
  let selfClosing = false;
  while (index < xml.length) {
    index = skipXmlWhitespace(xml, index);
    if (xml[index] === ">") return { attributes, selfClosing, index: index + 1 };
    if (xml[index] === "/") {
      if (xml[index + 1] !== ">") malformed();
      selfClosing = true;
      return { attributes, selfClosing, index: index + 2 };
    }
    const attribute = readXmlAttribute(xml, index, malformed);
    if (attributes.has(attribute.name) || attributes.size >= MAX_XML_ATTRIBUTES) malformed();
    attributes.set(attribute.name, attribute.value);
    index = attribute.end;
  }
  return malformed();
}

function readOpeningXmlElement(
  xml: string,
  element: XmlElementContext,
  startIndex: number,
  state: XmlScannerState,
  visit: (token: XmlToken) => void,
  malformed: () => never,
) {
  const { attributes, selfClosing, index } = readXmlOpeningAttributes(xml, startIndex, malformed);
  if (!state.stack.length && state.rootSeen) malformed();
  if (!state.stack.length) state.rootSeen = true;
  visit({
    type: "start",
    name: element.name,
    localName: element.localName,
    parentLocalName: element.parentLocalName,
    attributes,
    selfClosing,
    start: element.open,
    end: index,
  });
  if (selfClosing) {
    visit({
      type: "end",
      name: element.name,
      localName: element.localName,
      parentLocalName: element.parentLocalName,
      start: element.open,
      end: index,
    });
    return index;
  }
  if (state.stack.length >= MAX_XML_DEPTH) malformed();
  state.stack.push({ name: element.name, localName: element.localName });
  return index;
}

function readXmlElement(
  xml: string,
  open: number,
  state: XmlScannerState,
  visit: (token: XmlToken) => void,
  malformed: () => never,
) {
  const closing = xml[open + 1] === "/";
  const parsed = readXmlName(xml, open + (closing ? 2 : 1), malformed);
  const parentLocalName = state.stack.at(closing ? -2 : -1)?.localName;
  const element = { open, name: parsed.name, localName: parsed.localName, parentLocalName };
  if (closing)
    return readClosingXmlElement(xml, element, parsed.end, state, visit, malformed);
  return readOpeningXmlElement(xml, element, parsed.end, state, visit, malformed);
}

function readXmlMarkup(
  xml: string,
  open: number,
  state: XmlScannerState,
  visit: (token: XmlToken) => void,
  malformed: () => never,
) {
  if (xml.startsWith("<!--", open)) {
    const close = xml.indexOf("-->", open + 4);
    if (close < 0) malformed();
    return close + 3;
  }
  if (xml.startsWith("<![CDATA[", open)) {
    if (!state.stack.length) malformed();
    const close = xml.indexOf("]]>", open + 9);
    if (close < 0) malformed();
    visit({ type: "text", start: open + 9, end: close });
    return close + 3;
  }
  if (xml.startsWith("<?", open)) {
    const close = xml.indexOf("?>", open + 2);
    if (close < 0) malformed();
    return close + 2;
  }
  if (xml.startsWith("<!", open)) malformed();
  return readXmlElement(xml, open, state, visit, malformed);
}

function scanXml(xml: string, visit: (token: XmlToken) => void) {
  const state: XmlScannerState = { stack: [], rootSeen: false };
  const malformed = () => { throw new Error("The workbook contains malformed XML."); };
  let position = 0;
  while (position < xml.length) {
    const open = xml.indexOf("<", position);
    if (open < 0) {
      emitXmlText(xml, position, xml.length, state.stack.length > 0, visit, malformed);
      break;
    }
    emitXmlText(xml, position, open, state.stack.length > 0, visit, malformed);
    position = readXmlMarkup(xml, open, state, visit, malformed);
  }
  if (!state.rootSeen || state.stack.length) malformed();
}

function parseBoundedInteger(value: string | undefined, maximum: number) {
  if (!value?.length) return undefined;
  let number = 0;
  for (let index = 0; index < value.length; index += 1) {
    const digit = value.codePointAt(index)! - 0x30;
    if (digit < 0 || digit > 9) return undefined;
    number = number * 10 + digit;
    if (!Number.isSafeInteger(number) || number > maximum) return maximum + 1;
  }
  return number;
}

function parseCellColumn(address: string, absolute: boolean) {
  let index = 0;
  if (absolute && address[index] === "$") index += 1;
  let column = 0;
  let letters = 0;
  while (index < address.length) {
    const code = address.codePointAt(index)!;
    const upper = code >= 0x61 && code <= 0x7a ? code - 0x20 : code;
    if (upper < 0x41 || upper > 0x5a) break;
    if (++letters > 3) throw new Error("The workbook contains an invalid cell reference.");
    column = column * 26 + upper - 0x40;
    index += 1;
  }
  if (!letters) throw new Error("The workbook contains an invalid cell reference.");
  if (absolute && address[index] === "$") index += 1;
  return { column, index };
}

function parseCellRow(address: string, index: number) {
  let row = 0;
  let digits = 0;
  while (index < address.length) {
    const digit = address.codePointAt(index)! - 0x30;
    if (digit < 0 || digit > 9) throw new Error("The workbook contains an invalid cell reference.");
    digits += 1;
    row = row * 10 + digit;
    if (row > MAX_ROWS) throw new Error("The workbook contains an invalid cell reference.");
    index += 1;
  }
  if (!digits || row < 1 || row > MAX_ROWS)
    throw new Error("The workbook contains an invalid cell reference.");
  return row;
}

function parseCellAddress(address: string, absolute = false) {
  const { column, index } = parseCellColumn(address, absolute);
  if (column < 1 || column > MAX_COLUMNS)
    throw new Error("The workbook contains an invalid cell reference.");
  const row = parseCellRow(address, index);
  return { row, column };
}

function parseCellRange(address: string) {
  const separator = address.indexOf(":");
  if (separator >= 0 && address.includes(":", separator + 1))
    throw new Error("The workbook contains an invalid merged range.");
  const start = parseCellAddress(separator < 0 ? address : address.slice(0, separator), true);
  const end = separator < 0 ? start : parseCellAddress(address.slice(separator + 1), true);
  if (end.column < start.column || end.row < start.row)
    throw new Error("The workbook contains an invalid merged range.");
  return { start, end };
}

function addWarning(warnings: string[], warning: string) {
  if (!warnings.includes(warning)) warnings.push(warning);
}

/** Validate worksheet XML and bound materialization before ExcelJS loads it. */
async function preflightWorkbookImport(zip: JSZip, warnings: string[]) {
  const budget = { materializedCells: 0, totalRowRecords: 0, declaredColumnIndexes: 0, normalizedImplicitCells: false };
  let worksheetPartCount = 0;
  for (const path in zip.files) {
    const entry = zip.files[path];
    if (entry.dir) continue;
    const excelJsWorksheetPart = /xl\/worksheets\/sheet(\d+)[.]xml/.exec(path);
    if (excelJsWorksheetPart && path !== `xl/worksheets/sheet${excelJsWorksheetPart[1]}.xml`)
      throw new Error("The workbook contains an invalid worksheet part path.");
    if (!/^xl\/worksheets\/[^/]+\.xml$/i.test(path)) continue;
    if (++worksheetPartCount > 256)
      throw new Error("A workbook can contain up to 256 sheets.");
    const xml = await entry.async("string");
    const result = preflightWorksheetXml(xml, warnings, budget);
    if (result.normalizedXml !== undefined) zip.file(path, result.normalizedXml);
  }
  return budget.normalizedImplicitCells;
}

type WorkbookPreflightBudget = {
  materializedCells: number;
  totalRowRecords: number;
  declaredColumnIndexes: number;
  normalizedImplicitCells: boolean;
};

type WorksheetPreflightState = {
  rowRecordCount: number;
  explicitRowIndexes: Set<number>;
  cellAddresses: Set<string>;
  columnDefinitionCoverage: Uint8Array;
  implicitAddressInsertions: Array<{ offset: number; value: string }>;
  currentRow?: {
    rowNumber?: number;
    previousAddress?: { row: number; column: number };
    rowNumberInsertionOffset: number;
  };
};

function beginWorksheetRow(token: XmlToken, parent: string | undefined, state: WorksheetPreflightState, budget: WorkbookPreflightBudget) {
  if (parent !== "sheetdata") return;
  if (state.currentRow) throw new Error("The workbook contains an invalid worksheet row.");
  const rowText = token.attributes?.get("r")?.trim();
  let rowNumber: number | undefined;
  if (rowText !== undefined) {
    const parsed = parseBoundedInteger(rowText, MAX_ROWS);
    if (parsed === undefined || parsed < 1 || parsed > MAX_ROWS)
      throw new Error("The workbook contains an invalid row reference.");
    rowNumber = parsed;
    if (state.explicitRowIndexes.has(rowNumber))
      throw new Error("The workbook contains duplicate worksheet row references.");
    state.explicitRowIndexes.add(rowNumber);
  }
  state.rowRecordCount += 1;
  budget.totalRowRecords += 1;
  if (state.rowRecordCount > MAX_ROWS)
    throw new Error("The worksheet contains more than 1,048,576 row records.");
  if (budget.totalRowRecords > MAX_CELLS)
    throw new Error("The workbook contains more than 200,000 row records.");
  state.currentRow = { rowNumber, rowNumberInsertionOffset: token.end - 1 };
}

function finishWorksheetRow(state: WorksheetPreflightState) {
  if (state.currentRow?.rowNumber === undefined)
    throw new Error("The workbook contains a worksheet row without a usable row number.");
  state.currentRow = undefined;
}

function resolveWorksheetCellAddress(token: XmlToken, state: WorksheetPreflightState, budget: WorkbookPreflightBudget) {
  const row = state.currentRow!;
  const reference = token.attributes!.get("r")?.trim();
  if (reference !== undefined) {
    const address = parseCellAddress(reference);
    if (row.rowNumber === undefined) {
      if (state.explicitRowIndexes.has(address.row))
        throw new Error("The workbook contains duplicate worksheet row references.");
      row.rowNumber = address.row;
      state.explicitRowIndexes.add(address.row);
      state.implicitAddressInsertions.push({ offset: row.rowNumberInsertionOffset, value: ` r="${address.row}"` });
      budget.normalizedImplicitCells = true;
    }
    if (address.row !== row.rowNumber)
      throw new Error("The workbook contains a cell reference that does not match its worksheet row.");
    return address;
  }
  if (row.previousAddress) {
    const address = { row: row.previousAddress.row, column: row.previousAddress.column + 1 };
    if (address.column > MAX_COLUMNS)
      throw new Error("The workbook contains an invalid cell reference.");
    return address;
  }
  if (row.rowNumber !== undefined) {
    state.implicitAddressInsertions.push({
      offset: token.selfClosing ? token.end - 2 : token.end - 1,
      value: ` r="A${row.rowNumber}"`,
    });
    budget.normalizedImplicitCells = true;
    return { row: row.rowNumber, column: 1 };
  }
  throw new Error("The workbook contains a cell without a reference or row number.");
}

function preflightWorksheetCell(token: XmlToken, state: WorksheetPreflightState, budget: WorkbookPreflightBudget) {
  if (!state.currentRow) throw new Error("The workbook contains a cell outside a worksheet row.");
  if (budget.materializedCells >= MAX_CELLS)
    throw new Error("The workbook contains more than 200,000 cells.");
  const address = resolveWorksheetCellAddress(token, state, budget);
  const key = `${address.row}:${address.column}`;
  if (state.cellAddresses.has(key)) throw new Error("The workbook contains duplicate cell references.");
  if (state.cellAddresses.size >= MAX_CELLS)
    throw new Error("The workbook contains more than 200,000 cells.");
  state.cellAddresses.add(key);
  state.currentRow.previousAddress = address;
  budget.materializedCells += 1;
}

function preflightWorksheetColumn(attributes: Map<string, string>, state: WorksheetPreflightState, warnings: string[]) {
  const min = parseBoundedInteger(attributes.get("min")?.trim(), MAX_COLUMNS);
  const max = parseBoundedInteger(attributes.get("max")?.trim(), MAX_COLUMNS);
  const widthText = attributes.get("width");
  const width = widthText === undefined ? undefined : Number(widthText);
  if (
    min === undefined || max === undefined || min < 1 || min > MAX_COLUMNS ||
    max < min || max > MAX_COLUMNS ||
    (width !== undefined && (!Number.isFinite(width) || width < 0))
  ) throw new Error("The workbook contains invalid column definitions.");
  for (let column = min; column <= max; column += 1) {
    if (state.columnDefinitionCoverage[column - 1])
      throw new Error("The workbook contains overlapping column definitions.");
    state.columnDefinitionCoverage[column - 1] = 1;
  }
  if (attributes.has("bestFit") || attributes.has("outlineLevel") || attributes.has("collapsed"))
    addWarning(warnings, "Column best-fit and outline metadata is not imported.");
}

function preflightMergedCell(attributes: Map<string, string>, budget: WorkbookPreflightBudget) {
  const reference = attributes.get("ref");
  if (reference === undefined) throw new Error("The workbook contains an invalid merged range.");
  const { start, end } = parseCellRange(reference);
  budget.materializedCells += (end.column - start.column + 1) * (end.row - start.row + 1);
  if (budget.materializedCells > MAX_CELLS)
    throw new Error("The workbook contains merged ranges exceeding the 200,000 cell limit.");
}

function preflightWorksheetToken(token: XmlToken, state: WorksheetPreflightState, budget: WorkbookPreflightBudget, warnings: string[]) {
  const tag = token.localName?.toLowerCase();
  const parent = token.parentLocalName?.toLowerCase();
  if (token.type === "start" && tag === "row") {
    beginWorksheetRow(token, parent, state, budget);
    return;
  }
  if (token.type === "end" && tag === "row" && parent === "sheetdata") {
    finishWorksheetRow(state);
    return;
  }
  if (token.type !== "start") return;
  const attributes = token.attributes!;
  if (tag === "c" && parent === "row") {
    preflightWorksheetCell(token, state, budget);
    return;
  }
  if (tag === "col" && parent === "cols") {
    preflightWorksheetColumn(attributes, state, warnings);
    return;
  }
  if (tag === "mergecell" && parent === "mergecells")
    preflightMergedCell(attributes, budget);
}

function applyImplicitAddressInsertions(xml: string, insertions: WorksheetPreflightState['implicitAddressInsertions']) {
  const parts: string[] = [];
  let cursor = 0;
  for (const insertion of insertions) {
    parts.push(xml.slice(cursor, insertion.offset), insertion.value);
    cursor = insertion.offset;
  }
  parts.push(xml.slice(cursor));
  return parts.join("");
}

function preflightWorksheetXml(xml: string, warnings: string[], budget: WorkbookPreflightBudget) {
  const state: WorksheetPreflightState = {
    rowRecordCount: 0,
    explicitRowIndexes: new Set<number>(),
    cellAddresses: new Set<string>(),
    columnDefinitionCoverage: new Uint8Array(MAX_COLUMNS),
    implicitAddressInsertions: [],
  };
  scanXml(xml, token => preflightWorksheetToken(token, state, budget, warnings));
  budget.declaredColumnIndexes += state.columnDefinitionCoverage.lastIndexOf(1) + 1;
  if (budget.declaredColumnIndexes > MAX_DECLARED_COLUMN_INDEXES)
    throw new Error("The workbook contains too many declared column indexes.");
  if (state.currentRow) throw new Error("The workbook contains an unclosed worksheet row.");
  return state.implicitAddressInsertions.length
    ? { normalizedXml: applyImplicitAddressInsertions(xml, state.implicitAddressInsertions) }
    : { normalizedXml: undefined };
}

type FormulaCacheCellState = {
  address?: string;
  type?: string;
  formula: boolean;
  inValue: boolean;
  valueHasText: boolean;
  emptyValue: boolean;
};

type FormulaCacheScanState = { cell?: FormulaCacheCellState };

function beginFormulaCacheCell(token: XmlToken, state: FormulaCacheScanState) {
  if (token.localName?.toLowerCase() !== "c" || token.parentLocalName?.toLowerCase() !== "row")
    return false;
  state.cell = {
    address: token.attributes?.get("r"),
    type: token.attributes?.get("t"),
    formula: false,
    inValue: false,
    valueHasText: false,
    emptyValue: false,
  };
  return true;
}

function updateFormulaCacheCellStart(token: XmlToken, state: FormulaCacheScanState) {
  const cell = state.cell;
  if (!cell) return;
  const tag = token.localName?.toLowerCase();
  if (tag === "f") {
    cell.formula = true;
    return;
  }
  if (tag === "v") {
    cell.inValue = true;
    cell.valueHasText = false;
  }
}

function updateFormulaCacheCellText(xml: string, token: XmlToken, state: FormulaCacheScanState) {
  const cell = state.cell;
  if (!cell?.inValue) return;
  for (let index = token.start; index < token.end; index += 1) {
    if (!isXmlWhitespace(xml.codePointAt(index)!)) {
      cell.valueHasText = true;
      return;
    }
  }
}

function finishFormulaCacheCell(token: XmlToken, state: FormulaCacheScanState, cells: Set<string>) {
  const cell = state.cell;
  if (!cell) return;
  const tag = token.localName?.toLowerCase();
  if (tag === "v") {
    cell.emptyValue = !cell.valueHasText;
    cell.inValue = false;
    return;
  }
  if (tag !== "c") return;
  if (cell.address && cell.type === "str" && cell.formula && cell.emptyValue)
    cells.add(cell.address);
  state.cell = undefined;
}

function findEmptyFormulaCacheCells(xml: string) {
  const cells = new Set<string>();
  const state: FormulaCacheScanState = {};
  scanXml(xml, token => {
    if (token.type === "start") {
      if (!beginFormulaCacheCell(token, state)) updateFormulaCacheCellStart(token, state);
      return;
    }
    if (token.type === "text") {
      updateFormulaCacheCellText(xml, token, state);
      return;
    }
    finishFormulaCacheCell(token, state, cells);
  });
  return cells;
}

function resolveWorksheetPath(target: string) {
  const segments: string[] = [];
  const targetPath = target.startsWith("/") ? target.slice(1) : `xl/${target}`;
  for (const segment of targetPath.split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") segments.pop();
    else segments.push(segment);
  }
  const path = segments.join("/");
  return /^xl\/worksheets\/[^/]+\.xml$/i.test(path) ? path : "";
}

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
  scanXml(relationshipsXml, token => {
    if (token.type !== "start" || token.localName?.toLowerCase() !== "relationship") return;
    const id = token.attributes?.get("Id"), target = token.attributes?.get("Target");
    if (id !== undefined && target !== undefined) targetsById.set(id, target);
  });
  const orderedPaths: string[] = [];
  scanXml(workbookXml, token => {
    if (token.type !== "start" || token.localName?.toLowerCase() !== "sheet") return;
    const relationshipId = token.attributes?.get("r:id");
    const target = relationshipId ? targetsById.get(relationshipId) : undefined;
    if (target) orderedPaths.push(resolveWorksheetPath(target));
  });
  const worksheets = await Promise.all(orderedPaths.map(async path => {
    const entry = path ? zip.file(path) : undefined;
    return entry ? { path, xml: await entry.async("string") } : undefined;
  }));
  for (const worksheet of worksheets) {
    if (worksheet) emptyCellsByPath.set(worksheet.path, findEmptyFormulaCacheCells(worksheet.xml));
  }
  return { emptyCellsByPath, orderedPaths };
}

type ImportedWorksheetModel = {
  cols?: Array<{
    min?: number;
    max?: number;
    width?: number;
    hidden?: boolean;
    style?: Partial<ExcelJS.Style>;
    outlineLevel?: number;
    collapsed?: boolean;
    bestFit?: boolean;
  }>;
  merges?: string[];
};

type ImportedWorksheetColumn = NonNullable<ImportedWorksheetModel["cols"]>[number];
type ImportedWorksheetColumns = NonNullable<ImportedWorksheetModel["cols"]>;

function hasColumnStyle(column: ImportedWorksheetColumn) {
  return Boolean(column.style && Object.keys(column.style).length);
}

function hasMeaningfulColumnState(column: ImportedWorksheetColumn, defaultWidth: number) {
  const width = column.width;
  return column.hidden === true ||
    (typeof width === "number" && Number.isFinite(width) && width > 0 && width !== defaultWidth) ||
    hasColumnStyle(column) || Boolean(column.outlineLevel || column.collapsed || column.bestFit);
}

function getDeclaredColumnCount(columns: ImportedWorksheetColumns, defaultWidth: number) {
  return columns.reduce((maximum, column) => {
    const first = column.min ?? 0;
    const last = column.max ?? 0;
    // Do not expand broad default or hidden-tail spans through XFD, but retain
    // small formatted ranges at the right edge instead of dropping their widths.
    const bounded = first === last || (first < last &&
      (last < MAX_COLUMNS || (last === MAX_COLUMNS && last - first + 1 <= MAX_EDGE_COLUMN_SPAN)));
    if (!bounded || !hasMeaningfulColumnState(column, defaultWidth)) return maximum;
    return Math.max(maximum, last);
  }, 0);
}

function getMergedColumnCount(merges: string[]) {
  return merges.reduce((maximum, address) => {
    const endpoint = address.split(":").at(-1) ?? address;
    return Math.max(maximum, parseCellAddress(endpoint).column);
  }, 0);
}

function getRequiredColumnCount(worksheet: ExcelJS.Worksheet, model: ImportedWorksheetModel, defaultWidth: number) {
  const declaredColumns = model.cols ?? [];
  const mergedRanges = model.merges ?? [];
  return Math.max(
    worksheet.columnCount,
    getDeclaredColumnCount(declaredColumns, defaultWidth),
    getMergedColumnCount(mergedRanges),
  );
}

function createImportedWorksheet(worksheet: ExcelJS.Worksheet, id: string, requiredColumnCount: number): IWorksheetData {
  const sheet = {
    id,
    name: worksheet.name,
    rowCount: Math.min(MAX_ROWS, Math.max(1000, worksheet.rowCount + 100)),
    columnCount: Math.min(MAX_COLUMNS, Math.max(MIN_COLUMNS, worksheet.columnCount + 5, requiredColumnCount)),
    cellData: {},
    rowData: {},
    columnData: {},
    defaultRowHeight: worksheet.properties.defaultRowHeight / POINTS_PER_PIXEL,
    defaultColumnWidth: worksheet.properties.defaultColWidth
      ? excelColumnWidthToPixels(worksheet.properties.defaultColWidth)
      : 100,
    mergeData: [],
  } as IWorksheetData;
  return sheet;
}

function importWorksheetColumns(
  columns: ImportedWorksheetColumns,
  sheet: IWorksheetData,
  defaultWidth: number,
  warnings: string[],
) {
  for (const column of columns) {
    const { first, last } = getImportedColumnSpan(column);
    const override = getImportedColumnOverride(column, defaultWidth, warnings);
    if (last > sheet.columnCount && hasMeaningfulColumnState(column, defaultWidth))
      addWarning(warnings, "Formatting for empty columns outside the active imported range was omitted.");
    const activeFirst = Math.max(1, first);
    const activeLast = Math.min(last, sheet.columnCount);
    if (activeFirst > activeLast) continue;
    if (!Object.keys(override).length) continue;
    // ExcelJS normalizes column definitions into sorted, non-overlapping spans.
    // Clipping each span to active geometry bounds total expansion.
    for (let columnIndex = activeFirst; columnIndex <= activeLast; columnIndex += 1)
      sheet.columnData[columnIndex - 1] = override;
  }
}

function getImportedColumnSpan(column: ImportedWorksheetColumn) {
  const first = column.min ?? 0;
  const last = column.max ?? 0;
  if (!Number.isInteger(first) || !Number.isInteger(last) || first < 1 || last < first || last > MAX_COLUMNS)
    throw new Error("The workbook contains invalid column definitions.");
  return { first, last };
}

function getImportedColumnOverride(
  column: ImportedWorksheetColumn,
  defaultWidth: number,
  warnings: string[],
) {
  const width = column.width;
  const customWidth = typeof width === "number" && Number.isFinite(width) && width > 0 && width !== defaultWidth;
  const sourceHasStyle = hasColumnStyle(column);
  const convertedStyle = column.style ? fromStyle(column.style) : undefined;
  const style = convertedStyle && Object.keys(convertedStyle).length ? convertedStyle : undefined;
  if (sourceHasStyle && !style)
    addWarning(warnings, "Some spreadsheet column styles are not supported and were omitted.");
  return {
    ...(customWidth ? { w: excelColumnWidthToPixels(width!) } : {}),
    ...(column.hidden ? { hd: 1 as const } : {}),
    ...(style ? { s: style } : {}),
  };
}

function importFormulaCell(
  cell: ExcelJS.Cell,
  emptyFormulaCells: Set<string> | undefined,
): ICellData {
  const value: ICellData = { f: `=${cell.formula}` };
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
  return value;
}

function importCellValue(cell: ExcelJS.Cell, emptyFormulaCells: Set<string> | undefined): ICellData {
  if (cell.formula) return importFormulaCell(cell, emptyFormulaCells);
  if (cell.value instanceof Date)
    return { v: cell.value.getTime() / 86400000 + 25569, t: 2 };
  if (typeof cell.value === "number" || typeof cell.value === "boolean")
    return { v: cell.value, t: typeof cell.value === "number" ? 2 : 3 };
  return cellFromInput(cell.text, true);
}

function importWorksheetRows(
  worksheet: ExcelJS.Worksheet,
  sheet: IWorksheetData,
  emptyFormulaCells: Set<string> | undefined,
  cellsImportedBefore: number,
) {
  let cellsImported = 0;
  worksheet.eachRow((row, rowIndex) => {
    sheet.rowData[rowIndex - 1] = {
      ...(row.height ? { h: row.height / POINTS_PER_PIXEL } : {}),
      hd: row.hidden ? 1 : 0,
    };
    row.eachCell((cell, columnIndex) => {
      cellsImported += 1;
      if (cellsImportedBefore + cellsImported > MAX_CELLS)
        throw new Error("The workbook contains more than 200,000 cells.");
      if (cell.isMerged && cell.master.address !== cell.address) return;
      const value = importCellValue(cell, emptyFormulaCells);
      value.s = fromStyle(cell.style);
      const rowData = sheet.cellData[rowIndex - 1] ?? {};
      rowData[columnIndex - 1] = value;
      sheet.cellData[rowIndex - 1] = rowData;
    });
  });
  return cellsImported;
}

function importWorksheetMerges(worksheet: ExcelJS.Worksheet, sheet: IWorksheetData, merges: string[]) {
  for (const address of merges) {
    const [start, end] = address.split(":").map(value => worksheet.getCell(value));
    sheet.mergeData.push({
      startRow: Number(start.row) - 1,
      startColumn: Number(start.col) - 1,
      endRow: Number((end ?? start).row) - 1,
      endColumn: Number((end ?? start).col) - 1,
    });
  }
}

function importWorksheet(
  worksheet: ExcelJS.Worksheet,
  id: string,
  warnings: string[],
  emptyFormulaCells: Set<string> | undefined,
  cellsImportedBefore: number,
) {
  const model = worksheet.model as unknown as ImportedWorksheetModel;
  const declaredColumns = model.cols ?? [];
  const mergedRanges = model.merges ?? [];
  const defaultColumnWidth = worksheet.properties.defaultColWidth ?? 9;
  const requiredColumnCount = getRequiredColumnCount(worksheet, model, defaultColumnWidth);
  if (requiredColumnCount > MAX_COLUMNS)
    throw new Error("The workbook contains columns beyond the 16,384 column limit.");
  const sheet = createImportedWorksheet(worksheet, id, requiredColumnCount);
  importWorksheetColumns(declaredColumns, sheet, defaultColumnWidth, warnings);
  const cellsImported = importWorksheetRows(worksheet, sheet, emptyFormulaCells, cellsImportedBefore);
  importWorksheetMerges(worksheet, sheet, mergedRanges);
  return { sheet, cellsImported };
}

const csvCell = (cell: ICellData | undefined) => {
  const richText = cell?.p ? cell.p.body?.dataStream?.replace(/\r\n$/, "") : undefined;
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

function exportCellValue(cell: ICellData) {
  if (cell.f) {
    return {
      formula: cell.f.replace(/^=/, ""),
      ...(cell.v != null ? { result: cell.v as any } : {}),
    };
  }
  if (typeof cell.v === "string" || typeof cell.v === "number" || typeof cell.v === "boolean")
    return cell.v;
  const richText = cell.p ? cell.p.body?.dataStream : undefined;
  return richText?.replace(/\r\n$/, "") ?? null;
}

export async function importSpreadsheet(
  bytes: ArrayBuffer,
  name: string,
): Promise<{ document: WorkbookDocument; warnings: string[] }> {
  if (bytes.byteLength > MAX_IMPORT_BYTES)
    throw new Error("Spreadsheet files can be up to 20 MB.");
  if (/\.(csv|tsv)$/i.test(name))
    return {
      document: createWorkbookDocument(
        name.replace(/\.[^.]+$/, ""),
        parseDelimited(new TextDecoder().decode(bytes), /\.tsv$/i.test(name) ? "\t" : undefined),
      ),
      warnings: [],
    };
  if (!/\.xlsx$/i.test(name)) throw new Error("Choose an XLSX, CSV or TSV file.");
  assertSafeZipDirectory(new Uint8Array(bytes));
  const zip = await JSZip.loadAsync(bytes);
  if (getArchiveDeclaredSize(zip.files) > MAX_IMPORT_EXPANDED_BYTES)
    throw new Error("The expanded workbook exceeds 128 MB.");
  await assertZipExpansionWithinLimits(Object.values(zip.files), {
    maxEntryBytes: MAX_IMPORT_EXPANDED_BYTES,
    maxArchiveBytes: MAX_IMPORT_EXPANDED_BYTES,
    archiveLabel: "Expanded workbook",
  });
  const warnings: string[] = [];
  const normalizedImplicitCells = await preflightWorkbookImport(zip, warnings);
  if (
    Object.keys(zip.files).some((path) =>
      /^xl\/(charts|drawings|pivotTables)\//.test(path),
    )
  )
    addWarning(warnings, "Charts, drawings and pivot tables are not imported.");
  const emptyFormulaCache = await readEmptyFormulaCacheCells(zip);
  const excelBytes = normalizedImplicitCells
    ? await zip.generateAsync({ type: "uint8array" })
    : bytes;
  const source = new ExcelJS.Workbook();
  await source.xlsx.load(excelBytes);
  const document = createWorkbookDocument(name.replace(/\.xlsx$/i, ""));
  document.workbook.sheetOrder = [];
  document.workbook.sheets = {};
  let importedCellCount = 0;
  let worksheetIndex = 0;
  source.eachSheet((worksheet) => {
    const worksheetPath = emptyFormulaCache.orderedPaths[worksheetIndex++];
    const emptyFormulaCells = worksheetPath
      ? emptyFormulaCache.emptyCellsByPath.get(worksheetPath)
      : undefined;
    if (document.workbook.sheetOrder!.length >= 256)
      throw new Error("A workbook can contain up to 256 sheets.");
    const id = `sheet-${crypto.randomUUID()}`;
    const imported = importWorksheet(
      worksheet,
      id,
      warnings,
      emptyFormulaCells,
      importedCellCount,
    );
    importedCellCount += imported.cellsImported;
    document.workbook.sheetOrder!.push(id);
    document.workbook.sheets![id] = imported.sheet;
  });
  if (!document.workbook.sheetOrder.length)
    throw new Error("The file contains no worksheets.");
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
      throw new Error("The CSV range contains more than 200,000 cells.");
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
        targetCell.value = exportCellValue(cell);
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
