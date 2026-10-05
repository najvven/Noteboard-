import React, { useEffect, useState } from "react";

export default function SpreadsheetCellSizeControls({
  width,
  height,
  onCommit,
}: {
  key?: React.Key;
  width: number;
  height: number;
  onCommit: (axis: "width" | "height", value: number) => void;
}) {
  const [draft, setDraft] = useState({
    width: String(width),
    height: String(height),
  });
  useEffect(
    () => setDraft({ width: String(width), height: String(height) }),
    [width, height],
  );
  const commit = (axis: "width" | "height", raw: string) => {
    const value = Number(raw);
    if (
      raw.trim() &&
      Number.isFinite(value) &&
      value !== (axis === "width" ? width : height)
    )
      onCommit(axis, value);
    else
      setDraft((current) => ({
        ...current,
        [axis]: String(axis === "width" ? width : height),
      }));
  };
  return (
    <div className="flex items-center gap-3" data-spreadsheet-cell-size="true">
      {(["width", "height"] as const).map((axis) => (
        <label
          key={axis}
          className="flex items-center gap-2 text-xs font-semibold text-gray-600"
        >
          Cell {axis}
          <input
            aria-label={`Cell ${axis}`}
            type="number"
            min={axis === "width" ? 20 : 12}
            max={axis === "width" ? 1000 : 400}
            value={draft[axis]}
            onChange={(event) =>
              setDraft((current) => ({
                ...current,
                [axis]: event.target.value,
              }))
            }
            onBlur={(event) => commit(axis, event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                event.currentTarget.blur();
              }
            }}
            className="w-16 rounded-lg border-2 border-gray-300 bg-gray-50 px-2 py-1.5 text-center text-xs text-gray-800 outline-none focus:border-blue-400"
          />
          <span className="text-[10px]">px</span>
        </label>
      ))}
    </div>
  );
}
