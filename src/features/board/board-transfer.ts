import type { BoardElement, Page, Preset } from "../../types";
import { cloneBoardDocument } from "./clone-board-document";

const DEFAULT_BOARD_SIZE = { width: 1024, height: 1024 };
const BOARD_GAP = 50;

export interface BoardTransferResult {
  surface: BoardElement;
  elements: BoardElement[];
  sectionSheets: NonNullable<Page["sectionSheets"]>;
}

/**
 * Clone a Page into a destination as one additional board surface.
 * Element positions are local to each Page; workspace boardX/boardY do not
 * participate in placement or translation.
 */
export function clonePageAsAdditionalBoard(
  source: Page,
  destination: Page,
  createId: () => string,
): BoardTransferResult {
  const destinationMaxX = Math.max(
    destination.width || DEFAULT_BOARD_SIZE.width,
    ...destination.elements.map((element) => {
      const right = element.position.x + (element.size?.width ?? 0);
      return Number.isFinite(right) ? right : 0;
    }),
  );
  const offset = { x: destinationMaxX + BOARD_GAP, y: 0 };
  const surfaceId = `board-${createId()}`;
  const cloned = cloneBoardDocument(
    source.elements,
    source.sectionSheets ?? [],
    createId,
  );
  const surface: BoardElement = {
    id: surfaceId,
    type: "board",
    position: { ...offset },
    size: {
      width: source.width || DEFAULT_BOARD_SIZE.width,
      height: source.height || DEFAULT_BOARD_SIZE.height,
    },
    color: source.boardColor ?? "#ffffff",
    content: source.title,
    zIndex:
      Math.min(
        0,
        ...destination.elements.map((element) => element.zIndex),
        ...cloned.elements.map((element) => element.zIndex),
      ) - 1,
  };
  const translated = cloned.elements.map((element) => ({
    ...element,
    ...(element.isPixelFill && element.pixelFillBoardId === 'main-board'
      ? { pixelFillBoardId: surfaceId }
      : {}),
    position: {
      x: element.position.x + offset.x,
      y: element.position.y + offset.y,
    },
  }));

  return {
    surface,
    elements: [
      ...destination.elements,
      surface,
      ...translated.map(element => {
        const localX = element.position.x - offset.x;
        const localY = element.position.y - offset.y;
        const touchesMain = localX < surface.size!.width && localY < surface.size!.height &&
          localX + (element.size?.width ?? 1) > 0 && localY + (element.size?.height ?? 1) > 0;
        // Additional surfaces outside the source Main Board remain peers.
        // Parenting them to its copy would clip otherwise visible content.
        return !element.parentId && touchesMain ? { ...element, parentId: surfaceId } : element;
      }),
    ],
    sectionSheets: [...(destination.sectionSheets ?? []), ...cloned.sheets],
  };
}

export interface PresetPageDefaults {
  width: number;
  height: number;
  workspaceWidth: number;
  workspaceHeight: number;
  snapToGrid: boolean;
}

export type PagePresentation = Pick<
  Page,
  | "width"
  | "height"
  | "workspaceWidth"
  | "workspaceHeight"
  | "snapToGrid"
  | "showGrid"
  | "showWorkspaceGrid"
  | "brightness"
  | "gridColor"
  | "boardColor"
  | "gridThickness"
  | "gridSize"
  | "workspaceGridColor"
  | "workspaceGridThickness"
  | "workspaceGridSize"
  | "editorSettings"
>;

/** Map preset presentation into a Page while preserving the current defaults. */
export function pagePresentationFromPreset(
  preset: Preset | null,
  defaults: PresetPageDefaults,
): PagePresentation {
  return {
    width: preset?.width ?? defaults.width,
    height: preset?.height ?? defaults.height,
    workspaceWidth: preset?.workspaceWidth ?? defaults.workspaceWidth,
    workspaceHeight: preset?.workspaceHeight ?? defaults.workspaceHeight,
    snapToGrid: preset?.snapToGrid ?? defaults.snapToGrid,
    showGrid: preset?.showGrid ?? false,
    showWorkspaceGrid: preset?.showWorkspaceGrid ?? false,
    brightness: preset?.brightness ?? 100,
    gridColor: preset?.gridColor,
    boardColor: preset?.boardColor,
    gridThickness: preset?.gridThickness,
    gridSize: preset?.gridSize,
    workspaceGridColor: preset?.workspaceGridColor,
    workspaceGridThickness: preset?.workspaceGridThickness,
    workspaceGridSize: preset?.workspaceGridSize,
    editorSettings: preset?.editorSettings
      ? structuredClone(preset.editorSettings)
      : undefined,
  };
}
