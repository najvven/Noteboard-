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
  snapshot(): string;
  historySnapshot(): string;
  flush(): Promise<string>;
  setExpanded(expanded: boolean): Promise<void>;
  replaceContent(content: string): Promise<void>;
  setCellDimensions(width: number, height: number): Promise<string>;
  action(action: SpreadsheetAction): Promise<void>;
  importSheets(bytes: ArrayBuffer, name: string): Promise<string[]>;
  exportFile(format: "xlsx" | "csv"): Promise<ArrayBuffer>;
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
type CellSizer = (width: number, height: number) => Promise<void>;
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
) {
  const size = cellSizers.get(frame);
  if (!size) throw Error("The spreadsheet is not ready.");
  return size(width, height);
}
