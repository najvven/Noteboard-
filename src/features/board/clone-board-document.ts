import type { BoardElement, SectionSheet } from "../../types";
import { isHttpBoardLink } from "./link-target";
import { parseWorkbookDocument, upgradeLegacyWorkbooks } from "../spreadsheet/workbook";

export interface ClonedBoardDocument {
  elements: BoardElement[];
  sheets: SectionSheet[];
}
export interface CloneBoardDocumentOptions {
  preserveExternalParents?: boolean;
  preserveExternalLinks?: boolean;
}
const defaultCreateId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

export function cloneBoardDocument(
  source: readonly BoardElement[],
  legacySheets: readonly SectionSheet[] = [],
  createId: () => string = defaultCreateId,
  options: CloneBoardDocumentOptions = {},
): ClonedBoardDocument {
  const elements = upgradeLegacyWorkbooks(source, legacySheets);
  const elementIds = new Map<string,string>(elements.map(element => [element.id, `element-${createId()}`] as const));
  const boardIds = new Map(
    elements
      .filter(element => element.type === 'board')
      .map(element => [element.id, elementIds.get(element.id)!] as const),
  );
  return {
    sheets: [],
    elements: elements.map((element, index) => {
      const workbook = element.type === 'table' ? parseWorkbookDocument(element.content) : null;
      if (workbook) workbook.workbook.id = `workbook-${createId()}`;
      return {
        ...element,
        id: elementIds.get(element.id)!,
        ...(element.isPixelFill && element.pixelFillBoardId
          ? {
              pixelFillBoardId: element.pixelFillBoardId === 'main-board'
                ? 'main-board'
                : boardIds.get(element.pixelFillBoardId) ??
                  (options.preserveExternalParents ? element.pixelFillBoardId : undefined),
            }
          : {}),
        parentId: element.parentId ? elementIds.get(element.parentId) ?? (options.preserveExternalParents ? element.parentId : undefined) : undefined,
        groupOriginalParentId:element.groupOriginalParentId?elementIds.get(element.groupOriginalParentId)??(options.preserveExternalParents?element.groupOriginalParentId:undefined):undefined,
        linkToId: element.linkToId ? elementIds.get(element.linkToId) ?? (isHttpBoardLink(element.linkToId) || options.preserveExternalLinks ? element.linkToId : undefined) : undefined,
        content: workbook ? JSON.stringify(workbook) : remapRichTextTargets(element.content, elementIds, options.preserveExternalLinks === true),
        position: { ...element.position },
        ...(element.type === 'embed' ? { webSessionId: elementIds.get(element.id)! } : {}),
        zIndex: Number.isFinite(element.zIndex) ? element.zIndex : index,
        size: element.size ? { ...element.size } : undefined,
        points: element.points?.map(point => ({ ...point })),
        sheetCell: undefined,
      };
    }),
  };
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
