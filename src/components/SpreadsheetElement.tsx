import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { Table2, Maximize2, Check, X, Upload, Download } from "lucide-react";
import type { BoardElement } from "../types";
import {
  createWorkbookDocument,
  parseWorkbookDocument,
  workbookCellSize,
  activeWorkbookSheet,
} from "../features/spreadsheet/workbook";
import {
  spreadsheetBridge,
  registerSpreadsheetCellSizer,
  type SpreadsheetAction,
  type SpreadsheetSelection,
} from "../features/spreadsheet/editor-bridge";
import SpreadsheetPanel from "./SpreadsheetPanel";

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
  const [expanded, setExpanded] = useState(false),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(""),
    [fatal, setFatal] = useState(false),
    [notice, setNotice] = useState("");
  const [selection, setSelection] = useState<SpreadsheetSelection | null>(null);
  const [retry, setRetry] = useState(0);
  const dialog = useRef<HTMLDialogElement>(null),
    frame = useRef<HTMLIFrameElement>(null),
    importInput = useRef<HTMLInputElement>(null);
  const token = useRef(crypto.randomUUID()),
    initialContent = useRef(""),
    originalContent = useRef(""),
    lastEmitted = useRef("");
  const latest = useRef({ element, onUpdate });
  latest.current = { element, onUpdate };
  const mounted = expanded || Boolean(isSelected && allowEditing);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const document = useMemo(
    () => parseWorkbookDocument(element.content),
    [element.content],
  );
  const previewSheet = activeWorkbookSheet(document);
  const cellSize = workbookCellSize(document);
  const emit = (content: string, commit = false) => {
    if (!parseWorkbookDocument(content)) return;
    lastEmitted.current = content;
    if (commit || content !== latest.current.element.content)
      latest.current.onUpdate({ content }, !commit);
  };
  const sendInit = () =>
    frame.current?.contentWindow?.postMessage(
      {
        source: "noteboard-host",
        type: "init",
        token: token.current,
        content: initialContent.current,
        originalContent: originalContent.current,
        expanded: expandedRef.current,
      },
      "*",
    );

  useLayoutEffect(() => {
    if (!mounted) return;
    initialContent.current =
      latest.current.element.content ||
      JSON.stringify(createWorkbookDocument(element.name || "Spreadsheet"));
    originalContent.current = latest.current.element.content;
    lastEmitted.current = initialContent.current;
    token.current = crypto.randomUUID();
    setLoading(true);
    setFatal(false);
    setError("");
    setNotice("");
    const timeout = window.setTimeout(() => {
      setLoading(false);
      setFatal(true);
      setError("The spreadsheet could not be opened. Try again.");
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
      } else if (data.type === "error") {
        clearTimeout(timeout);
        setLoading(false);
        setFatal(true);
        setError(data.message);
      } else if (data.type === "changed") emit(data.content);
      else if (data.type === "selection") setSelection(data.selection);
    };
    window.addEventListener("message", receive);
    const ownedFrame = frame.current!;
    const unregister = registerSpreadsheetCellSizer(
      ownedFrame,
      async (width, height) => {
        const api = spreadsheetBridge(ownedFrame);
        if (!api) throw Error("The spreadsheet is not ready.");
        emit(await api.setCellDimensions(width, height), true);
      },
    );
    return () => {
      unregister();
      clearTimeout(timeout);
      window.removeEventListener("message", receive);
    };
  }, [mounted, retry]);

  // The same iframe becomes a modal top-layer dialog. Its browsing context,
  // current selection and spreadsheet undo history survive both editing modes.
  useLayoutEffect(() => {
    const target = dialog.current;
    if (!mounted || !target) return;
    target.close();
    if (expanded) target.showModal();
    else target.setAttribute("open", "");
    if (!loading) void spreadsheetBridge(frame.current)?.setExpanded(expanded);
  }, [mounted, expanded, loading]);

  useEffect(() => {
    if (
      !mounted ||
      loading ||
      !element.content ||
      element.content === lastEmitted.current
    )
      return;
    lastEmitted.current = element.content;
    void spreadsheetBridge(frame.current)
      ?.replaceContent(element.content)
      .catch((reason) => setError(reason.message));
  }, [element.content, mounted, loading]);

  const open = () => {
    if (allowEditing) setExpanded(true);
  };
  const finish = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const content = await spreadsheetBridge(frame.current)?.flush();
      if (!content) throw Error("The spreadsheet is not ready to save.");
      emit(content, true);
      setExpanded(false);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not save spreadsheet.",
      );
    } finally {
      setBusy(false);
    }
  };
  const run = async (action: SpreadsheetAction) => {
    if (busy || loading) return;
    setBusy(true);
    setError("");
    try {
      await spreadsheetBridge(frame.current)?.action(action);
    } catch (reason) {
      setError(
        reason instanceof Error ? reason.message : "Could not update cells.",
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
      const api = spreadsheetBridge(frame.current);
      if (!api) throw Error("The spreadsheet is not ready.");
      if (action === "import" && file) {
        if (file.size > 20 * 1024 * 1024)
          throw Error("Spreadsheet files can be up to 20 MB.");
        const warnings = await api.importSheets(
          await file.arrayBuffer(),
          file.name,
        );
        setNotice(warnings.join(" "));
      } else if (action !== "import") {
        const bytes = await api.exportFile(action);
        const url = URL.createObjectURL(
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
        reason instanceof Error
          ? reason.message
          : "Could not process the file.",
      );
    } finally {
      setBusy(false);
      if (importInput.current) importInput.current.value = "";
    }
  };
  const alerts = (error || notice) && (
    <div
      role={error ? "alert" : "status"}
      className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900"
    >
      {error || notice}
      {fatal ? (
        <button
          type="button"
          className="ml-2 underline"
          onClick={() => setRetry((value) => value + 1)}
        >
          Retry
        </button>
      ) : (
        <button
          type="button"
          className="ml-2 underline"
          onClick={() => {
            setError("");
            setNotice("");
          }}
        >
          Dismiss
        </button>
      )}
    </div>
  );

  return (
    <>
      <div
        data-spreadsheet-object="true"
        className="relative overflow-hidden rounded-lg border border-slate-300 bg-white shadow-sm"
        style={{
          width: element.size?.width ?? 720,
          height: element.size?.height ?? 420,
        }}
      >
        {document?.preview ? (
          <img
            src={document.preview}
            draggable={false}
            className="pointer-events-none h-full w-full object-fill"
            alt={document.workbook.name || "Spreadsheet"}
          />
        ) : (
          <div className="h-full w-full overflow-hidden">
            <div className="flex h-8 items-center gap-2 border-b bg-slate-50 px-3 text-xs font-semibold">
              <Table2 className="h-4 w-4" />
              {element.name || "Spreadsheet"}
            </div>
            <table
              aria-hidden="true"
              className="table-fixed border-collapse text-[11px]"
              style={{
                width:
                  Math.ceil((element.size?.width ?? 720) / cellSize.width) *
                  cellSize.width,
              }}
            >
              <tbody>
                {Array.from(
                  {
                    length: Math.min(
                      50,
                      Math.ceil(
                        (element.size?.height ?? 420) / cellSize.height,
                      ),
                    ),
                  },
                  (_, r) => (
                    <tr key={r} style={{ height: cellSize.height }}>
                      {Array.from(
                        {
                          length: Math.min(
                            50,
                            Math.ceil(
                              (element.size?.width ?? 720) / cellSize.width,
                            ),
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
                                width: cellSize.width,
                                backgroundColor: style.bg?.rgb,
                                color: style.cl?.rgb,
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
        {mounted && (
          <dialog
            ref={dialog}
            data-spreadsheet-editor={expanded ? "true" : undefined}
            data-spreadsheet-inline={!expanded || undefined}
            aria-label={
              expanded ? "Spreadsheet editor" : "Spreadsheet on board"
            }
            onCancel={(event) => {
              event.preventDefault();
              if (expanded && !loading && !fatal) void finish();
            }}
            onPointerDown={(event) => {
              if (
                expanded ||
                (event.target as HTMLElement).closest("button,input")
              )
                event.stopPropagation();
            }}
            className={
              expanded
                ? "fixed inset-4 m-auto h-[calc(100vh-32px)] max-h-none w-[calc(100vw-32px)] max-w-none overflow-hidden rounded-xl border-[3px] border-gray-400 bg-white p-0 backdrop:bg-black/40"
                : "absolute inset-0 m-0 h-full max-h-none w-full max-w-none overflow-hidden border-0 bg-white p-0"
            }
          >
            <div
              className={`flex ${expanded ? "h-11" : "h-8"} items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3`}
            >
              <span className="flex min-w-0 items-center gap-2 truncate text-xs font-semibold">
                <Table2 className="h-4 w-4 shrink-0" />
                {element.name || "Spreadsheet"}
              </span>
              <div
                className="flex shrink-0 items-center gap-2 text-xs"
                onPointerDown={(event) => {
                  event.stopPropagation();
                  event.preventDefault();
                }}
              >
                {!expanded ? (
                  <button
                    type="button"
                    aria-label="Edit spreadsheet"
                    onClick={open}
                    className="flex items-center gap-1 text-xs font-bold text-blue-600"
                  >
                    <Maximize2 className="h-3.5 w-3.5" />
                    Edit spreadsheet
                  </button>
                ) : (
                  <>
                    {!loading && !fatal && (
                      <>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => importInput.current?.click()}
                          className="flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-slate-200"
                        >
                          <Upload className="h-3.5 w-3.5" />
                          Import sheets
                        </button>
                        {(["xlsx", "csv"] as const).map((format) => (
                          <button
                            key={format}
                            type="button"
                            disabled={busy}
                            aria-label={`Export ${format.toUpperCase()}`}
                            onClick={() => void exchange(format)}
                            className="flex items-center gap-1 rounded-md px-2 py-1.5 hover:bg-slate-200"
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
                        onClick={() => setExpanded(false)}
                        className="rounded-lg p-1.5"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => void finish()}
                        className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 font-semibold text-white disabled:opacity-40"
                      >
                        <Check className="h-4 w-4" />
                        {busy ? "Working…" : "Done"}
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
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
            {loading && (
              <div
                role="status"
                className="absolute inset-8 z-10 flex items-center justify-center bg-white text-xs"
              >
                Opening spreadsheet…
              </div>
            )}
            {expanded && alerts && (
              <div className="absolute inset-x-4 top-12 z-20">{alerts}</div>
            )}
            <iframe
              key={retry}
              ref={frame}
              data-spreadsheet-element-id={element.id}
              title="Spreadsheet cells"
              src={new URL("sheet.html", window.location.href).href}
              onLoad={sendInit}
              className="block w-full border-0"
              style={{ height: `calc(100% - ${expanded ? 44 : 32}px)` }}
              sandbox="allow-scripts allow-same-origin allow-downloads"
            />
          </dialog>
        )}
      </div>
      {mounted &&
        !expanded &&
        createPortal(
          <SpreadsheetPanel
            name={element.name || "Spreadsheet"}
            selection={selection}
            disabled={busy || loading || fatal}
            onAction={(action) => void run(action)}
            onExpand={open}
            onImport={() => importInput.current?.click()}
            onExport={(format) => void exchange(format)}
          >
            {alerts}
          </SpreadsheetPanel>,
          window.document.body,
        )}
    </>
  );
}
