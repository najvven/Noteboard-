export interface SpreadsheetSelection {
  sheetId: string;
  address: string;
  input: string;
  bold: boolean;
  italic: boolean;
  fontSize: number;
  color: string;
  fill: string;
  numberFormat: string;
  alignment: string;
}

export type SpreadsheetAction =
  | { type: "value"; value: string }
  | { type: "bold" | "italic"; value: boolean }
  | { type: "fontSize"; value: number }
  | { type: "color" | "fill" | "numberFormat"; value: string }
  | { type: "align"; value: "left" | "center" | "right" }
  | { type: "sort"; ascending: boolean }
  | {
      type:
        | "clear"
        | "undo"
        | "redo"
        | "insertRow"
        | "insertColumn"
        | "deleteRows"
        | "deleteColumns";
    };

export interface SpreadsheetBridge {
  readonly documentId: string;
  observeReloadDraft(observer: (draft: SpreadsheetReloadDraft) => void): void;
  snapshot(): string;
  historySnapshot(): string;
  flush(): Promise<string>;
  setExpanded(expanded: boolean): Promise<void>;
  setInteractive(interactive: boolean, pendingAction?: boolean): void;
  capturePreview(): Promise<string>;
  replaceContent(content: string): Promise<void>;
  setCellDimensions(width: number, height: number): Promise<string>;
  action(action: SpreadsheetAction): Promise<string>;
  importSheets(bytes: ArrayBuffer, name: string): Promise<string[]>;
  exportFile(format: "xlsx" | "csv"): Promise<ArrayBuffer>;
}

export interface SpreadsheetReloadDraft {
  content: string;
  editingCell?: {sheetId:string;address:string};
}

export function spreadsheetBridge(
  frame: HTMLIFrameElement | null,
): SpreadsheetBridge | undefined {
  return (
    frame?.contentWindow as
      | (Window & { noteboardSheet?: SpreadsheetBridge })
      | null
  )?.noteboardSheet;
}

// Property-bar changes use the mounted editor's owner, so its content echo
// cannot be mistaken for an external workbook replacement.
type CellSizer = (
  width: number,
  height: number,
  beforeChange: () => void,
) => Promise<void>;
const openers = new Map<string, () => void>();
export function registerSpreadsheetOpener(id: string, open: () => void) {
  openers.set(id, open);
  return () => {
    if (openers.get(id) === open) openers.delete(id);
  };
}
export function openSpreadsheetEditor(id: string) {
  openers.get(id)?.();
}
const cellSizers = new WeakMap<HTMLIFrameElement, CellSizer>();
export function registerSpreadsheetCellSizer(
  frame: HTMLIFrameElement,
  size: CellSizer,
) {
  cellSizers.set(frame, size);
  return () => {
    if (cellSizers.get(frame) === size) cellSizers.delete(frame);
  };
}
export function resizeSpreadsheetCells(
  frame: HTMLIFrameElement,
  width: number,
  height: number,
  beforeChange: () => void,
) {
  const size = cellSizers.get(frame);
  if (!size) throw Error("The spreadsheet is not ready.");
  return size(width, height, beforeChange);
}
