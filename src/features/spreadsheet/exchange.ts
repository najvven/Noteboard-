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
function scanXml(xml: string, visit: (token: XmlToken) => void) {
  const stack: Array<{ name: string; localName: string }> = [];
  let position = 0;
  let rootSeen = false;
  const malformed = () => { throw Error("The workbook contains malformed XML."); };
  const localName = (name: string) => {
    const separator = name.indexOf(":");
    if (separator === 0 || separator === name.length - 1 ||
        (separator >= 0 && name.indexOf(":", separator + 1) >= 0)) malformed();
    return separator < 0 ? name : name.slice(separator + 1);
  };
  const readName = (start: number) => {
    let end = start;
    if (end >= xml.length || !isXmlNameStart(xml.charCodeAt(end))) malformed();
    end += 1;
    while (end < xml.length && isXmlNameChar(xml.charCodeAt(end))) end += 1;
    if (end - start > MAX_XML_NAME_LENGTH) malformed();
    const name = xml.slice(start, end);
    localName(name);
    return { name, end };
  };
  const emitText = (start: number, end: number) => {
    if (start >= end) return;
    if (!stack.length) {
      for (let index = start; index < end; index += 1) {
        const code = xml.charCodeAt(index);
        if (!isXmlWhitespace(code) && code !== 0xfeff) malformed();
      }
      return;
    }
    visit({ type: "text", start, end });
  };

  while (position < xml.length) {
    const open = xml.indexOf("<", position);
    if (open < 0) {
      emitText(position, xml.length);
      position = xml.length;
      break;
    }
    emitText(position, open);
    if (xml.startsWith("<!--", open)) {
      const close = xml.indexOf("-->", open + 4);
      if (close < 0) malformed();
      position = close + 3;
      continue;
    }
    if (xml.startsWith("<![CDATA[", open)) {
      if (!stack.length) malformed();
      const close = xml.indexOf("]]>", open + 9);
      if (close < 0) malformed();
      visit({ type: "text", start: open + 9, end: close });
      position = close + 3;
      continue;
    }
    if (xml.startsWith("<?", open)) {
      const close = xml.indexOf("?>", open + 2);
      if (close < 0) malformed();
      position = close + 2;
      continue;
    }
    if (xml.startsWith("<!", open)) malformed();

    let index = open + 1;
    const closing = xml[index] === "/";
    if (closing) index += 1;
    const parsedName = readName(index);
    const name = parsedName.name;
    index = parsedName.end;
    const qLocalName = localName(name);
    const parentLocalName = stack.at(closing ? -2 : -1)?.localName;
    if (closing) {
      while (index < xml.length && isXmlWhitespace(xml.charCodeAt(index))) index += 1;
      if (xml[index] !== ">" || stack.at(-1)?.name !== name) malformed();
      visit({ type: "end", name, localName: qLocalName, parentLocalName, start: open, end: index + 1 });
      stack.pop();
      position = index + 1;
      continue;
    }

    const attributes = new Map<string, string>();
    let selfClosing = false;
    while (index < xml.length) {
      while (index < xml.length && isXmlWhitespace(xml.charCodeAt(index))) index += 1;
      if (xml[index] === ">") {
        index += 1;
        break;
      }
      if (xml[index] === "/") {
        if (xml[index + 1] !== ">") malformed();
        selfClosing = true;
        index += 2;
        break;
      }
      const attribute = readName(index);
      index = attribute.end;
      while (index < xml.length && isXmlWhitespace(xml.charCodeAt(index))) index += 1;
      if (xml[index] !== "=") malformed();
      index += 1;
      while (index < xml.length && isXmlWhitespace(xml.charCodeAt(index))) index += 1;
      const quote = xml[index];
      if (quote !== "\"" && quote !== "'") malformed();
      index += 1;
      const valueStart = index;
      while (index < xml.length && xml[index] !== quote) {
        if (xml[index] === "<") malformed();
        index += 1;
      }
      if (index >= xml.length) malformed();
      if (attributes.has(attribute.name)) malformed();
      if (attributes.size >= MAX_XML_ATTRIBUTES) malformed();
      attributes.set(attribute.name, xml.slice(valueStart, index));
      index += 1;
    }
    if (index > xml.length || xml[index - 1] !== ">") malformed();
    if (!stack.length) {
      if (rootSeen) malformed();
      rootSeen = true;
    }
    const token = { type: "start" as const, name, localName: qLocalName, parentLocalName,
      attributes, selfClosing, start: open, end: index };
    visit(token);
    if (selfClosing) {
      visit({ type: "end", name, localName: qLocalName, parentLocalName, start: open, end: index });
    } else {
      if (stack.length >= MAX_XML_DEPTH) malformed();
      stack.push({ name, localName: qLocalName });
    }
    position = index;
  }
  if (!rootSeen || stack.length) malformed();
}

function parseBoundedInteger(value: string | undefined, maximum: number) {
  if (value === undefined || !value.length) return undefined;
  let number = 0;
  for (let index = 0; index < value.length; index += 1) {
    const digit = value.charCodeAt(index) - 0x30;
    if (digit < 0 || digit > 9) return undefined;
    number = number * 10 + digit;
    if (!Number.isSafeInteger(number) || number > maximum) return maximum + 1;
  }
  return number;
}

function parseCellAddress(address: string, absolute = false) {
  let index = 0;
  if (absolute && address[index] === "$") index += 1;
  let column = 0;
  let letters = 0;
  while (index < address.length) {
    const code = address.charCodeAt(index);
    const upper = code >= 0x61 && code <= 0x7a ? code - 0x20 : code;
    if (upper < 0x41 || upper > 0x5a) break;
    if (++letters > 3) throw Error("The workbook contains an invalid cell reference.");
    column = column * 26 + upper - 0x40;
    index += 1;
  }
  if (!letters) throw Error("The workbook contains an invalid cell reference.");
  if (absolute && address[index] === "$") index += 1;
  let row = 0;
  let digits = 0;
  while (index < address.length) {
    const digit = address.charCodeAt(index) - 0x30;
    if (digit < 0 || digit > 9) throw Error("The workbook contains an invalid cell reference.");
    digits += 1;
    row = row * 10 + digit;
    if (row > MAX_ROWS) throw Error("The workbook contains an invalid cell reference.");
    index += 1;
  }
  if (column < 1 || column > MAX_COLUMNS || !digits || row < 1 || row > MAX_ROWS)
    throw Error("The workbook contains an invalid cell reference.");
  return { row, column };
}

function parseCellRange(address: string) {
  const separator = address.indexOf(":");
  if (separator >= 0 && address.indexOf(":", separator + 1) >= 0)
    throw Error("The workbook contains an invalid merged range.");
  const start = parseCellAddress(separator < 0 ? address : address.slice(0, separator), true);
  const end = separator < 0 ? start : parseCellAddress(address.slice(separator + 1), true);
  if (end.column < start.column || end.row < start.row)
    throw Error("The workbook contains an invalid merged range.");
  return { start, end };
}

function addWarning(warnings: string[], warning: string) {
  if (!warnings.includes(warning)) warnings.push(warning);
}

/** Validate worksheet XML and bound materialization before ExcelJS loads it. */
async function preflightWorkbookImport(zip: JSZip, warnings: string[]) {
  let materializedCellBudget = 0;
  let totalRowRecordCount = 0;
  let normalizedImplicitCells = false;
  let worksheetPartCount = 0;
  for (const path in zip.files) {
    const entry = zip.files[path];
    if (entry.dir || !/^xl\/worksheets\/[^/]+\.xml$/i.test(path)) continue;
    if (++worksheetPartCount > 256)
      throw Error("A workbook can contain up to 256 sheets.");
    const xml = await entry.async("string");
    let rowRecordCount = 0;
    const explicitRowIndexes = new Set<number>();
    const cellAddresses = new Set<string>();
    const columnDefinitionCoverage = new Uint8Array(MAX_COLUMNS);
    const implicitAddressInsertions: Array<{ offset: number; value: string }> = [];
    let currentRow: {
      rowNumber?: number;
      previousAddress?: { row: number; column: number };
      rowNumberInsertionOffset: number;
    } | undefined;
    scanXml(xml, token => {
      const tag = token.localName?.toLowerCase();
      const parent = token.parentLocalName?.toLowerCase();
      if (token.type === "start" && tag === "row") {
        if (parent !== "sheetdata") return;
        if (currentRow) throw Error("The workbook contains an invalid worksheet row.");
        const rowText = token.attributes?.get("r")?.trim();
        let rowNumber: number | undefined;
        if (rowText !== undefined) {
          const parsed = parseBoundedInteger(rowText, MAX_ROWS);
          if (parsed === undefined || parsed < 1 || parsed > MAX_ROWS)
            throw Error("The workbook contains an invalid row reference.");
          rowNumber = parsed;
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
        currentRow = { rowNumber, rowNumberInsertionOffset: token.end - 1 };
        return;
      }
      if (token.type === "end" && tag === "row" && parent === "sheetdata") {
        if (currentRow?.rowNumber === undefined)
          throw Error("The workbook contains a worksheet row without a usable row number.");
        currentRow = undefined;
        return;
      }
      if (token.type !== "start") return;
      const attributes = token.attributes!;
      if (tag === "c") {
        if (parent !== "row") return;
        if (!currentRow) throw Error("The workbook contains a cell outside a worksheet row.");
        if (materializedCellBudget >= MAX_CELLS)
          throw Error("The workbook contains more than 200,000 cells.");
        const reference = attributes.get("r")?.trim();
        let address: { row: number; column: number };
        if (reference !== undefined) {
          address = parseCellAddress(reference);
          if (currentRow.rowNumber === undefined) {
            if (explicitRowIndexes.has(address.row))
              throw Error("The workbook contains duplicate worksheet row references.");
            currentRow.rowNumber = address.row;
            explicitRowIndexes.add(address.row);
            implicitAddressInsertions.push({
              offset: currentRow.rowNumberInsertionOffset,
              value: ` r="${address.row}"`,
            });
            normalizedImplicitCells = true;
          }
          if (address.row !== currentRow.rowNumber)
            throw Error("The workbook contains a cell reference that does not match its worksheet row.");
        } else if (currentRow.previousAddress) {
          address = { row: currentRow.previousAddress.row, column: currentRow.previousAddress.column + 1 };
          if (address.column > MAX_COLUMNS)
            throw Error("The workbook contains an invalid cell reference.");
        } else if (currentRow.rowNumber !== undefined) {
          address = { row: currentRow.rowNumber, column: 1 };
          implicitAddressInsertions.push({
            offset: token.selfClosing ? token.end - 2 : token.end - 1,
            value: ` r="A${currentRow.rowNumber}"`,
          });
          normalizedImplicitCells = true;
        } else {
          throw Error("The workbook contains a cell without a reference or row number.");
        }
        const key = `${address.row}:${address.column}`;
        if (cellAddresses.has(key))
          throw Error("The workbook contains duplicate cell references.");
        if (cellAddresses.size >= MAX_CELLS)
          throw Error("The workbook contains more than 200,000 cells.");
        cellAddresses.add(key);
        currentRow.previousAddress = address;
        materializedCellBudget += 1;
        return;
      }
      if (tag === "col") {
        if (parent !== "cols") return;
        const min = parseBoundedInteger(attributes.get("min")?.trim(), MAX_COLUMNS);
        const max = parseBoundedInteger(attributes.get("max")?.trim(), MAX_COLUMNS);
        const widthText = attributes.get("width");
        const width = widthText === undefined ? undefined : Number(widthText);
        if (
          min === undefined || max === undefined || min < 1 || min > MAX_COLUMNS ||
          max < min || max > MAX_COLUMNS ||
          (width !== undefined && (!Number.isFinite(width) || width < 0))
        ) throw Error("The workbook contains invalid column definitions.");
        for (let column = min; column <= max; column += 1) {
          if (columnDefinitionCoverage[column - 1])
            throw Error("The workbook contains overlapping column definitions.");
          columnDefinitionCoverage[column - 1] = 1;
        }
        if (attributes.has("bestFit") || attributes.has("outlineLevel") || attributes.has("collapsed"))
          addWarning(warnings, "Column best-fit and outline metadata is not imported.");
        return;
      }
      if (tag === "mergecell") {
        if (parent !== "mergecells") return;
        const reference = attributes.get("ref");
        if (reference === undefined) throw Error("The workbook contains an invalid merged range.");
        const { start, end } = parseCellRange(reference);
        const area = (end.column - start.column + 1) * (end.row - start.row + 1);
        materializedCellBudget += area;
        if (materializedCellBudget > MAX_CELLS)
          throw Error("The workbook contains merged ranges exceeding the 200,000 cell limit.");
      }
    });
    if (currentRow) throw Error("The workbook contains an unclosed worksheet row.");
    if (implicitAddressInsertions.length) {
      const parts: string[] = [];
      let cursor = 0;
      for (const insertion of implicitAddressInsertions) {
        parts.push(xml.slice(cursor, insertion.offset), insertion.value);
        cursor = insertion.offset;
      }
      parts.push(xml.slice(cursor));
      zip.file(path, parts.join(""));
    }
  }
  return normalizedImplicitCells;
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
    if (!target) return;
    const segments: string[] = [];
    for (const segment of (target.startsWith("/") ? target.slice(1) : `xl/${target}`).split("/")) {
      if (!segment || segment === ".") continue;
      if (segment === "..") segments.pop();
      else segments.push(segment);
    }
    const path = segments.join("/");
    orderedPaths.push(/^xl\/worksheets\/[^/]+\.xml$/i.test(path) ? path : "");
  });
  for (const path of orderedPaths) {
    if (!path) continue;
    const entry = zip.file(path);
    if (!entry) continue;
    const xml = await entry.async("string");
    const cells = new Set<string>();
    let cell: { address?: string; type?: string; formula: boolean; inValue: boolean; valueHasText: boolean; emptyValue: boolean } | undefined;
    scanXml(xml, token => {
      const tag = token.localName?.toLowerCase();
      if (token.type === "start" && tag === "c" && token.parentLocalName?.toLowerCase() === "row") {
        cell = { address: token.attributes?.get("r"), type: token.attributes?.get("t"), formula: false, inValue: false, valueHasText: false, emptyValue: false };
      } else if (token.type === "start" && tag === "f" && cell) {
        cell.formula = true;
      } else if (token.type === "start" && tag === "v" && cell) {
        cell.inValue = true;
        cell.valueHasText = false;
      } else if (token.type === "text" && cell?.inValue) {
        for (let index = token.start; index < token.end; index += 1) {
          if (!isXmlWhitespace(xml.charCodeAt(index))) {
            cell.valueHasText = true;
            break;
          }
        }
      } else if (token.type === "end" && tag === "v" && cell) {
        cell.emptyValue = !cell.valueHasText;
        cell.inValue = false;
      } else if (token.type === "end" && tag === "c" && cell) {
        if (cell.address && cell.type === "str" && cell.formula && cell.emptyValue)
          cells.add(cell.address);
        cell = undefined;
      }
    });
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
    const worksheetModel = worksheet.model as unknown as {
      cols?: Array<{
        min?: number; max?: number; width?: number; hidden?: boolean;
        style?: Partial<ExcelJS.Style>; outlineLevel?: number; collapsed?: boolean; bestFit?: boolean;
      }>;
      merges?: string[];
    };
    const declaredColumns = worksheetModel.cols ?? [];
    const mergedRanges = worksheetModel.merges ?? [];
    const defaultExcelColumnWidth = worksheet.properties.defaultColWidth ?? 9;
    const hasColumnStyle = (column: NonNullable<typeof declaredColumns[number]>) =>
      Boolean(column.style && Object.keys(column.style).length);
    const hasMeaningfulColumnState = (column: NonNullable<typeof declaredColumns[number]>) =>
      column.hidden === true ||
      (typeof column.width === "number" && Number.isFinite(column.width) &&
        column.width > 0 && column.width !== defaultExcelColumnWidth) ||
      hasColumnStyle(column) || Boolean(column.outlineLevel || column.collapsed || column.bestFit);
    const declaredColumnCount = declaredColumns.reduce((maximum, column) => {
      const first = column.min ?? 0, last = column.max ?? 0;
      const isSingleColumn = first === last;
      const isBoundedSpan = first < last && last < MAX_COLUMNS;
      return (isSingleColumn || isBoundedSpan) && hasMeaningfulColumnState(column)
        ? Math.max(maximum, last)
        : maximum;
    }, 0);
    const mergedColumnCount = mergedRanges.reduce((maximum, address) => {
      const endpoint = address.split(":").at(-1) ?? address;
      return Math.max(maximum, parseCellAddress(endpoint).column);
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
    for (const column of declaredColumns) {
      const first = column.min ?? 0, last = column.max ?? 0;
      if (
        !Number.isInteger(first) || !Number.isInteger(last) || first < 1 ||
        last < first || last > MAX_COLUMNS
      ) throw Error("The workbook contains invalid column definitions.");
      const width = column.width;
      const customWidth = typeof width === "number" && Number.isFinite(width) &&
        width > 0 && width !== defaultExcelColumnWidth;
      const sourceHasStyle = hasColumnStyle(column);
      const convertedStyle = column.style ? fromStyle(column.style) : undefined;
      const style = convertedStyle && Object.keys(convertedStyle).length ? convertedStyle : undefined;
      if (sourceHasStyle && !style)
        addWarning(warnings, "Some spreadsheet column styles are not supported and were omitted.");
      if (last > sheet.columnCount! && hasMeaningfulColumnState(column))
        addWarning(warnings, "Formatting for empty columns outside the active imported range was omitted.");
      const activeFirst = Math.max(1, first), activeLast = Math.min(last, sheet.columnCount!);
      if (activeFirst > activeLast) continue;
      const override = {
        ...(customWidth ? { w: excelColumnWidthToPixels(width!) } : {}),
        ...(column.hidden ? { hd: 1 as const } : {}),
        ...(style ? { s: style } : {}),
      };
      if (!Object.keys(override).length) continue;
      // ExcelJS normalizes column definitions into sorted, non-overlapping
      // spans. Clipping each span to active geometry bounds total expansion.
      for (let c = activeFirst; c <= activeLast; c += 1)
        sheet.columnData![c - 1] = override;
    }
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
