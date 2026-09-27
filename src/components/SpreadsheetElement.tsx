import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Table2, Maximize2, Check, X, Upload, Download } from "lucide-react";
import type { BoardElement } from "../types";
import {
  createWorkbookDocument,
  parseWorkbookDocument,
} from "../features/spreadsheet/workbook";

export default function SpreadsheetElement({
  element,
  onUpdate,
  isSelected,
  allowEditing,
}: {
  element: BoardElement;
  onUpdate: (updates: Partial<BoardElement>, skipHistory?: boolean) => void;
  isSelected?: boolean;
  allowEditing?: boolean;
}) {
  const [editing, setEditing] = useState(false),
    [loading, setLoading] = useState(true),
    [error, setError] = useState("");
  const [busy, setBusy] = useState(false),
    [fatal, setFatal] = useState(false),
    [notice, setNotice] = useState("");
  const importInput = useRef<HTMLInputElement>(null);
  const dialog = useRef<HTMLDialogElement>(null),
    frame = useRef<HTMLIFrameElement>(null),
    token = useRef(crypto.randomUUID());
  const latest = useRef({ element, onUpdate });
  latest.current = { element, onUpdate };
  const initialContent = useRef("");
  const document = React.useMemo(
    () => parseWorkbookDocument(element.content),
    [element.content],
  );
  const previewSheet =
    document?.workbook.sheets?.[
      document.activeSheetId || document.workbook.sheetOrder?.[0] || ""
    ];
  const open = () => {
    if (!allowEditing) return;
    initialContent.current =
      element.content ||
      JSON.stringify(createWorkbookDocument(element.name || "Spreadsheet"));
    setError("");
    setNotice("");
    setFatal(false);
    setLoading(true);
    setEditing(true);
  };
  const close = () => {
    dialog.current?.close();
    setEditing(false);
  };
  const sendInit = () =>
    frame.current?.contentWindow?.postMessage(
      {
        source: "noteboard-host",
        type: "init",
        token: token.current,
        content: initialContent.current,
      },
      "*",
    );
  useLayoutEffect(() => {
    if (!editing) return;
    dialog.current?.showModal();
    const timeout = window.setTimeout(() => {
      setLoading(false);
      setFatal(true);
      setError("The spreadsheet could not be opened. Close it and try again.");
    }, 30000);
    const receive = (event: MessageEvent) => {
      if (
        event.source !== frame.current?.contentWindow ||
        event.data?.source !== "noteboard-sheet"
      )
        return;
      const data = event.data;
      if (data.type === "ready") {
        sendInit();
        return;
      }
      if (data.token !== token.current) return;
      if (data.type === "loaded") {
        clearTimeout(timeout);
        setLoading(false);
        frame.current?.focus();
      } else if (data.type === "error") {
        clearTimeout(timeout);
        setLoading(false);
        setFatal(true);
        setError(data.message);
      } else if (
        data.type === "changed" &&
        parseWorkbookDocument(data.content) &&
        data.content !== latest.current.element.content
      )
        latest.current.onUpdate({ content: data.content }, true);
    };
    window.addEventListener("message", receive);
    return () => {
      clearTimeout(timeout);
      window.removeEventListener("message", receive);
    };
  }, [editing]);
  useEffect(
    () => () => {
      dialog.current?.close();
    },
    [],
  );
  const finish = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const content = await (
        frame.current?.contentWindow as any
      )?.noteboardSheet?.flush?.();
      if (!content || !parseWorkbookDocument(content))
        throw Error("The spreadsheet is not ready to save.");
      latest.current.onUpdate({ content }, false);
      close();
    } catch (reason) {
      setError(
        typeof (reason as any)?.message === "string"
          ? (reason as any).message
          : "Could not save spreadsheet.",
      );
    } finally {
      setBusy(false);
    }
  };
  const exchange = async (action: "import" | "xlsx" | "csv", file?: File) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const api = (frame.current?.contentWindow as any)?.noteboardSheet;
      if (action === "import" && file) {
        if (file.size > 20 * 1024 * 1024)
          throw Error("Spreadsheet files can be up to 20 MB.");
        const warnings = await api.importSheets(
          await file.arrayBuffer(),
          file.name,
        );
        setNotice(warnings.join(" "));
      } else if (action !== "import") {
        const bytes = await api.exportFile(action),
          url = URL.createObjectURL(
            new Blob([bytes], {
              type:
                action === "xlsx"
                  ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                  : "text/csv;charset=utf-8",
            }),
          );
        const anchor = window.document.createElement("a");
        anchor.href = url;
        anchor.download = `${(element.name || "Spreadsheet").replace(/[<>:"/\\|?*]/g, "_")}.${action}`;
        anchor.click();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
      }
    } catch (reason) {
      setError(
        typeof (reason as any)?.message === "string"
          ? (reason as any).message
          : "Could not process the file.",
      );
    } finally {
      setBusy(false);
      if (importInput.current) importInput.current.value = "";
    }
  };
  return (
    <>
      <div
        data-spreadsheet-object="true"
        className="relative overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm"
        style={{
          width: element.size?.width ?? 720,
          height: element.size?.height ?? 420,
        }}
        onDoubleClick={(event) => {
          event.stopPropagation();
          open();
        }}
      >
        {document?.preview ? (
          <img
            src={document.preview}
            draggable={false}
            className="h-full w-full object-fill pointer-events-none"
            alt={document.workbook.name || "Spreadsheet"}
          />
        ) : (
          <div className="h-full w-full">
            <div className="flex h-8 items-center gap-2 border-b bg-slate-50 px-3 text-xs font-semibold">
              <Table2 className="h-4 w-4" />
              {element.name || "Spreadsheet"}
            </div>
            <table
              aria-hidden="true"
              className="w-full table-fixed border-collapse text-[11px]"
            >
              <tbody>
                {Array.from(
                  {
                    length: Math.min(
                      50,
                      Math.ceil((element.size?.height ?? 420) / 24),
                    ),
                  },
                  (_, r) => (
                    <tr key={r} className="h-6">
                      {Array.from(
                        {
                          length: Math.min(
                            20,
                            Math.ceil((element.size?.width ?? 720) / 100),
                          ),
                        },
                        (_, c) => {
                          const cell = previewSheet?.cellData?.[r]?.[c],
                            style =
                              (typeof cell?.s === "string"
                                ? document?.workbook.styles?.[cell.s]
                                : cell?.s) || {};
                          return (
                            <td
                              key={c}
                              className="truncate border border-slate-200 px-1.5"
                              style={{
                                backgroundColor:
                                  typeof (style.bg || {}).rgb === "string"
                                    ? ((style.bg || {}).rgb as string)
                                    : undefined,
                                color:
                                  typeof (style.cl || {}).rgb === "string"
                                    ? ((style.cl || {}).rgb as string)
                                    : undefined,
                                fontWeight: style.bl === 1 ? "bold" : undefined,
                                fontStyle:
                                  style.it === 1 ? "italic" : undefined,
                              }}
                            >
                              {String(cell?.v ?? cell?.f ?? "")}
                            </td>
                          );
                        },
                      )}
                    </tr>
                  ),
                )}
              </tbody>
            </table>
          </div>
        )}
        {isSelected && allowEditing && (
          <button
            type="button"
            aria-label="Edit spreadsheet"
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              open();
            }}
            className="absolute right-2 top-2 flex items-center gap-1 rounded-lg border border-blue-200 bg-white px-2 py-1 text-xs font-bold text-blue-600 shadow-sm"
          >
            <Maximize2 className="h-3.5 w-3.5" />
            Edit spreadsheet
          </button>
        )}
      </div>
      {editing &&
        createPortal(
          <dialog
            ref={dialog}
            data-spreadsheet-editor="true"
            aria-label="Spreadsheet editor"
            onCancel={(event) => event.preventDefault()}
            onPointerDown={(event) => event.stopPropagation()}
            onPointerMove={(event) => event.stopPropagation()}
            onPointerUp={(event) => event.stopPropagation()}
            className="fixed inset-4 m-auto h-[calc(100vh-32px)] max-h-none w-[calc(100vw-32px)] max-w-none overflow-hidden rounded-xl border-[3px] border-gray-400 bg-white p-0 backdrop:bg-black/40"
          >
            <div className="flex h-11 items-center justify-between gap-3 border-b border-slate-200 bg-slate-50 px-3">
              <span className="flex min-w-0 items-center gap-2 truncate text-sm font-semibold">
                <Table2 className="h-4 w-4 shrink-0" />
                {element.name || "Spreadsheet"}
              </span>
              <div
                className="flex shrink-0 items-center gap-2 text-xs"
                onPointerDown={(event) => {
                  if ((event.target as HTMLElement).closest("button"))
                    event.preventDefault();
                }}
              >
                {!loading && !fatal && (
                  <>
                    <input
                      ref={importInput}
                      type="file"
                      accept=".xlsx,.csv,.tsv"
                      aria-label="Import spreadsheet file"
                      className="hidden"
                      onChange={(event) => {
                        const file = event.target.files?.[0];
                        if (file) void exchange("import", file);
                      }}
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => importInput.current?.click()}
                      className="flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-slate-200 disabled:opacity-40"
                    >
                      <Upload className="h-3.5 w-3.5" />
                      Import sheets
                    </button>
                    {(["xlsx", "csv"] as const).map((format) => (
                      <button
                        key={format}
                        type="button"
                        disabled={busy}
                        onClick={() => exchange(format)}
                        title={
                          format === "xlsx"
                            ? "Export values, formulas and cell formatting"
                            : "Export values from the current sheet"
                        }
                        aria-label={`Export ${format.toUpperCase()}`}
                        className="flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-slate-200 disabled:opacity-40"
                      >
                        <Download className="h-3.5 w-3.5" />
                        {format.toUpperCase()}
                      </button>
                    ))}
                  </>
                )}
                {loading || fatal ? (
                  <button
                    type="button"
                    aria-label="Cancel opening spreadsheet"
                    onClick={close}
                    className="rounded-lg p-1.5 text-slate-500"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={finish}
                    disabled={busy}
                    className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 font-semibold text-white disabled:opacity-40"
                  >
                    <Check className="h-4 w-4" />
                    {busy ? "Working…" : "Done"}
                  </button>
                )}
              </div>
            </div>
            {loading && (
              <div
                role="status"
                className="absolute inset-12 z-10 flex items-center justify-center bg-white"
              >
                Opening spreadsheet…
              </div>
            )}
            {(error || notice) && (
              <div
                role={error ? "alert" : "status"}
                className="absolute inset-x-4 top-12 z-20 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"
              >
                {error || notice}
                <button
                  type="button"
                  className="ml-3 underline"
                  onClick={() =>
                    fatal ? close() : (setError(""), setNotice(""))
                  }
                >
                  {fatal ? "Close" : "Dismiss"}
                </button>
              </div>
            )}
            <iframe
              ref={frame}
              data-spreadsheet-element-id={element.id}
              title="Spreadsheet cells"
              src={new URL("sheet.html", window.location.href).href}
              onLoad={sendInit}
              className="h-[calc(100%-44px)] w-full border-0"
              sandbox="allow-scripts allow-same-origin allow-downloads"
            />
          </dialog>,
          window.document.body,
        )}
    </>
  );
}
