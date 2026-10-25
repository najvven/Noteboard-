/** Legacy document types, used only when importing saved pre-workbook boards. */
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

