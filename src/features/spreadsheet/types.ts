export type SectionSheetAutomationId =
  | "auto-fit"
  | "fill-down"
  | "fill-right"
  | "series";

export type SectionSheetShortcutCommand =
  | "addRow"
  | "addColumn"
  | "fillDown"
  | "fillRight"
  | "autoFit"
  | "series";

export interface SectionSheetShortcuts {
  addRow: string;
  addColumn: string;
  fillDown: string;
  fillRight: string;
  autoFit: string;
  series: string;
}

export interface SectionSheetCellMeta {
  sheetId: string;
  rowId: string;
  columnId: string;
  address: string;
  valueType?: "auto" | "text" | "number" | "date" | "boolean";
  computedValue?: string | number;
  error?: string;
}

export interface SectionSheetRow {
  id: string;
  height: number;
}

export interface SectionSheetColumn {
  id: string;
  width: number;
}

export interface SectionSheetAutomation {
  id: string;
  name: string;
  enabled: boolean;
  trigger: "manual" | "shortcut" | "cell-change";
  action: SectionSheetAutomationId;
  shortcut?: string;
}

export interface SectionSheet {
  id: string;
  version: 1;
  name: string;
  rowOrder: string[];
  columnOrder: string[];
  rows: Record<string, SectionSheetRow>;
  columns: Record<string, SectionSheetColumn>;
  cellIds: string[][];
  headerRows: number;
  headerColumns: number;
  showHeaders: boolean;
  shortcuts: SectionSheetShortcuts;
  automations: SectionSheetAutomation[];
  createdAt: number;
  updatedAt: number;
}

export const DEFAULT_SECTION_SHEET_SHORTCUTS: SectionSheetShortcuts = {
  addRow: "Alt+Shift+ArrowDown",
  addColumn: "Alt+Shift+ArrowRight",
  fillDown: "Ctrl+Shift+D",
  fillRight: "Ctrl+Shift+R",
  autoFit: "Alt+Shift+F",
  series: "Alt+Shift+S",
};

export const SECTION_SHEET_COMMAND_BY_ACTION: Record<
  SectionSheetAutomationId,
  SectionSheetShortcutCommand
> = {
  "fill-down": "fillDown",
  "fill-right": "fillRight",
  "auto-fit": "autoFit",
  series: "series",
};

const AUTOMATION_NAME_BY_ACTION: Record<SectionSheetAutomationId, string> = {
  "auto-fit": "Auto fit",
  "fill-down": "Fill down",
  "fill-right": "Fill right",
  series: "Number series",
};

export const createDefaultSectionSheetAutomations = (
  createId: (action: SectionSheetAutomationId) => string,
  shortcuts: SectionSheetShortcuts = DEFAULT_SECTION_SHEET_SHORTCUTS,
): SectionSheetAutomation[] =>
  (["auto-fit", "fill-down", "fill-right", "series"] as const).map(
    (action) => ({
      id: createId(action),
      name: AUTOMATION_NAME_BY_ACTION[action],
      enabled: true,
      trigger: "shortcut",
      action,
      shortcut: shortcuts[SECTION_SHEET_COMMAND_BY_ACTION[action]],
    }),
  );
