import { createUniver, LocaleType, mergeLocales } from "@univerjs/presets";
import { UniverSheetsCorePreset } from "@univerjs/preset-sheets-core";
import { CommandType } from "@univerjs/core";
import coreEn from "@univerjs/preset-sheets-core/locales/en-US";
import { UniverSheetsSortPreset } from "@univerjs/preset-sheets-sort";
import sortEn from "@univerjs/preset-sheets-sort/locales/en-US";
import { UniverSheetsFilterPreset } from "@univerjs/preset-sheets-filter";
import filterEn from "@univerjs/preset-sheets-filter/locales/en-US";
import { UniverSheetsDataValidationPreset } from "@univerjs/preset-sheets-data-validation";
import validationEn from "@univerjs/preset-sheets-data-validation/locales/en-US";
import { UniverSheetsConditionalFormattingPreset } from "@univerjs/preset-sheets-conditional-formatting";
import conditionalEn from "@univerjs/preset-sheets-conditional-formatting/locales/en-US";
import "@univerjs/preset-sheets-core/lib/index.css";
import "@univerjs/preset-sheets-sort/lib/index.css";
import "@univerjs/preset-sheets-filter/lib/index.css";
import "@univerjs/preset-sheets-data-validation/lib/index.css";
import "@univerjs/preset-sheets-conditional-formatting/lib/index.css";
import {
  cellFromInput,
  MAX_WORKBOOK_CHARACTERS,
  parseWorkbookDocument,
  normalizeCellSize,
  type WorkbookDocument,
} from "./workbook";
import type { SpreadsheetAction, SpreadsheetSelection } from "./editor-bridge";

let api: ReturnType<typeof createUniver>["univerAPI"] | undefined;
let token = "",
  timer = 0,
  lastSent = "",
  initialized = false;
let previewKey = "",
  cachedPreview: string | undefined;
let historyBaseline = "",
  historyDirty = false,
  ready = false;
const send = (type: string, payload: Record<string, unknown> = {}) =>
  parent.postMessage(
    { source: "noteboard-sheet", type, token, ...payload },
    "*",
  );
const repaint = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

function preview() {
  const layers = [...document.querySelectorAll("canvas")]
    .map((canvas) => ({ canvas, rect: canvas.getBoundingClientRect() }))
    .filter(
      ({ canvas, rect }) =>
        canvas.width > 0 &&
        canvas.height > 0 &&
        rect.width > 200 &&
        rect.height > 100 &&
        getComputedStyle(canvas).visibility !== "hidden",
    );
  if (!layers.length) return undefined;
  const left = Math.min(...layers.map((layer) => layer.rect.left)),
    top = Math.min(...layers.map((layer) => layer.rect.top));
  const width = Math.min(
      innerWidth - left,
      Math.max(...layers.map((layer) => layer.rect.right)) - left,
    ),
    height = Math.min(
      innerHeight - top,
      Math.max(...layers.map((layer) => layer.rect.bottom)) - top,
    );
  if (width <= 0 || height <= 0) return undefined;
  const scale = Math.min(1, 1400 / width, 900 / height),
    output = document.createElement("canvas");
  output.width = Math.round(width * scale);
  output.height = Math.round(height * scale);
  const context = output.getContext("2d")!;
  context.fillStyle = "white";
  context.fillRect(0, 0, output.width, output.height);
  layers.forEach(({ canvas, rect }) =>
    context.drawImage(
      canvas,
      (rect.left - left) * scale,
      (rect.top - top) * scale,
      rect.width * scale,
      rect.height * scale,
    ),
  );
  try {
    return output.toDataURL("image/png");
  } catch {
    return undefined;
  }
}

function snapshot(includePreview = true) {
  const book = api?.getActiveWorkbook();
  if (!book) return "";
  const value: WorkbookDocument = {
    format: "noteboard/workbook",
    version: 1,
    workbook: book.isCellEditing() ? structuredClone(book.save()) : book.save(),
    activeSheetId: book.getActiveSheet().getSheetId(),
  };
  // Include the current draft in autosave without ending the user's cell edit.
  if (book.isCellEditing()) {
    const draft = api?.getDocument("__INTERNAL_EDITOR__DOCS_NORMAL")?.getBody(),
      range = book.getActiveSheet().getActiveCell();
    if (draft && range) {
      const sheet = value.workbook.sheets![value.activeSheetId!],
        r = range.getRow(),
        c = range.getColumn(),
        row = (sheet.cellData[r] ??= {});
      const text = draft.dataStream.replace(/\r\n$/, "");
      row[c] = { s: row[c]?.s, ...cellFromInput(text) };
    }
  }
  const key = JSON.stringify(value);
  if (!includePreview) return key;
  if (key !== previewKey) {
    previewKey = key;
    cachedPreview = preview();
  }
  value.preview = cachedPreview;
  return JSON.stringify(value);
}
async function flush() {
  clearTimeout(timer);
  await api?.getActiveWorkbook()?.endEditingAsync(true);
  await api?.getFormula().onCalculationResultApplied(15000);
  await repaint();
  const content = snapshot();
  if (content && !parseWorkbookDocument(content))
    throw Error(
      "The workbook exceeds the 32 MB save limit. Undo the last change or reduce its size.",
    );
  if (content) send("changed", { content });
  return content;
}

// Workbook initialization, calculated caches and selection thumbnails are
// derived state. Merely opening another sheet must not consume a canvas Undo.
function historySnapshot() {
  return historyDirty || api?.getActiveWorkbook()?.isCellEditing()
    ? snapshot()
    : historyBaseline;
}
async function exchange(data: Record<string, unknown>) {
  const worker = new Worker(new URL("./exchange.worker.ts", import.meta.url), {
    type: "module",
  });
  try {
    return await new Promise<any>((resolve, reject) => {
      worker.onmessage = ({ data }) =>
        data.error ? reject(Error(data.error)) : resolve(data.result);
      worker.onerror = () =>
        reject(Error("Could not open the spreadsheet file processor."));
      worker.postMessage(data);
    });
  } finally {
    worker.terminate();
  }
}

async function importSheets(bytes: ArrayBuffer, name: string) {
  const currentContent = await flush();
  const { document, warnings } = await exchange({
    action: "import",
    bytes,
    name,
  });
  const importedContent = JSON.stringify(document);
  if (!parseWorkbookDocument(importedContent))
    throw Error(
      "The imported workbook exceeds the supported size or dimensions.",
    );
  if (
    currentContent.length + importedContent.length >
    MAX_WORKBOOK_CHARACTERS - 256 * 1024
  )
    throw Error(
      "These sheets would exceed the workbook size limit. Import them into a separate spreadsheet.",
    );
  const book = api!.getActiveWorkbook()!,
    names = new Set(
      book.getSheets().map((sheet) => sheet.getSheetName().toLowerCase()),
    );
  const replacements = new Map<string, string>();
  for (const id of document.workbook.sheetOrder) {
    const original = document.workbook.sheets[id].name;
    let name = original,
      index = 2;
    while (names.has(name.toLowerCase()))
      name = `${original.slice(0, 26)} ${index++}`;
    names.add(name.toLowerCase());
    replacements.set(original.toLowerCase(), name);
  }
  const inserted: string[] = [];
  try {
    for (const id of document.workbook.sheetOrder) {
      const sheet = document.workbook.sheets[id];
      for (const row of Object.values(sheet.cellData) as any[])
        for (const cell of Object.values(row) as any[]) {
          if (!cell?.f) continue;
          cell.f = cell.f
            .split(/("(?:[^"]|"")*")/g)
            .map((part: string, index: number) =>
              index % 2
                ? part
                : part.replace(
                    /(?:'((?:[^']|'')+)'|([^+\-*/^&=<>(),:;\s!]+))!/g,
                    (match: string, quoted: string, unquoted: string) => {
                      const replacement = replacements.get(
                        (quoted?.replace(/''/g, "'") ?? unquoted).toLowerCase(),
                      );
                      return replacement
                        ? `'${replacement.replace(/'/g, "''")}'!`
                        : match;
                    },
                  ),
            )
            .join("");
        }
      sheet.name = replacements.get(sheet.name.toLowerCase());
      sheet.id = `sheet-${crypto.randomUUID()}`;
      const added = book.insertSheet(sheet.name, { sheet });
      if (!added) throw Error(`Could not add sheet "${sheet.name}".`);
      inserted.push(added.getSheetId());
    }
    await flush();
    return warnings as string[];
  } catch (error) {
    inserted.forEach((id) => book.deleteSheet(id));
    throw error;
  }
}
async function exportFile(format: "xlsx" | "csv") {
  const content = await flush();
  return exchange({
    action: "export",
    document: parseWorkbookDocument(content),
    format,
  });
}
function sendSelection() {
  const sheet = api?.getActiveWorkbook()?.getActiveSheet(),
    range = sheet?.getActiveRange();
  if (!sheet || !range) return;
  const cell =
    sheet.getActiveCell() ??
    sheet.getRange(range.getRow(), range.getColumn(), 1, 1);
  const style = cell.getCellStyleData() ?? {};
  const selection: SpreadsheetSelection = {
    sheetId: sheet.getSheetId(),
    address: range.getA1Notation(),
    input: cell.getFormula() || String(cell.getValue() ?? ""),
    bold: style.bl === 1,
    italic: style.it === 1,
    fontSize: style.fs ?? 11,
    color: String((style.cl || {}).rgb || "#000000"),
    fill: String((style.bg || {}).rgb || "#ffffff"),
    numberFormat: cell.getNumberFormat(),
    alignment: cell.getHorizontalAlignment(),
  };
  send("selection", { selection });
}

async function setExpanded(expanded: boolean) {
  if (!api) return;
  api
    .setUIVisible(api.Enum.BuiltInUIPart.HEADER, expanded)
    .setUIVisible(api.Enum.BuiltInUIPart.TOOLBAR, expanded);
  await repaint();
}

async function replaceContent(content: string) {
  const value = parseWorkbookDocument(content);
  if (!api || !value) throw Error("Invalid spreadsheet data.");
  clearTimeout(timer);
  ready = false;
  historyBaseline = content;
  historyDirty = false;
  const old = api.getActiveWorkbook(),
    address = old?.getActiveSheet().getActiveRange()?.getA1Notation();
  if (old) api.disposeUnit(old.getId());
  const book = api.createWorkbook(value.workbook);
  if (value.activeSheetId && book.getSheetBySheetId(value.activeSheetId))
    book.setActiveSheet(value.activeSheetId);
  if (address) book.getActiveSheet().getRange(address).activate();
  lastSent = content;
  api.getFormula().executeCalculation();
  await repaint();
  ready = true;
  sendSelection();
}

async function setCellDimensions(width: number, height: number) {
  const book = api?.getActiveWorkbook();
  if (!book) throw Error("The spreadsheet is not ready.");
  await book.endEditingAsync(true);
  const sheet = book.getActiveSheet(),
    size = normalizeCellSize(width, height);
  if (sheet.getColumnWidth(0) !== size.width)
    sheet.setColumnWidths(0, sheet.getSheet().getColumnCount(), size.width);
  if (sheet.getRowHeight(0) !== size.height)
    sheet.setRowHeightsForced(0, sheet.getSheet().getRowCount(), size.height);
  // Capture this property transaction before another cell input can start.
  // The scheduled mutation snapshot paints its thumbnail after layout settles.
  const content = snapshot(false);
  if (!parseWorkbookDocument(content))
    throw Error(
      "The workbook exceeds the 32 MB save limit. Undo the last change or reduce its size.",
    );
  return content;
}

async function action(action: SpreadsheetAction) {
  const book = api?.getActiveWorkbook();
  if (!book || !api) throw Error("The spreadsheet is not ready.");
  await book.endEditingAsync(true);
  const sheet = book.getActiveSheet(),
    range = sheet.getActiveRange();
  if (action.type === "undo") await api.undo();
  else if (action.type === "redo") await api.redo();
  else {
    if (!range) return;
    switch (action.type) {
      case "value":
        (
          sheet.getActiveCell() ??
          sheet.getRange(range.getRow(), range.getColumn(), 1, 1)
        ).setValue(action.value);
        break;
      case "bold":
        range.setFontWeight(action.value ? "bold" : "normal");
        break;
      case "italic":
        range.setFontStyle(action.value ? "italic" : "normal");
        break;
      case "fontSize":
        range.setFontSize(action.value);
        break;
      case "color":
        range.setFontColor(action.value);
        break;
      case "fill":
        range.setBackgroundColor(action.value);
        break;
      case "numberFormat":
        range.setNumberFormat(action.value);
        break;
      case "align":
        range.setHorizontalAlignment(
          action.value === "right" ? "normal" : action.value,
        );
        break;
      case "sort":
        range.sort({ column: 0, ascending: action.ascending });
        break;
      case "clear":
        range.clearContent();
        break;
      case "insertRow":
        sheet.insertRowsBefore(range.getRow(), 1);
        break;
      case "insertColumn":
        sheet.insertColumnsBefore(range.getColumn(), 1);
        break;
      case "deleteRows":
        sheet.deleteRows(
          range.getRow(),
          range.getRange().endRow - range.getRange().startRow + 1,
        );
        break;
      case "deleteColumns":
        sheet.deleteColumns(
          range.getColumn(),
          range.getRange().endColumn - range.getRange().startColumn + 1,
        );
        break;
    }
  }
  await flush();
  sendSelection();
}

(window as any).noteboardSheet = {
  snapshot,
  historySnapshot,
  flush,
  importSheets,
  exportFile,
  setExpanded,
  replaceContent,
  setCellDimensions,
  action,
};

window.addEventListener("message", async (event) => {
  if (event.source !== parent || event.data?.source !== "noteboard-host")
    return;
  const message = event.data;
  if (message.type === "init" && !initialized) {
    token = message.token;
    historyBaseline =
      typeof message.originalContent === "string"
        ? message.originalContent
        : message.content;
    const document = parseWorkbookDocument(message.content);
    if (!document) {
      send("error", { message: "Invalid spreadsheet data." });
      return;
    }
    initialized = true;
    try {
      const created = createUniver({
        locale: LocaleType.EN_US,
        locales: {
          [LocaleType.EN_US]: mergeLocales(
            coreEn,
            sortEn,
            filterEn,
            validationEn,
            conditionalEn,
          ),
        },
        presets: [
          UniverSheetsCorePreset({
            workerURL: new Worker(
              new URL("./formula.worker.ts", import.meta.url),
              { type: "module" },
            ),
            container: "sheet-root",
            header: message.expanded === true,
            toolbar: message.expanded === true,
            formulaBar: true,
            footer: {},
          }),
          UniverSheetsSortPreset(),
          UniverSheetsFilterPreset(),
          UniverSheetsDataValidationPreset(),
          UniverSheetsConditionalFormattingPreset(),
        ],
      });
      api = created.univerAPI;
      const book = api.createWorkbook(document.workbook);
      if (
        document.activeSheetId &&
        book.getSheetBySheetId(document.activeSheetId)
      )
        book.setActiveSheet(document.activeSheetId);
      api.addEvent(api.Event.CommandExecuted, (event) => {
        if (
          ready &&
          ((event.type === CommandType.MUTATION &&
            event.id.startsWith("sheet.") &&
            !/formula-calculation|row-auto-height/.test(event.id)) ||
            /rename|freeze/.test(event.id))
        )
          historyDirty = true;
        // Univer 1.0.2 clears the filter model without invalidating SUBTOTAL's
        // cached visibility dependencies. Recalculate after the removal syncs.
        if (event.id === "sheet.mutation.remove-filter")
          queueMicrotask(() => api?.getFormula().executeCalculation());
        if (
          event.type !== CommandType.MUTATION &&
          !/activate-sheet|rename|freeze/.test(event.id)
        )
          return;
        clearTimeout(timer);
        timer = window.setTimeout(() => {
          const content = snapshot();
          if (content && content !== lastSent) {
            lastSent = content;
            send("changed", { content });
          }
          sendSelection();
        }, 250);
      });
      api.addEvent(api.Event.SelectionChanged, () => sendSelection());
      api.getFormula().executeCalculation();
      await api.getFormula().onCalculationResultApplied(15000);
      await repaint();
      ready = true;
      send("loaded");
      sendSelection();
    } catch (error) {
      send("error", {
        message:
          error instanceof Error
            ? error.message
            : "Could not open spreadsheet.",
      });
    }
  }
});
window.addEventListener("beforeunload", () => {
  clearTimeout(timer);
  api?.dispose();
});
send("ready");
