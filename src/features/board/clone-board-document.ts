import type { BoardElement, SectionSheet } from "../../types";
import {
  createDefaultSectionSheetAutomations,
  DEFAULT_SECTION_SHEET_SHORTCUTS,
  SECTION_SHEET_COMMAND_BY_ACTION,
} from "../spreadsheet/types";
import { isHttpBoardLink } from "./link-target";

export interface ClonedBoardDocument {
  elements: BoardElement[];
  sheets: SectionSheet[];
}

export interface CloneBoardDocumentOptions {
  preserveExternalParents?: boolean;
  preserveExternalLinks?: boolean;
}

const defaultCreateId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function cloneBoardDocument(
  elements: readonly BoardElement[],
  sheets: readonly SectionSheet[] = [],
  createId: () => string = defaultCreateId,
  options: CloneBoardDocumentOptions = {},
): ClonedBoardDocument {
  const elementIds = new Map(
    elements.map((element) => [element.id, `element-${createId()}`]),
  );
  const sheetIds = new Map(
    sheets.map((sheet) => [sheet.id, `sheet-${createId()}`]),
  );
  const rowIds = new Map<string, string>();
  const columnIds = new Map<string, string>();

  sheets.forEach((sheet) => {
    sheet.rowOrder.forEach((rowId) => {
      rowIds.set(`${sheet.id}:${rowId}`, `row-${createId()}`);
    });
    sheet.columnOrder.forEach((columnId) => {
      columnIds.set(`${sheet.id}:${columnId}`, `column-${createId()}`);
    });
  });

  const clonedSheets = sheets.map((sheet) => {
    const nextSheetId = sheetIds.get(sheet.id)!;
    const nextRowOrder = sheet.rowOrder.map(
      (rowId) => rowIds.get(`${sheet.id}:${rowId}`)!,
    );
    const nextColumnOrder = sheet.columnOrder.map(
      (columnId) => columnIds.get(`${sheet.id}:${columnId}`)!,
    );
    const shortcuts = {
      ...DEFAULT_SECTION_SHEET_SHORTCUTS,
      ...(sheet.shortcuts ?? {}),
    };
    const sourceAutomations =
      sheet.automations?.length
        ? sheet.automations
        : createDefaultSectionSheetAutomations(
            (action) => `automation-${sheet.id}-${action}`,
            shortcuts,
          );
    return {
      ...sheet,
      id: nextSheetId,
      rowOrder: nextRowOrder,
      columnOrder: nextColumnOrder,
      rows: Object.fromEntries(
        sheet.rowOrder.map((rowId, index) => {
          const nextId = nextRowOrder[index];
          return [nextId, { ...sheet.rows[rowId], id: nextId }];
        }),
      ),
      columns: Object.fromEntries(
        sheet.columnOrder.map((columnId, index) => {
          const nextId = nextColumnOrder[index];
          return [nextId, { ...sheet.columns[columnId], id: nextId }];
        }),
      ),
      cellIds: sheet.cellIds.map((row) =>
        row.map((id) => elementIds.get(id) ?? id),
      ),
      shortcuts,
      automations: sourceAutomations.map((automation) => ({
        ...automation,
        id: `automation-${createId()}`,
        shortcut: shortcuts[SECTION_SHEET_COMMAND_BY_ACTION[automation.action]],
      })),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } satisfies SectionSheet;
  });

  const clonedElements = elements.map((element, index) => {
    const cell = element.sheetCell;
    const nextSheetId = cell ? sheetIds.get(cell.sheetId) : undefined;
    return {
      ...element,
      id: elementIds.get(element.id)!,
      parentId: element.parentId
        ? elementIds.get(element.parentId) ??
          (options.preserveExternalParents ? element.parentId : undefined)
        : undefined,
      linkToId: element.linkToId
        ? elementIds.get(element.linkToId) ??
          (isHttpBoardLink(element.linkToId) || options.preserveExternalLinks
            ? element.linkToId
            : undefined)
        : undefined,
      content: remapRichTextTargets(
        element.content,
        elementIds,
        options.preserveExternalLinks === true,
      ),
      position: { ...element.position },
      ...(element.type === 'embed' ? { webSessionId: elementIds.get(element.id)! } : {}),
      zIndex: Number.isFinite(element.zIndex) ? element.zIndex : index,
      size: element.size ? { ...element.size } : undefined,
      points: element.points?.map((point) => ({ ...point })),
      sheetCell:
        cell && nextSheetId
          ? {
              ...cell,
              sheetId: nextSheetId,
              rowId: rowIds.get(`${cell.sheetId}:${cell.rowId}`) ?? cell.rowId,
              columnId:
                columnIds.get(`${cell.sheetId}:${cell.columnId}`) ??
                cell.columnId,
            }
          : undefined,
    } satisfies BoardElement;
  });

  return { elements: clonedElements, sheets: clonedSheets };
}

const remapRichTextTargets = (
  content: string | undefined,
  elementIds: ReadonlyMap<string, string>,
  preserveExternalLinks: boolean,
) =>
  (content ?? "").replace(
    /(href\s*=\s*["'])#target-([a-zA-Z0-9_-]+)(["'])/gi,
    (_match, prefix: string, targetId: string, suffix: string) => {
      const nextId = elementIds.get(targetId);
      if (nextId) return `${prefix}#target-${nextId}${suffix}`;
      return preserveExternalLinks
        ? `${prefix}#target-${targetId}${suffix}`
        : `${prefix}#${suffix}`;
    },
  );

export const attachBoardDocumentRoots = (
  elements: readonly BoardElement[],
  parentId: string,
) =>
  elements.map((element) =>
    element.parentId ? element : { ...element, parentId },
  );
