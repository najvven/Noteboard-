import { minimumBy, maximumBy } from './geometry-bounds';
import type { BoardElement, SectionSheet } from "../../types";
import { cloneBoardDocument } from "./clone-board-document";
import { migratePage } from "./migrate-page";
import {
  getBoardPackageElements,
  type BoardPackageData,
} from "./board-package";

const DEFAULT_IMPORT_SIZE = { width: 180, height: 96 };

export interface PlaceBoardPackageOptions {
  existingElements: readonly BoardElement[];
  existingSheets: readonly SectionSheet[];
  pageSize: { width: number; height: number };
  position: { x: number; y: number };
  parentId?: string;
  createId: () => string;
}

export interface PlacedBoardPackage {
  elements: BoardElement[];
  sectionSheets: SectionSheet[];
  importedElements: BoardElement[];
  importedSheets: SectionSheet[];
  selectedId: string;
}

export const placeBoardPackage = (
  data: BoardPackageData,
  options: PlaceBoardPackageOptions,
): PlacedBoardPackage => {
  const normalizedData = Array.isArray(data) ? data : migratePage(data);
  const sourceElements = getBoardPackageElements(normalizedData);
  if (!sourceElements.length) throw new Error("The board package is empty.");
  const sourceSheets = Array.isArray(normalizedData)
    ? []
    : (normalizedData.sectionSheets ?? []);
  const cloned = cloneBoardDocument(
    sourceElements,
    sourceSheets,
    options.createId,
  );

  const minX = minimumBy(cloned.elements, element=>element.position.x);
  const minY = minimumBy(cloned.elements, element=>element.position.y);
  const maxX = maximumBy(cloned.elements, element=>element.position.x+(element.size?.width??DEFAULT_IMPORT_SIZE.width));
  const maxY = maximumBy(cloned.elements, element=>element.position.y+(element.size?.height??DEFAULT_IMPORT_SIZE.height));
  const groupWidth = Math.max(1, maxX - minX);
  const groupHeight = Math.max(1, maxY - minY);
  const anchorX = Math.min(
    Math.max(0, options.position.x),
    Math.max(0, options.pageSize.width - groupWidth),
  );
  const anchorY = Math.min(
    Math.max(0, options.position.y),
    Math.max(0, options.pageSize.height - groupHeight),
  );
  const offsetX = anchorX - minX;
  const offsetY = anchorY - minY;
  const highestZ = Math.max(
    0,
    ...options.existingElements.map((element) =>
      Number.isFinite(element.zIndex) ? element.zIndex : 0,
    ),
  );
  const lowestImportedZ = Math.min(
    ...cloned.elements.map((element) =>
      Number.isFinite(element.zIndex) ? element.zIndex : 0,
    ),
  );
  const importedElements = cloned.elements.map((element) => ({
    ...element,
    parentId: element.parentId ?? options.parentId,
    position: {
      x: element.position.x + offsetX,
      y: element.position.y + offsetY,
    },
    zIndex:
      highestZ +
      ((Number.isFinite(element.zIndex) ? element.zIndex : 0) - lowestImportedZ) +
      1,
  }));
  const selectedId =
    importedElements.find((element) => element.type !== "layer")?.id ??
    importedElements[0].id;

  return {
    elements: [...options.existingElements, ...importedElements],
    sectionSheets: [...options.existingSheets, ...cloned.sheets],
    importedElements,
    importedSheets: cloned.sheets,
    selectedId,
  };
};
