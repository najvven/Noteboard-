import type { IWorkbookData, ICellData } from "@univerjs/core";
import type { BoardElement, SectionSheet } from "../../types";

export const MAX_WORKBOOK_CHARACTERS = 32 * 1024 * 1024;

export interface WorkbookDocument {
  format: "noteboard/workbook";
  version: 1;
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
      !book ||
      typeof book.id !== "string" ||
      !Array.isArray(book.sheetOrder) ||
      !book.sheetOrder.length ||
      book.sheetOrder.length > 256 ||
      !book.sheets
    )
      return null;
    for (const id of book.sheetOrder) {
      if (typeof id !== "string" || !Object.hasOwn(book.sheets, id))
        return null;
      const sheet = book.sheets[id];
      if (
        !sheet ||
        !Number.isInteger(sheet.rowCount) ||
        sheet.rowCount < 1 ||
        sheet.rowCount > 1048576 ||
        !Number.isInteger(sheet.columnCount) ||
        sheet.columnCount < 1 ||
        sheet.columnCount > 16384
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
      ? { ...element, content: live.get(element.id)! }
      : element,
  );
}
