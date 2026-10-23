import type { Page } from "../../types";
import { upgradeLegacyWorkbooks } from "../spreadsheet/workbook";
import { CURRENT_BOARD_VERSION } from "../../../shared/board-data.js";
import { repairLegacyBoard } from "../../../shared/board-migration.js";

export const CURRENT_PAGE_VERSION = CURRENT_BOARD_VERSION;
const inferStoredMediaMime = (content?: unknown, mediaMime?: unknown) => {
  if (typeof mediaMime === "string" && mediaMime) return mediaMime;
  if (typeof content !== "string" || !content) return "";
  if (content.startsWith("data:")) {
    const end = content.indexOf(";");
    return content.slice(5, end === -1 ? undefined : end);
  }
  if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(content)) return "image/url";
  if (/\.(mp4|webm|ogg|mov)(\?|#|$)/i.test(content)) return "video/url";
  if (/\.(mp3|wav|ogg|m4a|aac)(\?|#|$)/i.test(content)) return "audio/url";
  return "";
};

export const migratePage = (source: any): Page => {
  source = repairLegacyBoard(source);
  if (
    source?.version !== undefined &&
    (!Number.isInteger(source.version) || source.version < 1)
  ) {
    throw new Error("Board version is invalid.");
  }
  if (source?.version > CURRENT_PAGE_VERSION) {
    throw new Error(
      `Board version ${source.version} is newer than this version of Noteboard.`,
    );
  }
  const sectionSheets = Array.isArray(source.sectionSheets) ? source.sectionSheets.filter((sheet: any) => sheet?.version === 1 && typeof sheet.id === "string" && Array.isArray(sheet.cellIds)) : [];
  const validSheetIds = new Set(sectionSheets.map((sheet) => sheet.id));
  const migratedElements = Array.isArray(source.elements)
    ? source.elements.map((element: any) => {
        const mime = inferStoredMediaMime(element.content, element.mediaMime);
        const isStoredMedia =
          mime.startsWith("image/") ||
          mime.startsWith("video/") ||
          mime.startsWith("audio/") ||
          mime === "image/url" ||
          mime === "video/url" ||
          mime === "audio/url";
        let migratedElement = element;
        if (element.type === "embed" && isStoredMedia) {
          migratedElement = {
            ...element,
            type: "media",
            mediaKind: "media",
            mediaMime: mime,
            keepRatio: mime.startsWith("image/") || mime === "image/url",
          };
        } else if (element.type === "media" && !element.mediaMime && mime) {
          migratedElement = {
            ...element,
            mediaMime: mime,
            mediaKind: "media",
            keepRatio:
              element.keepRatio ??
              (mime.startsWith("image/") || mime === "image/url"),
          };
        }
        if (
          migratedElement.sheetCell &&
          !validSheetIds.has(migratedElement.sheetCell.sheetId)
        ) {
          return { ...migratedElement, sheetCell: undefined };
        }
        return { ...migratedElement };
      })
    : [];
  const elements = upgradeLegacyWorkbooks(migratedElements, sectionSheets);

  return {
    ...source,
    version: CURRENT_PAGE_VERSION,
    workspaceWidth: source.workspaceWidth ?? 10000,
    workspaceHeight: source.workspaceHeight ?? 10000,
    showGrid: source.showGrid ?? false,
    snapToGrid: source.snapToGrid ?? false,
    showWorkspaceGrid: source.showWorkspaceGrid ?? false,
    brightness: source.brightness ?? 100,
    gridColor: source.gridColor ?? "#e2e8f0",
    gridThickness: source.gridThickness ?? 1,
    gridSize: source.gridSize ?? 24,
    workspaceGridColor: source.workspaceGridColor ?? "#333333",
    workspaceGridThickness: source.workspaceGridThickness ?? 1,
    workspaceGridSize: source.workspaceGridSize ?? 50,
    elements,
    sectionSheets: [],
  } as Page;
};
