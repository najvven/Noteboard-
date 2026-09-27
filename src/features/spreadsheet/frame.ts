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
  type WorkbookDocument,
} from "./workbook";

let api: ReturnType<typeof createUniver>["univerAPI"] | undefined;
let token = "",
  timer = 0,
  lastSent = "",
  initialized = false;
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

function snapshot() {
  const book = api?.getActiveWorkbook();
  if (!book) return "";
  const value: WorkbookDocument = {
    format: "noteboard/workbook",
    version: 1,
    workbook: book.isCellEditing() ? structuredClone(book.save()) : book.save(),
    activeSheetId: book.getActiveSheet().getSheetId(),
    preview: preview(),
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
  return JSON.stringify(value);
}
async function flush() {
  clearTimeout(timer);
  await api?.getActiveWorkbook()?.endEditingAsync(true);
  await api?.getFormula().onCalculationResultApplied(15000);
  await repaint();
  const content = snapshot();
  if (content) send("changed", { content });
  return content;
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
(window as any).noteboardSheet = { snapshot, flush, importSheets, exportFile };

window.addEventListener("message", async (event) => {
  if (event.source !== parent || event.data?.source !== "noteboard-host")
    return;
  const message = event.data;
  if (message.type === "init" && !initialized) {
    token = message.token;
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
            header: true,
            toolbar: true,
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
        }, 250);
      });
      api.getFormula().executeCalculation();
      await api.getFormula().onCalculationResultApplied(15000);
      await repaint();
      send("loaded");
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
