import type { Page } from "../../types";
import {
  createSectionSheetOperationBudget,
  recalculateSectionSheetsElements,
} from "../spreadsheet/model";
import {
  createDefaultSectionSheetAutomations,
  DEFAULT_SECTION_SHEET_SHORTCUTS,
  SECTION_SHEET_COMMAND_BY_ACTION,
  type SectionSheet,
  type SectionSheetAutomationId,
} from "../spreadsheet/types";
import { CURRENT_BOARD_VERSION } from "../../../shared/board-data.js";
import { repairLegacyBoard } from "../../../shared/board-migration.js";

export const CURRENT_PAGE_VERSION = CURRENT_BOARD_VERSION;
const MAX_PAGE_MIGRATION_OPERATIONS = 500_000;

const SECTION_SHEET_ACTIONS = new Set([
  "auto-fit",
  "fill-down",
  "fill-right",
  "series",
]);
const SECTION_SHEET_TRIGGERS = new Set(["manual", "shortcut", "cell-change"]);
const SECTION_SHEET_SHORTCUT_KEYS = Object.keys(DEFAULT_SECTION_SHEET_SHORTCUTS);

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

const migrateSectionSheets = (value: unknown): SectionSheet[] =>
  Array.isArray(value)
    ? value
        .filter(
          (sheet: any) =>
            sheet &&
            sheet.version === 1 &&
            typeof sheet.id === "string" &&
            Array.isArray(sheet.rowOrder) &&
            Array.isArray(sheet.columnOrder) &&
            Array.isArray(sheet.cellIds) &&
            sheet.rows &&
            typeof sheet.rows === "object" &&
            sheet.columns &&
            typeof sheet.columns === "object",
        )
        .map((sheet: any) => {
          const shortcuts = {
            ...DEFAULT_SECTION_SHEET_SHORTCUTS,
            ...(sheet.shortcuts && typeof sheet.shortcuts === "object"
              ? Object.fromEntries(
                  SECTION_SHEET_SHORTCUT_KEYS.filter(
                    (key) => typeof sheet.shortcuts[key] === "string",
                  ).map((key) => [key, sheet.shortcuts[key]]),
                )
              : {}),
          };
          const validAutomations = Array.isArray(sheet.automations)
            ? sheet.automations.filter(
                (automation: any) =>
                  automation &&
                  typeof automation.id === "string" &&
                  typeof automation.name === "string" &&
                  typeof automation.enabled === "boolean" &&
                  SECTION_SHEET_ACTIONS.has(automation.action) &&
                  SECTION_SHEET_TRIGGERS.has(automation.trigger),
              )
            : [];
          const existingByAction = new Map(
            validAutomations.map((automation: any) => [automation.action, automation]),
          );
          const automations = createDefaultSectionSheetAutomations(
            (action) => `automation-${sheet.id}-${action}`,
            shortcuts,
          ).map((fallback) => {
            const existing = existingByAction.get(fallback.action) as
              | Record<string, unknown>
              | undefined;
            const action = fallback.action as SectionSheetAutomationId;
            return {
              ...fallback,
              ...(existing ?? {}),
              action,
              shortcut: shortcuts[SECTION_SHEET_COMMAND_BY_ACTION[action]],
            };
          });
          return {
            ...sheet,
            name:
              typeof sheet.name === "string" && sheet.name.trim()
                ? sheet.name
                : "Section Spreadsheet",
            shortcuts,
            automations,
            headerRows: Number.isInteger(sheet.headerRows) ? sheet.headerRows : 1,
            headerColumns: Number.isInteger(sheet.headerColumns)
              ? sheet.headerColumns
              : 0,
            showHeaders: sheet.showHeaders !== false,
          };
        })
    : [];

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
  const sectionSheets = migrateSectionSheets(source.sectionSheets);
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
  const migrationBudget = createSectionSheetOperationBudget(
    MAX_PAGE_MIGRATION_OPERATIONS,
  );
  const elements = recalculateSectionSheetsElements(
    migratedElements,
    sectionSheets,
    migrationBudget,
  );

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
    sectionSheets,
  } as Page;
};
