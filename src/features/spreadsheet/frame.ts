import { createUniver, LocaleType, mergeLocales } from "@univerjs/presets";
import { IEditorService } from "@univerjs/docs-ui";
import { SetCellEditVisibleWithF2Operation } from "@univerjs/sheets-ui";
import { DeviceInputEventType } from "@univerjs/engine-render";
import { KeyCode } from "@univerjs/ui";
import { UniverSheetsCorePreset, ScrollCommand, SetWorksheetActiveOperation, SetScrollOperation, SetZoomRatioOperation } from "@univerjs/preset-sheets-core";
import { CommandType, Injector } from "@univerjs/core";
import {ISidebarService, IDialogService, IUIPartsService, UniverUIPlugin, IUIController, DesktopUIController, type IUniverUIConfig} from '@univerjs/ui';
import {HostedSidebarService,HostedDialogService,setOverlayPresentation} from './sheet-overlays';
import React from 'react';
import type {SpreadsheetReloadDraft} from './editor-bridge';
import {SheetRibbon} from './sheet-ribbon';
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
  createUniqueSheetNames,
  MAX_WORKBOOK_CHARACTERS,
  parseWorkbookDocument,
  normalizeCellSize,
  workbookCellDimensionsMatch,
  renameFormulaSheetReferences,
  type WorkbookDocument,
} from "./workbook";
import type { SpreadsheetAction, SpreadsheetSelection } from "./editor-bridge";

function sheetCorePreset(config:Parameters<typeof UniverSheetsCorePreset>[0]) {
  const preset=UniverSheetsCorePreset(config);
  // Plugin services require the UI plugin's own override, rather than the
  // createUniver option that replaces core-only dependencies in this version.
  preset.plugins=preset.plugins.map(plugin=>{
    if (!Array.isArray(plugin)||plugin[0]!==UniverUIPlugin) return plugin;
    const ui=plugin[1] as IUniverUIConfig;
    return [UniverUIPlugin,{...ui,override:[[ISidebarService,{useClass:HostedSidebarService}],
      [IDialogService,{useFactory:(injector:Injector,parts:IUIPartsService)=>new HostedDialogService(injector,parts),deps:[Injector,IUIPartsService]}],
      [IUIController,{useFactory:(injector:Injector)=>{
        const sidebar=injector.get(ISidebarService) as HostedSidebarService;
        const view=injector.createChild([[ISidebarService,{useValue:sidebar.nativeFacade()}]]);
        const controller=view.createInstance(DesktopUIController,ui);
        controller.disposeWithMe(view);
        return controller;
      },deps:[Injector]}]]}];
  });
  return preset;
}

let api: ReturnType<typeof createUniver>["univerAPI"] | undefined;
const documentId = crypto.randomUUID();
let reloadDraftObserver: ((draft: SpreadsheetReloadDraft) => void) | undefined;
let token = "",
  timer = 0,
  formulaWatchdog = 0,
  lastSent = "",
  initialized = false;
let formulaWorker: Worker | undefined;
let formulaRecoveryPending = false;
let lastReloadDraftSignature = "";
let expandedMode: boolean | undefined;
let mode: WorkbookDocument['mode'];
let interactive = false;
let cachedPreview: string | undefined;
let cachedViewport: WorkbookDocument["previewViewport"];
let savedViews: NonNullable<WorkbookDocument["views"]> = {};
const restoredViews = new Set<string>();
let renderRevision = 0;
let historyBaseline = "",
  historyDirty = false,
  viewDirty = false,
  ready = false;
let reloadDraftRestoring = false;
const FORMULA_CALCULATION_DEADLINE_MS = 5_000;

class FormulaCalculationTimeoutError extends Error {
  constructor() {
    super("A spreadsheet formula exceeded its calculation time limit.");
    this.name = "FormulaCalculationTimeoutError";
  }
}

const waitForFormulaCalculation = async () => {
  const formula = api?.getFormula();
  if (!formula) return;
  let timeout = 0;
  try {
    await Promise.race([
      formula.onCalculationResultApplied(15_000),
      new Promise<never>((_resolve, reject) => {
        timeout = window.setTimeout(
          () => reject(new FormulaCalculationTimeoutError()),
          FORMULA_CALCULATION_DEADLINE_MS,
        );
      }),
    ]);
  } finally {
    window.clearTimeout(timeout);
  }
};

const preserveSpreadsheetDraftBeforeUnload = () => {
  if (!ready || !reloadDraftObserver) return;
  const book = api?.getActiveWorkbook();
  const cell = book?.getActiveSheet().getActiveCell();
  const content = snapshot(false);
  if (!content) return;
  const draft: SpreadsheetReloadDraft = {
    content,
    ...(book?.isCellEditing() && cell ? {
      editingCell: { sheetId: book.getActiveSheet().getSheetId(), address: cell.getA1Notation() },
    } : {}),
  };
  const signature = JSON.stringify(draft);
  if (signature === lastReloadDraftSignature) return;
  lastReloadDraftSignature = signature;
  reloadDraftObserver(draft);
};

const recoverFromFormulaTimeout = (error: FormulaCalculationTimeoutError) => {
  if (formulaRecoveryPending) return;
  formulaRecoveryPending = true;
  window.clearTimeout(formulaWatchdog);
  formulaWorker?.terminate();
  formulaWorker = undefined;
  if (!ready) {
    send("error", { message: "A formula did not finish in time. The saved spreadsheet data was preserved." });
    return;
  }
  preserveSpreadsheetDraftBeforeUnload();
  send("formula-timeout", { message: "A formula took too long; the spreadsheet was saved and its calculation restarted." });
  console.warn(error.message);
  window.setTimeout(() => window.location.reload(), 0);
};

const scheduleFormulaCalculationWatchdog = () => {
  if (!ready || !interactive || formulaRecoveryPending) return;
  window.clearTimeout(formulaWatchdog);
  formulaWatchdog = window.setTimeout(() => {
    void waitForFormulaCalculation().catch((error) => {
      if (error instanceof FormulaCalculationTimeoutError) recoverFromFormulaTimeout(error);
      else console.warn("Spreadsheet formula calculation failed.", error);
    });
  }, 120);
};
const send = (type: string, payload: Record<string, unknown> = {}) => {
  if (type === "changed" && !interactive) return;
  parent.postMessage(
    { source: "noteboard-sheet", type, token, documentId, ...payload },
    "*",
  );
};
const repaint = () =>
  new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );

function preview() {
  const layers = [...document.querySelectorAll<HTMLCanvasElement>('canvas[id^="univer-sheet-main-canvas_"]')]
    .map((canvas) => ({ canvas, rect: canvas.getBoundingClientRect() }))
    .filter(
      ({ canvas, rect }) =>
        canvas.width > 0 &&
        canvas.height > 0 &&
        rect.width > 0 &&
        rect.height > 0 &&
        getComputedStyle(canvas).visibility !== "hidden",
    );
  if (!layers.length) return undefined;
  const left = 0, top = 0, width = innerWidth, height = innerHeight;
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

function applyView(value: WorkbookDocument) {
  const book = api?.getActiveWorkbook();
  if (!book || !ready) return;
  value.activeSheetId = book.getActiveSheet().getSheetId();
  value.views = {...savedViews};
  for (const id of value.workbook.sheetOrder ?? []) {
    if (!restoredViews.has(id) && savedViews[id]) continue;
    const scroll = book.getScrollStateBySheetId(id);
    if (scroll) value.views[id] = {sheetViewStartRow:scroll.sheetViewStartRow,
      sheetViewStartColumn:scroll.sheetViewStartColumn,offsetX:scroll.offsetX,offsetY:scroll.offsetY};
    const sheet = book.getSheetBySheetId(id);
    if (sheet && value.workbook.sheets?.[id]) value.workbook.sheets[id].zoomRatio = sheet.getSheet().getZoomRatio();
  }
}

function snapshot(includePreview = true) {
  if (!ready) return historyBaseline;
  const book = api?.getActiveWorkbook();
  if (!book) return "";
  const value: WorkbookDocument = {
    format: "noteboard/workbook",
    version: 1,
    ...(mode==='simple'?{mode}:{}),
    workbook: book.isCellEditing() ? structuredClone(book.save()) : book.save(),
    activeSheetId: book.getActiveSheet().getSheetId(),
  };
  applyView(value);
  // Include the current draft in autosave without ending the user's cell edit.
  if (book.isCellEditing()) {
    const editor = api?.getDocument("__INTERNAL_EDITOR__DOCS_NORMAL") as
      | {
          getBody?: () => { dataStream?: string };
          getDocumentDataModel?: () => { getSnapshot?: () => unknown };
        }
      | undefined;
    const draft = editor?.getBody?.();
    const richTextSnapshot = editor?.getDocumentDataModel?.().getSnapshot?.();
    const range = book.getActiveSheet().getActiveCell();
    if (draft && range) {
      const sheet = value.workbook.sheets![value.activeSheetId!],
        r = range.getRow(),
        c = range.getColumn(),
        row = (sheet.cellData[r] ??= {}),
        text = draft.dataStream?.replace(/\r\n$/, "") ?? "",
        draftCell = cellFromInput(text);
      row[c] = {
        ...draftCell,
        s: row[c]?.s,
        ...(!draftCell.f && richTextSnapshot ? { p: structuredClone(richTextSnapshot) as any } : {}),
      };
    }
  }
  if (!includePreview) return JSON.stringify(value);
  value.preview = cachedPreview;
  value.previewViewport = cachedViewport;
  return JSON.stringify(value);
}

// Capture before navigation, but dispose only after a terminal pagehide. A
// canceled beforeunload or BFCache restore keeps this spreadsheet API alive.
window.addEventListener('pagehide', (event) => {
  preserveSpreadsheetDraftBeforeUnload();
  if (event.persisted) return;
  clearTimeout(timer);
  window.clearTimeout(formulaWatchdog);
  formulaWorker?.terminate();
  formulaWorker = undefined;
  api?.dispose();
  api = undefined;
});
window.addEventListener('pageshow', (event) => {
  if (event.persisted) lastReloadDraftSignature = "";
});

async function flush() {
  clearTimeout(timer);
  await api?.getActiveWorkbook()?.endEditingAsync(true);
  try {
    await waitForFormulaCalculation();
  } catch (error) {
    if (error instanceof FormulaCalculationTimeoutError) recoverFromFormulaTimeout(error);
    throw error;
  }
  await repaint();
  const content = historySnapshot() || snapshot();
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
  if (viewDirty && !historyDirty && !api?.getActiveWorkbook()?.isCellEditing()) {
    const value = parseWorkbookDocument(historyBaseline);
    if (value) {
      applyView(value);
      delete value.preview;delete value.previewViewport;
      return JSON.stringify(value);
    }
  }
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
  const book = api!.getActiveWorkbook()!;
  const replacements = createUniqueSheetNames(
    document.workbook.sheetOrder.map((id) => document.workbook.sheets[id].name),
    book.getSheets().map((sheet) => sheet.getSheetName()),
  );
  const inserted: string[] = [];
  try {
    for (const id of document.workbook.sheetOrder) {
      const sheet = document.workbook.sheets[id];
      for (const row of Object.values(sheet.cellData) as any[])
        for (const cell of Object.values(row) as any[]) {
          if (!cell?.f) continue;
          cell.f = renameFormulaSheetReferences(cell.f, replacements);
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
  await flush();
  // File export includes freshly calculated results even when opening the
  // editor did not create a document change or a canvas Undo entry.
  const content = snapshot(false);
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
  if (mode==='simple') expanded=false;
  if (!api || expandedMode === expanded) return;
  expandedMode = expanded;
  setOverlayPresentation(expanded);
  api
    .setUIVisible(api.Enum.BuiltInUIPart.HEADER, expanded)
    .setUIVisible(api.Enum.BuiltInUIPart.TOOLBAR, expanded)
    .setUIVisible(api.Enum.BuiltInUIPart.FOOTER, expanded)
    .setUIVisible(api.Enum.BuiltInUIPart.CUSTOM_HEADER, interactive && !expanded);
  // Resize after the React dialog and UI parts have reached their new bounds.
  await repaint();
  window.dispatchEvent(new Event("resize"));
  await repaint();
}

function setInteractive(enabled: boolean, pendingAction = false) {
  const ownsChanges = enabled || pendingAction;
  if (interactive === ownsChanges && document.documentElement.inert === !enabled) return;
  interactive = ownsChanges;
  // Inert on the host alone does not prevent focus inside an iframe.
  document.documentElement.inert = !enabled;
  api?.setUIVisible(api.Enum.BuiltInUIPart.CUSTOM_HEADER, enabled && !expandedMode);
  if (enabled) api?.getActiveWorkbook()?.showSelection();
  if (!enabled && document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

async function restoreView() {
  const book = api?.getActiveWorkbook(), id = book?.getActiveSheet().getSheetId();
  if (!book || !id || restoredViews.has(id)) return;
  restoredViews.add(id);
  const view = savedViews[id];
  if (view) await api!.executeCommand(ScrollCommand.id,{...view,unitId:book.getId(),sheetId:id,duration:0});
  await repaint();
}

async function scrollToCell(row: number, column: number) {
  if (!Number.isSafeInteger(row) || row < 0 || row >= 1_048_576 ||
      !Number.isSafeInteger(column) || column < 0 || column >= 16_384)
    throw Error("The spreadsheet cell is outside the worksheet bounds.");
  const sheet = api?.getActiveWorkbook()?.getActiveSheet();
  if (!sheet) throw Error("The spreadsheet is not ready.");
  sheet.scrollToCell(row, column, 0);
  await repaint();
  return snapshot(false);
}

async function capturePreview() {
  if (!api || expandedMode) return "";
  const book = api.getActiveWorkbook();
  if (!book) return "";
  const value = parseWorkbookDocument(historyDirty ? snapshot(false) : historyBaseline) ?? parseWorkbookDocument(snapshot(false));
  if (!value) return "";
  const revision = renderRevision, wasInteractive = interactive;
  book.transparentSelection();
  try {
    await repaint();
    if (expandedMode || revision !== renderRevision || wasInteractive !== interactive) return "";
    cachedPreview = preview();
    cachedViewport = cachedPreview ? {width:innerWidth,height:innerHeight} : undefined;
    value.preview = cachedPreview;
    value.previewViewport = cachedViewport;
    applyView(value);
    return JSON.stringify(value);
  } finally {
    if (wasInteractive && interactive && api?.getActiveWorkbook()?.getId() === book.getId()) book.showSelection();
  }
}

async function replaceContent(content: string) {
  const value = parseWorkbookDocument(content);
  if (!api || !value) throw Error("Invalid spreadsheet data.");
  clearTimeout(timer);
  renderRevision++;
  ready = false;
  reloadDraftRestoring = false;
  historyBaseline = content;
  historyDirty = false;
  viewDirty = false;
  cachedPreview = value.preview;
  cachedViewport = value.previewViewport;
  savedViews = value.views ?? {};
  mode=value.mode;
  restoredViews.clear();
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
  await restoreView();
  ready = true;
  sendSelection();
}

async function setCellDimensions(width: number, height: number) {
  const book = api?.getActiveWorkbook();
  if (!book) throw Error("The spreadsheet is not ready.");
  await book.endEditingAsync(true);
  const sheet = book.getActiveSheet(),
    size = normalizeCellSize(width, height);
  const savedSheet = book.save().sheets?.[sheet.getSheetId()];
  if (!workbookCellDimensionsMatch(savedSheet, size)) {
    if (sheet.getColumnWidth(0) !== size.width ||
        Object.values(savedSheet?.columnData ?? {}).some(column =>
          column?.w !== undefined && column.w !== size.width))
      sheet.setColumnWidths(0, sheet.getSheet().getColumnCount(), size.width);
    if (sheet.getRowHeight(0) !== size.height ||
        Object.values(savedSheet?.rowData ?? {}).some(row =>
          (row?.h !== undefined && row.h !== size.height) || row?.ah !== undefined || row?.ia === 1))
      sheet.setRowHeightsForced(0, sheet.getSheet().getRowCount(), size.height);
  }
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
  const content = await flush();
  sendSelection();
  return content;
}

(window as any).noteboardSheet = {
  documentId,
  isReady: () => ready && !reloadDraftRestoring,
  observeReloadDraft: (observer:(draft:SpreadsheetReloadDraft)=>void) => {reloadDraftObserver=observer;},
  snapshot,
  historySnapshot,
  flush,
  importSheets,
  exportFile,
  setExpanded,
  setInteractive,
  capturePreview,
  replaceContent,
  setCellDimensions,
  scrollToCell,
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
    setInteractive(message.interactive === true);
    try {
      const calculationWorker = new Worker(
        new URL("./formula.worker.ts", import.meta.url),
        { type: "module" },
      );
      formulaWorker = calculationWorker;
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
          sheetCorePreset({
            workerURL: calculationWorker,
            container: "sheet-root",
            // Focus belongs to the user's cell click, never a background preview.
            disableAutoFocus: message.interactive === true ? undefined : true,
            // Register all editor parts once. Initializing them as false
            // prevents setUIVisible from restoring the expanded editor.
            header: true,
            toolbar: true,
            formulaBar: true,
            footer: {},
            sheets: document.mode==='simple'?{scrollConfig:{enableHorizontal:false,enableVertical:false}}:undefined,
          }),
          UniverSheetsSortPreset(),
          UniverSheetsFilterPreset(),
          UniverSheetsDataValidationPreset(),
          UniverSheetsConditionalFormattingPreset(),
        ],
      });
      api = created.univerAPI;
      const editorService = created.univer.__getInjector().get(IEditorService);
      mode=document.mode;
      api.updateMenuConfig({'sheet.menu.zoom-ratio':{disabled:mode==='simple'}});
      api.registerUIPart(api.Enum.BuiltInUIPart.CUSTOM_HEADER, () => React.createElement(SheetRibbon,{targetId:message.ribbonTarget}));
      api.addEvent(api.Event.BeforeCommandExecute,event=>{
        if (mode==='simple' && (event.id===ScrollCommand.id || event.id===SetZoomRatioOperation.id || event.id===SetScrollOperation.id)) event.cancel=true;
      });
      cachedPreview = document.preview;
      cachedViewport = document.previewViewport;
      savedViews = document.views ?? {};
      restoredViews.clear();
      const book = api.createWorkbook(document.workbook);
      if (
        document.activeSheetId &&
        book.getSheetBySheetId(document.activeSheetId)
      )
        book.setActiveSheet(document.activeSheetId);
      api.addEvent(api.Event.CommandExecuted, (event) => {
        if (ready && event.id === SetWorksheetActiveOperation.id) {
          cachedPreview = undefined;
          cachedViewport = undefined;
          void repaint().then(restoreView);
        }
        if (!ready || !interactive) return;
        if (event.type === CommandType.MUTATION && event.id.startsWith("sheet.") &&
            !/formula-calculation|row-auto-height/.test(event.id))
          scheduleFormulaCalculationWatchdog();
        renderRevision++;
        const viewChange = event.id === SetScrollOperation.id || event.id === SetZoomRatioOperation.id || event.id === SetWorksheetActiveOperation.id;
        if (viewChange) {
          viewDirty = true;
          cachedPreview = undefined;
          cachedViewport = undefined;
        }
        if (
          ready &&
          ((event.type === CommandType.MUTATION &&
            event.id.startsWith("sheet.") &&
            !/formula-calculation|row-auto-height/.test(event.id)) ||
            /rename|freeze/.test(event.id))
        ) {
          historyDirty = true;
          cachedPreview = undefined;
          cachedViewport = undefined;
        }
        if (/activate-sheet/.test(event.id)) {
          cachedPreview = undefined;
          cachedViewport = undefined;
        }
        // Univer 1.0.2 clears the filter model without invalidating SUBTOTAL's
        // cached visibility dependencies. Recalculate after the removal syncs.
        if (event.id === "sheet.mutation.remove-filter")
          queueMicrotask(() => api?.getFormula().executeCalculation());
        if (
          event.type !== CommandType.MUTATION &&
          !viewChange &&
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
      try {
        await waitForFormulaCalculation();
      } catch (error) {
        if (error instanceof FormulaCalculationTimeoutError) {
          recoverFromFormulaTimeout(error);
          return;
        }
        throw error;
      }
      formulaRecoveryPending = false;
      lastReloadDraftSignature = "";
      await setExpanded(message.expanded === true);
      await restoreView();
      await repaint();
      ready = true;
      const editingCell = message.reloadDraftEditingCell;
      if (interactive && editingCell && book.getSheetBySheetId(editingCell.sheetId)) {
        reloadDraftRestoring = true;
        book.setActiveSheet(editingCell.sheetId);
        const activeRange = book.getActiveSheet().getRange(editingCell.address);
        activeRange.activate();
        const savedInput = activeRange.getFormula() || activeRange.getValue();
        const expectedInput =
          typeof savedInput === "string" || typeof savedInput === "number"
            ? String(savedInput)
            : undefined;
        // startEditing() uses a double-click editor transition. If Univer kept
        // its editor bridge visible across reload, that transition can be a
        // no-op and leave a formula caret at offset zero. Reopen the persisted
        // draft through Univer's F2 operation, whose edit path restores the
        // caret at the end of the existing cell text.
        await book.endEditingAsync(false);
        await api.executeCommand(SetCellEditVisibleWithF2Operation.id, {
          unitId: book.getId(),
          visible: true,
          eventType: DeviceInputEventType.Keyboard,
          keycode: KeyCode.F2,
        });
        // Wait for the active edit document to contain the restored input before
        // declaring the frame loaded. On slower renderers the document unit can
        // exist with an empty body for several frames; moving that empty body's
        // caret to zero is then overwritten when Univer installs the draft.
        const waitFrame = (fallbackMs: number) => new Promise<void>((resolve) => {
          let frameId = 0;
          const timeoutId = window.setTimeout(() => {
            cancelAnimationFrame(frameId);
            resolve();
          }, fallbackMs);
          frameId = requestAnimationFrame(() => {
            window.clearTimeout(timeoutId);
            resolve();
          });
        });
        const activeElement = window.document.activeElement;
        const activeEditorId = activeElement?.id.startsWith("__editor_")
          ? activeElement.id.slice("__editor_".length)
          : undefined;
        const editorIds = [
          activeEditorId,
          "__INTERNAL_EDITOR__DOCS_NORMAL",
          "__INTERNAL_EDITOR__DOCS_FORMULA_BAR",
        ].filter((id, index, all): id is string => Boolean(id) && all.indexOf(id) === index);
        const getEditor = (id: string) => api.getDocument(id) as
          | {
              getBody?: () => { dataStream?: string };
              setSelection?: (start: number, end: number) => void;
            }
          | undefined;
        const cleanInput = (value: string) => value.replace(/\r\n$/, "");
        let restoredEditors: NonNullable<ReturnType<typeof getEditor>>[] = [];
        const restorationDeadline = performance.now() + 15_000;
        for (let frame = 0; frame < 300 && restoredEditors.length === 0 && performance.now() < restorationDeadline; frame++) {
          await waitFrame(Math.min(100, restorationDeadline - performance.now()));
          if (!book.isCellEditing()) continue;
          const candidates = editorIds
            .map(getEditor)
            .filter((editor): editor is NonNullable<ReturnType<typeof getEditor>> => {
              const dataStream = editor?.getBody?.().dataStream;
              return (
                typeof dataStream === "string" &&
                editor.setSelection !== undefined &&
                (expectedInput === undefined || cleanInput(dataStream) === expectedInput)
              );
            });
          if (!candidates.length) continue;
          await waitFrame(Math.min(100, Math.max(0, restorationDeadline - performance.now())));
          restoredEditors = candidates.filter((editor) => {
            const currentInput = editor.getBody?.().dataStream;
            return (
              typeof currentInput === "string" &&
              (expectedInput === undefined || cleanInput(currentInput) === expectedInput)
            );
          });
        }
        if (restoredEditors.length) {
          // Univer can keep both the in-cell and formula-bar documents mounted.
          // Align every matching restored editor so the focused one cannot retain
          // its old start-of-text caret while the other document is updated.
          const restoreCaret = () => {
            for (const editor of editorIds.map(getEditor)) {
              const dataStream = editor?.getBody?.().dataStream;
              if (
                !editor || typeof dataStream !== "string" ||
                (expectedInput !== undefined && cleanInput(dataStream) !== expectedInput)
              ) continue;
              const caret = cleanInput(dataStream).length;
              editor.setSelection?.(caret, caret);
            }
          };
          restoreCaret();
          await repaint();
          // Univer may reconcile the active formula-bar document one frame
          // after the body is restored. Re-fetch its live model and apply the
          // final caret after that reconciliation, before unblocking the host.
          await waitFrame(100);
          restoreCaret();
          await repaint();
          if (expectedInput !== undefined) {
            const targetEditorId = editorIds.find(id => {
              const editor = getEditor(id);
              const dataStream = editor?.getBody?.().dataStream;
              return typeof dataStream === "string" && cleanInput(dataStream) === expectedInput &&
                Boolean(editorService.getEditor(id));
            });
            const targetEditor = targetEditorId ? editorService.getEditor(targetEditorId) : undefined;
            if (!targetEditor)
              throw new Error("Could not locate the active spreadsheet edit cursor.");
            const caret = cleanInput(expectedInput).length;
            const caretIsRestored = () => {
              const currentInput = targetEditor.getDocumentData().body?.dataStream;
              return typeof currentInput === "string" && cleanInput(currentInput) === expectedInput &&
                targetEditor.getCursorPosition() === caret && targetEditor.isFocus();
            };
            const caretDeadline = performance.now() + 5_000;
            let stableFrames = 0;
            for (let frame = 0; frame < 50 && performance.now() < caretDeadline && stableFrames < 3; frame++) {
              if (caretIsRestored()) stableFrames++;
              else {
                stableFrames = 0;
                restoreCaret();
                targetEditor.focus();
              }
              await waitFrame(100);
            }
            if (stableFrames < 3)
              throw new Error("Could not restore the active spreadsheet edit cursor.");
          }
        }
      }
      reloadDraftRestoring = false;
      send("loaded");
      sendSelection();
    } catch (error) {
      ready = false;
      reloadDraftRestoring = false;
      send("error", {
        message:
          error instanceof Error
            ? error.message
            : "Could not open spreadsheet.",
      });
    }
  }
});
window.addEventListener("beforeunload", preserveSpreadsheetDraftBeforeUnload);
send("ready");
