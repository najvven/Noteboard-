import type { IWorkbookData, ICellData } from "@univerjs/core";
import type { BoardElement, SectionSheet } from "../../types";
import {gridObjectSize} from './grid-geometry';

export const MAX_WORKBOOK_CHARACTERS = 32 * 1024 * 1024;

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
  const quotedOrUnquotedSheet =
    String.raw`(?:'((?:[^']|'')+)'|([^+\-*/^&=<>(),;!:\s'"]+))`;
  const reference = new RegExp(
    String.raw`(?<![A-Za-z0-9_.])${quotedOrUnquotedSheet}(?:\s*:\s*${quotedOrUnquotedSheet})?!`,
    "g",
  );
  const escapeSheetName = (name: string) => `'${name.replace(/'/g, "''")}'`;
  const renameReferences = (part: string) =>
    part.replace(
      reference,
      (match, firstQuoted, firstBare, lastQuoted, lastBare) => {
        let first = (firstQuoted ?? firstBare).replace(/''/g, "'");
        let last = lastQuoted ?? lastBare;
        // Excel also quotes a complete 3D range as 'First:Last'!A1.
        if (last === undefined && firstQuoted && first.includes(":")) {
          const separator = first.indexOf(":");
          last = first.slice(separator + 1);
          first = first.slice(0, separator);
        } else if (last !== undefined) {
          last = last.replace(/''/g, "'");
        }
        const renamedFirst = replacements.get(first.toLowerCase()) ?? first;
        const renamedLast =
          last === undefined
            ? undefined
            : replacements.get(last.toLowerCase()) ?? last;
        if (renamedFirst === first && renamedLast === last) return match;
        const range = renamedLast === undefined
          ? escapeSheetName(renamedFirst)
          : escapeSheetName(`${renamedFirst}:${renamedLast}`);
        return `${range}!`;
      },
    );

  return formula
    .split(/("(?:[^"]|"")*")/g)
    .map((part, index) => (index % 2 ? part : renameReferences(part)))
    .join("");
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

const plain = (value: string) =>
  value
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");

/** One-way import adapter. Old Section cells no longer act as a formula engine. */
export function upgradeLegacyWorkbooks(
  elements: readonly BoardElement[],
  sheets: readonly SectionSheet[],
): BoardElement[] {
  if (!sheets.length) return [...elements];
  const byId = new Map(elements.map((element) => [element.id, element]));
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
      row.map((id) => plain(byId.get(id)?.content ?? "")),
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
        (target.cellData![r] ??= {})[c] = {
          ...cellFromInput(
            plain(old.content),
            old.sheetCell?.valueType === "text",
          ),
          s: {
            ...(old.isBold ? { bl: 1 as const } : {}),
            ...(old.isItalic ? { it: 1 as const } : {}),
            ...(old.color && old.color !== "transparent"
              ? { bg: { rgb: old.color } }
              : {}),
            ...(old.textColor ? { cl: { rgb: old.textColor } } : {}),
            ...(old.fontSize ? { fs: old.fontSize * 0.75 } : {}),
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
      content: JSON.stringify(document),
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
  const live = new Map<string, string>();
  document
    .querySelectorAll<HTMLIFrameElement>("iframe[data-spreadsheet-element-id]")
    .forEach((frame) => {
      // A temporary thumbnail renderer owns no user input or document edits.
      if (frame.dataset.spreadsheetReadonly === "true") return;
      try {
        const api=(frame.contentWindow as any)?.noteboardSheet;
        const value=forHistory ? api?.historySnapshot?.() ?? api?.snapshot?.() : api?.snapshot?.();
        if (typeof value === "string" && ((forHistory && value==='') || parseWorkbookDocument(value)))
          live.set(frame.dataset.spreadsheetElementId!, value);
      } catch {
        /* An attaching frame keeps the saved snapshot. */
      }
    });
  return elements.map((element) =>
    live.has(element.id)
      ? { ...element, content: live.get(element.id)!,...(parseWorkbookDocument(live.get(element.id)!)?.mode==='simple'?{size:gridObjectSize(parseWorkbookDocument(live.get(element.id)!))}:{}) }
      : element,
  );
}
