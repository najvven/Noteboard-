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

function remapExternalId(
  id: string | undefined,
  elementIds: ReadonlyMap<string, string>,
  preserveExternal: boolean,
) {
  if (!id) return undefined;
  return elementIds.get(id) ?? (preserveExternal ? id : undefined);
}

function remapPixelFillBoardId(
  id: string,
  boardIds: ReadonlyMap<string, string>,
  preserveExternalParents: boolean,
) {
  if (id === 'main-board') return id;
  return boardIds.get(id) ?? (preserveExternalParents ? id : undefined);
}

function remapElementLink(
  id: string | undefined,
  elementIds: ReadonlyMap<string, string>,
  preserveExternalLinks: boolean,
) {
  if (!id) return undefined;
  const mappedId = elementIds.get(id);
  if (mappedId) return mappedId;
  return isHttpBoardLink(id) || preserveExternalLinks ? id : undefined;
}

function cloneElement(
  element: BoardElement,
  index: number,
  elementIds: ReadonlyMap<string, string>,
  boardIds: ReadonlyMap<string, string>,
  createId: () => string,
  options: CloneBoardDocumentOptions,
): BoardElement {
  const workbook = element.type === 'table' ? parseWorkbookDocument(element.content) : null;
  if (workbook) workbook.workbook.id = `workbook-${createId()}`;
  const cloned: BoardElement = {
    ...element,
    id: elementIds.get(element.id)!,
    parentId: remapExternalId(element.parentId, elementIds, options.preserveExternalParents === true),
    groupOriginalParentId: remapExternalId(
      element.groupOriginalParentId,
      elementIds,
      options.preserveExternalParents === true,
    ),
    linkToId: remapElementLink(element.linkToId, elementIds, options.preserveExternalLinks === true),
    content: workbook ? JSON.stringify(workbook) : remapRichTextTargets(
      element.content,
      elementIds,
      options.preserveExternalLinks === true,
    ),
    position: { ...element.position },
    ...(element.type === 'embed' ? { webSessionId: elementIds.get(element.id)! } : {}),
    zIndex: Number.isFinite(element.zIndex) ? element.zIndex : index,
    size: element.size ? { ...element.size } : undefined,
    points: element.points?.map(point => ({ ...point })),
    sheetCell: undefined,
  };
  if (element.isPixelFill && element.pixelFillBoardId) {
    cloned.pixelFillBoardId = remapPixelFillBoardId(
      element.pixelFillBoardId,
      boardIds,
      options.preserveExternalParents === true,
    );
  }
  return cloned;
}

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
    elements: elements.map((element, index) =>
      cloneElement(element, index, elementIds, boardIds, createId, options),
    ),
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
