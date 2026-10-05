import React, { useEffect, useState } from "react";
import { Table2 } from "lucide-react";
import type {
  SpreadsheetAction,
  SpreadsheetSelection,
} from "../features/spreadsheet/editor-bridge";
const button =
  "rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-40";
/** The live Univer ribbon owns formatting/data commands in both editing views. */
export default function SpreadsheetPanel({
  name,
  selection,
  disabled,
  onAction,
  onImport,
  onExport,
  expandable,
  ribbonTarget,
  children,
}: {
  name: string;
  selection: SpreadsheetSelection | null;
  disabled: boolean;
  onAction: (action: SpreadsheetAction) => void;
  onImport: () => void;
  onExport: (format: "xlsx" | "csv") => void;
  expandable: boolean;
  ribbonTarget: string;
  children?: React.ReactNode;
}) {
  const [input, setInput] = useState("");
  useEffect(
    () => setInput(selection?.input ?? ""),
    [selection?.input, selection?.address, selection?.sheetId],
  );
  return (
    <aside
      data-spreadsheet-panel="true"
      aria-label="Spreadsheet settings"
      className="fixed right-3 top-24 bottom-32 z-[220] w-[320px] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border-[3px] border-gray-400 bg-white p-3 text-xs shadow-xl"
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="menu-scroll-viewport h-full overflow-y-auto">
        <div className="mb-2 flex items-center gap-2 border-b-2 border-gray-300 pb-2 font-bold text-gray-800">
          <Table2 className="h-4 w-4" />
          <span className="truncate">{name}</span>
        </div>
        {children}
        <fieldset
          disabled={disabled}
          className="mb-3 flex flex-col gap-2 disabled:opacity-50"
        >
          <span className="font-bold text-gray-600">
            {selection?.address || "Select a cell"}
          </span>
          <label className="flex flex-col gap-1 font-semibold text-gray-600">
            Value or formula
            <textarea
              aria-label="Cell value or formula"
              value={input}
              rows={2}
              onChange={(event) => setInput(event.target.value)}
              className="resize-y rounded-md border-2 border-gray-200 px-2 py-1.5 font-normal text-gray-900 outline-none focus:border-blue-400"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  onAction({ type: "value", value: input });
                }
              }}
            />
          </label>
          <button
            className={button}
            onPointerDown={(event) => event.preventDefault()}
            onClick={() => onAction({ type: "value", value: input })}
          >
            Apply to active cell
          </button>
        </fieldset>
        <div
          id={ribbonTarget}
          data-spreadsheet-ribbon="true"
          aria-label="Spreadsheet tools"
        />
        <fieldset
          disabled={disabled}
          className="mt-3 flex flex-wrap gap-2 border-t-2 border-gray-200 pt-3"
          onPointerDown={(event) => {
            if ((event.target as HTMLElement).closest("button"))
              event.preventDefault();
          }}
        >
          {expandable && (
            <button className={button} onClick={onImport}>
              Import sheets
            </button>
          )}
          <button
            className={button}
            aria-label="Export XLSX"
            onClick={() => onExport("xlsx")}
          >
            Export XLSX
          </button>
          <button
            className={button}
            aria-label="Export CSV"
            onClick={() => onExport("csv")}
          >
            Export CSV
          </button>
        </fieldset>
      </div>
    </aside>
  );
}
