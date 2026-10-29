import type { IWorkbookData, ICellData } from "@univerjs/core";
import type { BoardElement, SectionSheet } from "../../types";
import {gridObjectSize} from './grid-geometry';
import { MAX_BOARD_FILE_BYTES } from "../../../shared/board-data.js";

export const MAX_WORKBOOK_CHARACTERS = 32 * 1024 * 1024;
export const MAX_MERGED_CELL_AREA = 200_000;
const MAX_LEGACY_CONVERSION_BYTES = MAX_BOARD_FILE_BYTES - 16 * 1024 * 1024;

export interface WorkbookDocument {
  format: "noteboard/workbook";
  version: 1;
  /** Missing in saved workbooks means the existing scrollable editor. */
  mode?: "advanced" | "simple";
  workbook: Partial<IWorkbookData>;
  activeSheetId?: string;
  preview?: string;
  /** Logical on-board viewport; previews are clipped at native cell size. */
  previewViewport?: { width: number; height: number };
  /** Univer's live scroll position is not included in workbook.save(). */
  views?: Record<string, {sheetViewStartRow: number; sheetViewStartColumn: number; offsetX: number; offsetY: number}>;
}

export function createWorkbookDocument(
  name = "Spreadsheet",
  values: (string | number)[][] = [],
  cellSize = { width: 100, height: 24 },
): WorkbookDocument {
  if (values.length > 1_048_576 || values.some((row) => row.length > 16_384))
    throw Error("The data exceeds the maximum worksheet dimensions.");
  const cellData: Record<number, Record<number, ICellData>> = {};
  values.forEach((row, r) =>
    row.forEach((value, c) => {
      if (value === "") return;
      (cellData[r] ??= {})[c] = cellFromInput(value);
    }),
  );
  return {
    format: "noteboard/workbook",
    version: 1,
    activeSheetId: "sheet-1",
    workbook: {
      id: `workbook-${crypto.randomUUID()}`,
      name,
      sheetOrder: ["sheet-1"],
      styles: {},
      sheets: {
        "sheet-1": {
          id: "sheet-1",
          name: "Sheet 1",
          rowCount: Math.min(1_048_576, Math.max(1000, values.length + 100)),
          columnCount: values.reduce(
            (count, row) => Math.max(count, row.length),
            26,
          ),
          defaultColumnWidth: cellSize.width,
          defaultRowHeight: cellSize.height,
          cellData,
        } as any,
      },
    },
  };
}

export const normalizeCellSize = (width: number, height: number) => ({
  width: Math.max(20, Math.min(1000, Number.isFinite(width) ? Math.round(width) : 100)),
  height: Math.max(12, Math.min(400, Number.isFinite(height) ? Math.round(height) : 24)),
});

export function activeWorkbookSheet(document: WorkbookDocument | null) {
  return document?.workbook.sheets?.[document.activeSheetId ?? ''] ?? document?.workbook.sheets?.[document.workbook.sheetOrder?.[0] ?? ''];
}

export function workbookCellSize(document: WorkbookDocument | null) {
  const sheet = activeWorkbookSheet(document);
  return normalizeCellSize(sheet?.columnData?.[0]?.w ?? sheet?.defaultColumnWidth ?? 100,
    sheet?.rowData?.[0]?.h ?? sheet?.defaultRowHeight ?? 24);
}

/** True only when every explicit and default cell dimension is already uniform. */
export function workbookCellDimensionsMatch(
  sheet: {
    defaultColumnWidth?: number;
    defaultRowHeight?: number;
    columnData?: { [index: number]: { w?: number } | undefined };
    rowData?: { [index: number]: { h?: number; ah?: number; ia?: number } | undefined };
  } | undefined,
  size: { width: number; height: number },
) {
  if (!sheet ||
      (sheet.defaultColumnWidth ?? 100) !== size.width ||
      (sheet.defaultRowHeight ?? 24) !== size.height) return false;
  if (Object.values(sheet.columnData ?? {}).some(column =>
    column?.w !== undefined && column.w !== size.width)) return false;
  return !Object.values(sheet.rowData ?? {}).some(row =>
    (row?.h !== undefined && row.h !== size.height) ||
    row?.ah !== undefined ||
    row?.ia === 1);
}

/** Change one workbook's active sheet, preserving values, styles and hidden rows. */
export function withWorkbookCellSize(content: string, width: number, height: number) {
  const document = content ? parseWorkbookDocument(content) : createWorkbookDocument();
  if (!document) throw Error('Invalid spreadsheet data.');
  const sheet = activeWorkbookSheet(document)!;
  document.activeSheetId=sheet.id;
  const size = normalizeCellSize(width, height);
  delete document.preview;
  delete document.previewViewport;
  sheet.defaultColumnWidth = size.width;
  sheet.defaultRowHeight = size.height;
  for (const column of Object.values(sheet.columnData ?? {})) if (column) delete column.w;
  for (const row of Object.values(sheet.rowData ?? {})) if (row) { delete row.h; delete row.ah; row.ia = 0; }
  return JSON.stringify(document);
}

export function cellFromInput(
  value: string | number,
  forceText = false,
): ICellData {
  if (typeof value === "number") return { v: value, t: 2 };
  if (forceText || value.startsWith("'"))
    return { v: forceText ? value : value.slice(1), t: 4 };
  if (value.startsWith("=")) return { f: value };
  if (
    value.trim() &&
    /^[-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?$/i.test(value.trim()) &&
    Number.isFinite(Number(value))
  )
    return { v: Number(value), t: 2 };
  return { v: value, t: 1 };
}

/** Rename imported sheet references without changing formula string literals. */
export function renameFormulaSheetReferences(
  formula: string,
  replacements: ReadonlyMap<string, string>,
) {
  const escapeSheetName = (name: string) => "'" + name.replace(/'/g, "''") + "'";
  const isBareSheetCharacter = (character: string) =>
    character !== "" &&
    !/[+\-*/^&=<>(),;!:\s'"]/.test(character);
  const readSheetToken = (start: number) => {
    if (formula[start] !== "'") {
      let end = start;
      while (end < formula.length && isBareSheetCharacter(formula[end])) end += 1;
      return end === start ? null : { name: formula.slice(start, end), end };
    }
    let name = "";
    let cursor = start + 1;
    while (cursor < formula.length) {
      if (formula[cursor] !== "'") {
        name += formula[cursor++];
        continue;
      }
      if (formula[cursor + 1] === "'") {
        name += "'";
        cursor += 2;
        continue;
      }
      return { name, end: cursor + 1 };
    }
    return { name: "", end: formula.length, malformed: true as const };
  };
  const skipWhitespace = (index: number) => {
    while (/\s/.test(formula[index] ?? "")) index += 1;
    return index;
  };
  const skipStringLiteral = (start: number) => {
    let cursor = start + 1;
    while (cursor < formula.length) {
      if (formula[cursor] !== '"') cursor += 1;
      else if (formula[cursor + 1] === '"') cursor += 2;
      else return cursor + 1;
    }
    return formula.length;
  };

  const output: string[] = [];
  let index = 0;
  while (index < formula.length) {
    if (formula[index] === '"') {
      const end = skipStringLiteral(index);
      output.push(formula.slice(index, end));
      index = end;
      continue;
    }
    const boundary = index === 0 || !/[A-Za-z0-9_.]/.test(formula[index - 1]);
    if (boundary && (formula[index] === "'" || isBareSheetCharacter(formula[index]))) {
      const firstToken = readSheetToken(index);
      if (firstToken?.malformed) {
        output.push(formula.slice(index));
        break;
      }
      if (firstToken) {
        let cursor = skipWhitespace(firstToken.end);
        let lastToken: typeof firstToken | undefined;
        if (formula[cursor] === ":") {
          cursor = skipWhitespace(cursor + 1);
          const candidate = readSheetToken(cursor);
          if (candidate?.malformed) {
            output.push(formula.slice(index));
            break;
          }
          if (candidate) {
            lastToken = candidate;
            cursor = skipWhitespace(candidate.end);
          }
        } else if (formula[index] === "'" && firstToken.name.includes(":")) {
          // Excel also quotes a complete 3D range as 'First:Last'!A1.
          const separator = firstToken.name.indexOf(":");
          lastToken = {
            name: firstToken.name.slice(separator + 1),
            end: firstToken.end,
          };
          firstToken.name = firstToken.name.slice(0, separator);
        }

        if (formula[cursor] === "!") {
          const renamedFirst = replacements.get(firstToken.name.toLowerCase()) ?? firstToken.name;
          const renamedLast = lastToken
            ? replacements.get(lastToken.name.toLowerCase()) ?? lastToken.name
            : undefined;
          if (renamedFirst === firstToken.name && renamedLast === lastToken?.name) {
            output.push(formula.slice(index, cursor + 1));
          } else {
            const range = renamedLast === undefined
              ? renamedFirst
              : renamedFirst + ":" + renamedLast;
            output.push(escapeSheetName(range) + "!");
          }
          index = cursor + 1;
          continue;
        }
        // Consume a failed candidate once instead of retrying each apostrophe.
        output.push(formula.slice(index, firstToken.end));
        index = firstToken.end;
        continue;
      }
    }
    output.push(formula[index]);
    index += 1;
  }
  return output.join("");
}

/** Assign collision-free imported names using the editor's existing suffix. */
export function createUniqueSheetNames(
  importedNames: readonly string[],
  existingNames: Iterable<string>,
) {
  const names = new Set([...existingNames].map((name) => name.toLowerCase()));
  const replacements = new Map<string, string>();
  for (const original of importedNames) {
    let name = original,
      index = 2;
    while (names.has(name.toLowerCase()))
      name = `${original.slice(0, 26)} ${index++}`;
    names.add(name.toLowerCase());
    replacements.set(original.toLowerCase(), name);
  }
  return replacements;
}

const isRecord = (value: unknown): value is Record<string, any> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

function isIndexedRecord(value: unknown, limit: number) {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([key, item]) => {
    if (!/^(?:0|[1-9]\d*)$/.test(key)) return false;
    const index = Number(key);
    return Number.isSafeInteger(index) && index < limit && isRecord(item);
  });
}

function isCellDataMatrix(value: unknown, rowCount: number, columnCount: number) {
  if (!isRecord(value)) return false;
  return Object.entries(value).every(([rowKey, row]) => {
    if (!/^(?:0|[1-9]\d*)$/.test(rowKey)) return false;
    const rowIndex = Number(rowKey);
    if (!Number.isSafeInteger(rowIndex) || rowIndex >= rowCount || !isRecord(row))
      return false;
    return Object.entries(row).every(([columnKey, cell]) => {
      if (!/^(?:0|[1-9]\d*)$/.test(columnKey)) return false;
      const columnIndex = Number(columnKey);
      if (
        !Number.isSafeInteger(columnIndex) ||
        columnIndex >= columnCount ||
        !isRecord(cell)
      )
        return false;
      if (cell.f !== undefined && typeof cell.f !== "string") return false;
      if (
        cell.v !== undefined &&
        cell.v !== null &&
        typeof cell.v !== "string" &&
        typeof cell.v !== "number" &&
        typeof cell.v !== "boolean"
      )
        return false;
      if (cell.s !== undefined && cell.s !== null && typeof cell.s !== "string" && !isRecord(cell.s))
        return false;
      if (cell.p !== undefined && cell.p !== null) {
        if (!isRecord(cell.p)) return false;
        if (cell.p.body !== undefined) {
          if (!isRecord(cell.p.body)) return false;
          if (
            cell.p.body.dataStream !== undefined &&
            typeof cell.p.body.dataStream !== "string"
          )
            return false;
        }
      }
      return true;
    });
  });
}

function hasBoundedMergeArea(ranges: readonly unknown[]) {
  let total = 0;
  for (const range of ranges) {
    if (!isRecord(range)) return false;
    const height = range.endRow - range.startRow + 1;
    const width = range.endColumn - range.startColumn + 1;
    const area = height * width;
    if (!Number.isSafeInteger(area) || area < 1 || area > MAX_MERGED_CELL_AREA - total)
      return false;
    total += area;
  }
  return true;
}

function hasValidDimensionOverrides(value: unknown, dimension: "h" | "w", limit: number) {
  return (
    value === undefined ||
    (isIndexedRecord(value, limit) &&
      Object.values(value).every((item) =>
        item[dimension] === undefined ||
        (typeof item[dimension] === "number" &&
          Number.isFinite(item[dimension]) &&
          item[dimension] > 0),
      ))
  );
}

export function parseWorkbookDocument(
  content: string,
): WorkbookDocument | null {
  if (!content || content.length > MAX_WORKBOOK_CHARACTERS) return null;
  try {
    const value = JSON.parse(content) as WorkbookDocument;
    const book = value.workbook;
    if (
      value.format !== "noteboard/workbook" ||
      value.version !== 1 ||
      !isRecord(book) ||
      typeof book.id !== "string" ||
      typeof book.name !== "string" ||
      !Array.isArray(book.sheetOrder) ||
      !book.sheetOrder.length ||
      book.sheetOrder.length > 256 ||
      !isRecord(book.sheets) ||
      (book.styles !== undefined && !isRecord(book.styles)) ||
      new Set(book.sheetOrder).size !== book.sheetOrder.length
    )
      return null;
    if (Object.keys(book.sheets).some((id) => !book.sheetOrder.includes(id)))
      return null;
    if (value.mode !== undefined && value.mode !== 'simple' && value.mode !== 'advanced') return null;
    for (const id of book.sheetOrder) {
      if (typeof id !== "string" || !Object.hasOwn(book.sheets, id))
        return null;
      const sheet = book.sheets[id];
      if (
        !isRecord(sheet) ||
        sheet.id !== id ||
        typeof sheet.id !== "string" ||
        typeof sheet.name !== "string" ||
        !Number.isInteger(sheet.rowCount) ||
        sheet.rowCount < 1 ||
        sheet.rowCount > 1048576 ||
        !Number.isInteger(sheet.columnCount) ||
        sheet.columnCount < 1 ||
        sheet.columnCount > 16384 ||
        (sheet.defaultRowHeight !== undefined &&
          (typeof sheet.defaultRowHeight !== "number" ||
            !Number.isFinite(sheet.defaultRowHeight) ||
            sheet.defaultRowHeight <= 0)) ||
        (sheet.defaultColumnWidth !== undefined &&
          (typeof sheet.defaultColumnWidth !== "number" ||
            !Number.isFinite(sheet.defaultColumnWidth) ||
            sheet.defaultColumnWidth <= 0)) ||
        (sheet.cellData !== undefined &&
          !isCellDataMatrix(sheet.cellData, sheet.rowCount, sheet.columnCount)) ||
        !hasValidDimensionOverrides(sheet.rowData, "h", sheet.rowCount) ||
        !hasValidDimensionOverrides(sheet.columnData, "w", sheet.columnCount) ||
        (sheet.mergeData !== undefined &&
          (!Array.isArray(sheet.mergeData) ||
            !hasBoundedMergeArea(sheet.mergeData) ||
            sheet.mergeData.some(
              (range: any) =>
                !isRecord(range) ||
                !Number.isInteger(range.startRow) ||
                !Number.isInteger(range.endRow) ||
                !Number.isInteger(range.startColumn) ||
                !Number.isInteger(range.endColumn) ||
                range.startRow < 0 ||
                range.startRow > range.endRow ||
                range.endRow >= sheet.rowCount ||
                range.startColumn < 0 ||
                range.startColumn > range.endColumn ||
                range.endColumn >= sheet.columnCount,
            )))
      )
        return null;
    }
    if (
      value.preview &&
      !/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(value.preview)
    )
      delete value.preview;
    if (!value.preview || !Number.isFinite(value.previewViewport?.width) ||
      !Number.isFinite(value.previewViewport?.height) ||
      value.previewViewport!.width <= 0 || value.previewViewport!.height <= 0)
      delete value.previewViewport;
    if (value.views && (typeof value.views !== 'object' || Array.isArray(value.views))) delete value.views;
    for (const [id,view] of Object.entries(value.views ?? {})) {
      const sheet = book.sheets[id];
      if (!Object.hasOwn(book.sheets,id) || !view ||
        !Number.isInteger(view.sheetViewStartRow) || view.sheetViewStartRow < 0 || view.sheetViewStartRow >= sheet.rowCount ||
        !Number.isInteger(view.sheetViewStartColumn) || view.sheetViewStartColumn < 0 || view.sheetViewStartColumn >= sheet.columnCount ||
        !Number.isFinite(view.offsetX) || !Number.isFinite(view.offsetY)) delete value.views![id];
    }
    return value;
  } catch {
    return null;
  }
}

const utf8ByteLength = (value: string) => {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x7f) bytes += 1;
    else if (code <= 0x7ff) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
      bytes += 4;
      index += 1;
    } else bytes += 3;
  }
  return bytes;
};

const plain = (value: string) => {
  const chunks: string[] = [];
  let cursor = 0;
  while (cursor < value.length) {
    const open = value.indexOf("<", cursor);
    if (open < 0) {
      chunks.push(value.slice(cursor));
      break;
    }
    if (open > cursor) chunks.push(value.slice(cursor, open));
    let close = open + 1;
    while (close < value.length && value.charCodeAt(close) !== 62) close += 1;
    if (close === value.length) {
      chunks.push(value.slice(open));
      break;
    }
    const tag = value.slice(open + 1, close).trim();
    const isBreak = tag.slice(0, 2).toLowerCase() === "br" &&
      (tag.slice(2).trim() === "" || tag.slice(2).trim() === "/");
    if (isBreak) chunks.push("\n");
    cursor = close + 1;
  }
  return chunks.join("")
    .replaceAll("&nbsp;", " ")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
};

/** One-way import adapter. Old Section cells no longer act as a formula engine. */
export function upgradeLegacyWorkbooks(
  elements: readonly BoardElement[],
  sheets: readonly SectionSheet[],
): BoardElement[] {
  if (!sheets.length) return [...elements];
  const byId = new Map(elements.map((element) => [element.id, element]));
  const plainById = new Map<string, string>();
  const referencedCellIds = new Set<string>();
  let conversionBytes = 0;
  for (const sheet of sheets) {
    if (!Array.isArray(sheet.cellIds)) throw Error("Legacy spreadsheet cells are invalid.");
    for (const row of sheet.cellIds) {
      if (!Array.isArray(row)) throw Error("Legacy spreadsheet rows are invalid.");
      for (const id of row) {
        if (typeof id !== "string" || !byId.has(id)) continue;
        if (referencedCellIds.has(id))
          throw Error("A legacy spreadsheet cell is referenced more than once.");
        referencedCellIds.add(id);
        const text = plain(byId.get(id)?.content ?? "");
        conversionBytes += utf8ByteLength(text);
        if (conversionBytes > MAX_LEGACY_CONVERSION_BYTES)
          throw Error("Legacy spreadsheet conversion exceeds the board size limit.");
        plainById.set(id, text);
      }
    }
  }
  const consumed = new Set<string>(),
    replacements = new Map<string, string>(),
    tables: BoardElement[] = [],
    usedIds = new Set(byId.keys());
  for (const sheet of sheets) {
    const cells = sheet.cellIds
      .flat()
      .map((id) => byId.get(id))
      .filter((item): item is BoardElement => Boolean(item));
    if (!cells.length) continue;
    const values = sheet.cellIds.map((row) =>
      row.map((id) => (typeof id === "string" ? plainById.get(id) : undefined) ?? ""),
    );
    const document = createWorkbookDocument(
      sheet.name || "Spreadsheet",
      values,
    );
    const target = document.workbook.sheets!["sheet-1"];
    sheet.cellIds.forEach((row, r) =>
      row.forEach((id, c) => {
        const old = byId.get(id);
        if (!old) return;
        const borderColor = old.borderColor;
        const borderThickness = old.borderWidth ?? 0;
        const hasLegacyBorder = typeof borderColor === "string" && borderColor !== "transparent" && borderThickness > 0;
        const borderStyle = borderThickness >= 3 ? 13 : borderThickness >= 2 ? 8 : 1;
        const border = hasLegacyBorder
          ? { s: borderStyle, cl: { rgb: borderColor! } }
          : undefined;
        (target.cellData![r] ??= {})[c] = {
          ...cellFromInput(plainById.get(id) ?? "", old.sheetCell?.valueType === "text"),
          s: {
            ...(old.isBold ? { bl: 1 as const } : {}),
            ...(old.isItalic ? { it: 1 as const } : {}),
            ...(old.textAlign ? { ht: ({ left: 1, center: 2, right: 3 } as const)[old.textAlign] } : {}),
            ...(old.color && old.color !== "transparent"
              ? { bg: { rgb: old.color } }
              : {}),
            ...(old.textColor ? { cl: { rgb: old.textColor } } : {}),
            ...(old.fontSize ? { fs: old.fontSize * 0.75 } : {}),
            ...(border ? { bd: { t: border, r: border, b: border, l: border } } : {}),
          },
        };
      }),
    );
    target.columnData = Object.fromEntries(
      (sheet.columnOrder ?? []).map((id, c) => [
        c,
        { w: sheet.columns?.[id]?.width ?? 100 },
      ]),
    );
    target.rowData = Object.fromEntries(
      (sheet.rowOrder ?? []).map((id, r) => [
        r,
        { h: sheet.rows?.[id]?.height ?? 24 },
      ]),
    );
    const workbookContent = JSON.stringify(document);
    if (workbookContent.length > MAX_WORKBOOK_CHARACTERS || utf8ByteLength(workbookContent) > MAX_LEGACY_CONVERSION_BYTES)
      throw Error("Legacy spreadsheet conversion exceeds the workbook size limit.");
    let x = Infinity,
      y = Infinity,
      right = -Infinity,
      bottom = -Infinity,
      zIndex = -Infinity;
    for (const cell of cells) {
      x = Math.min(x, cell.position.x);
      y = Math.min(y, cell.position.y);
      right = Math.max(right, cell.position.x + (cell.size?.width ?? 120));
      bottom = Math.max(bottom, cell.position.y + (cell.size?.height ?? 48));
      zIndex = Math.max(zIndex, cell.zIndex);
    }
    let id = `workbook-${sheet.id.slice(0, 180)}`;
    while (usedIds.has(id)) id = `workbook-${crypto.randomUUID()}`;
    usedIds.add(id);
    tables.push({
      id,
      type: "table",
      name: sheet.name,
      content: workbookContent,
      position: { x, y },
      size: { width: Math.max(1, right - x), height: Math.max(1, bottom - y) },
      zIndex,
      parentId: cells[0].parentId,
      keepRatio: true,
      isHidden: cells.every((cell) => cell.isHidden === true) || undefined,
      isLocked: cells.every((cell) => cell.isLocked === true) || undefined,
      isLinkTarget:
        cells.some((cell) => cell.isLinkTarget === true) || undefined,
    });
    cells.forEach((cell) => {
      consumed.add(cell.id);
      replacements.set(cell.id, id);
    });
  }
  const kept = elements
    .filter((element) => !consumed.has(element.id))
    .map((element) => ({
      ...element,
      sheetCell: undefined,
      parentId:
        element.parentId && consumed.has(element.parentId)
          ? undefined
          : element.parentId,
      linkToId:
        element.linkToId && replacements.has(element.linkToId)
          ? replacements.get(element.linkToId)
          : element.linkToId,
      content: element.content.replace(
        /(href\s*=\s*["'])#target-([a-zA-Z0-9_-]+)(["'])/gi,
        (match, prefix, id, suffix) =>
          replacements.has(id)
            ? `${prefix}#target-${replacements.get(id)}${suffix}`
            : match,
      ),
    }));
  return [
    ...kept,
    ...tables.map((table) => ({
      ...table,
      parentId:
        table.parentId && consumed.has(table.parentId)
          ? undefined
          : table.parentId,
    })),
  ];
}

export function readLiveWorkbookSnapshots(elements: readonly BoardElement[],forHistory=false) {
  const live = new Map<string, { content: string; document: WorkbookDocument }>();
  document
    .querySelectorAll<HTMLIFrameElement>("iframe[data-spreadsheet-element-id]")
    .forEach((frame) => {
      // A temporary thumbnail renderer owns no user input or document edits.
      if (frame.dataset.spreadsheetReadonly === "true") return;
      try {
        const api=(frame.contentWindow as any)?.noteboardSheet;
        // The bridge exists before its init handshake. An empty history value
        // in that interval is not an intentional workbook deletion.
        if (api?.isReady?.() === false) return;
        const value=forHistory ? api?.historySnapshot?.() ?? api?.snapshot?.() : api?.snapshot?.();
        if (typeof value === "string") {
          const document = parseWorkbookDocument(value);
          if (document)
            live.set(frame.dataset.spreadsheetElementId!, { content: value, document });
        }
      } catch {
        /* An attaching frame keeps the saved snapshot. */
      }
    });
  return elements.map((element) =>
    live.has(element.id)
      ? (() => {
          const snapshot = live.get(element.id)!;
          const size = snapshot.document?.mode === 'simple' ? gridObjectSize(snapshot.document) : undefined;
          return { ...element, content: snapshot.content, ...(size ? { size } : {}) };
        })()
      : element,
  );
}
