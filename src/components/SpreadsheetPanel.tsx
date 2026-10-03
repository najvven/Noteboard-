import React, { useEffect, useState } from "react";
import {
  Bold,
  Italic,
  Undo2,
  Redo2,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Table2,
} from "lucide-react";
import type {
  SpreadsheetAction,
  SpreadsheetSelection,
} from "../features/spreadsheet/editor-bridge";

const button =
  "rounded-md border border-gray-200 bg-white px-2 py-1.5 text-xs font-semibold text-gray-700 hover:bg-gray-100 disabled:opacity-40";
export default function SpreadsheetPanel({
  name,
  selection,
  disabled,
  onAction,
  onExpand,
  onImport,
  onExport,
  children,
}: {
  name: string;
  selection: SpreadsheetSelection | null;
  disabled: boolean;
  onAction: (action: SpreadsheetAction) => void;
  onExpand: () => void;
  onImport: () => void;
  onExport: (format: "xlsx" | "csv") => void;
  children?: React.ReactNode;
}) {
  const [input, setInput] = useState("");
  const [fontSize, setFontSize] = useState("11");
  useEffect(() => {
    setInput(selection?.input ?? "");
  }, [selection?.input, selection?.address, selection?.sheetId]);
  useEffect(() => {
    setFontSize(String(selection?.fontSize ?? 11));
  }, [selection?.fontSize, selection?.address, selection?.sheetId]);
  const run = onAction;
  return (
    <aside
      data-spreadsheet-panel="true"
      aria-label="Spreadsheet settings"
      className="fixed right-3 top-24 bottom-32 z-[220] w-[300px] max-w-[calc(100vw-24px)] overflow-hidden rounded-xl border-[3px] border-gray-400 bg-white p-3 text-xs shadow-xl"
      onPointerDown={(event) => {
        event.stopPropagation();
        if ((event.target as HTMLElement).closest("button"))
          event.preventDefault();
      }}
      onKeyDown={(event) => event.stopPropagation()}
    >
      <div className="menu-scroll-viewport h-full overflow-y-auto">
        <div className="mb-3 flex items-center gap-2 border-b-2 border-gray-300 pb-2 font-bold text-gray-800">
          <Table2 className="h-4 w-4" />
          <span className="truncate">{name}</span>
        </div>
        <fieldset
          disabled={disabled}
          className="flex flex-col gap-3 disabled:opacity-50"
        >
          <div className="flex items-center justify-between">
            <span className="font-bold text-gray-600">
              {selection?.address || "Select a cell"}
            </span>
            <div className="flex gap-1">
              <button
                aria-label="Undo spreadsheet change"
                className={button}
                onClick={() => run({ type: "undo" })}
              >
                <Undo2 className="h-4 w-4" />
              </button>
              <button
                aria-label="Redo spreadsheet change"
                className={button}
                onClick={() => run({ type: "redo" })}
              >
                <Redo2 className="h-4 w-4" />
              </button>
            </div>
          </div>
          <label className="flex flex-col gap-1.5 font-semibold text-gray-600">
            Value or formula
            <textarea
              aria-label="Cell value or formula"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              rows={2}
              className="resize-y rounded-md border-2 border-gray-200 px-2 py-1.5 font-normal text-gray-900 outline-none focus:border-blue-400"
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  run({ type: "value", value: input });
                }
              }}
            />
          </label>
          <button
            className={button}
            onClick={() => run({ type: "value", value: input })}
          >
            Apply to active cell
          </button>
          <div className="flex items-center gap-1.5">
            <button
              aria-label="Bold cells"
              aria-pressed={selection?.bold ?? false}
              className={button}
              onClick={() => run({ type: "bold", value: !selection?.bold })}
            >
              <Bold className="h-4 w-4" />
            </button>
            <button
              aria-label="Italic cells"
              aria-pressed={selection?.italic ?? false}
              className={button}
              onClick={() => run({ type: "italic", value: !selection?.italic })}
            >
              <Italic className="h-4 w-4" />
            </button>
            <label className="ml-auto flex items-center gap-1.5">
              Font size
              <input
                aria-label="Cell font size"
                type="number"
                min={6}
                max={200}
                value={fontSize}
                className="w-14 rounded-md border border-gray-200 p-1 text-center"
                onChange={(event) => setFontSize(event.target.value)}
                onBlur={() => {
                  if (Number(fontSize) !== selection?.fontSize)
                    run({
                      type: "fontSize",
                      value: Math.max(6, Math.min(200, Number(fontSize) || 11)),
                    });
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    event.currentTarget.blur();
                  }
                }}
              />
            </label>
          </div>
          <div className="flex justify-between gap-2">
            <label className="flex items-center gap-2">
              Text color
              <input
                aria-label="Cell text color"
                type="color"
                value={selection?.color || "#000000"}
                className="h-7 w-8"
                onChange={(event) =>
                  run({ type: "color", value: event.target.value })
                }
              />
            </label>
            <label className="flex items-center gap-2">
              Fill
              <input
                aria-label="Cell fill color"
                type="color"
                value={selection?.fill || "#ffffff"}
                className="h-7 w-8"
                onChange={(event) =>
                  run({ type: "fill", value: event.target.value })
                }
              />
            </label>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="mr-auto">Alignment</span>
            {(
              [
                ["left", AlignLeft],
                ["center", AlignCenter],
                ["right", AlignRight],
              ] as const
            ).map(([value, Icon]) => (
              <button
                key={value}
                aria-label={`Align cells ${value}`}
                aria-pressed={
                  selection?.alignment ===
                  (value === "right" ? "normal" : value)
                }
                className={button}
                onClick={() => run({ type: "align", value })}
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>
          <label className="flex items-center justify-between gap-2">
            Number format
            <select
              aria-label="Cell number format"
              value={selection?.numberFormat ?? ""}
              className="rounded-md border border-gray-200 p-1.5"
              onChange={(event) =>
                run({ type: "numberFormat", value: event.target.value })
              }
            >
              {selection?.numberFormat &&
                !["0.00", "0%", "$#,##0.00", "yyyy-mm-dd", "@"].includes(
                  selection.numberFormat,
                ) && <option value={selection.numberFormat}>Custom</option>}
              <option value="">General</option>
              <option value="0.00">Number</option>
              <option value="0%">Percent</option>
              <option value="$#,##0.00">Currency</option>
              <option value="yyyy-mm-dd">Date</option>
              <option value="@">Text</option>
            </select>
          </label>
          <div className="border-t-2 border-gray-200 pt-3">
            <div className="mb-2 font-bold text-gray-600">Rows and columns</div>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                className={button}
                onClick={() => run({ type: "insertRow" })}
              >
                Insert row
              </button>
              <button
                className={button}
                onClick={() => run({ type: "insertColumn" })}
              >
                Insert column
              </button>
              <button
                className={button}
                onClick={() => run({ type: "deleteRows" })}
              >
                Delete rows
              </button>
              <button
                className={button}
                onClick={() => run({ type: "deleteColumns" })}
              >
                Delete columns
              </button>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-1.5">
            <button
              className={button}
              onClick={() => run({ type: "sort", ascending: true })}
            >
              Sort ascending
            </button>
            <button
              className={button}
              onClick={() => run({ type: "sort", ascending: false })}
            >
              Sort descending
            </button>
          </div>
          <button className={button} onClick={() => run({ type: "clear" })}>
            Clear selected cells
          </button>
          <div className="flex flex-col gap-1.5 border-t-2 border-gray-200 pt-3">
            <button className={button} onClick={onExpand}>
              Expanded editor
            </button>
            <button className={button} onClick={onImport}>
              Import sheets
            </button>
            <div className="grid grid-cols-2 gap-1.5">
              <button className={button} onClick={() => onExport("xlsx")}>
                Export XLSX
              </button>
              <button className={button} onClick={() => onExport("csv")}>
                Export CSV
              </button>
            </div>
          </div>
        </fieldset>
        {children}
      </div>
    </aside>
  );
}
