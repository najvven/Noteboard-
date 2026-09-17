import React, { useState } from "react";
import SegmentedControl from "./SegmentedControl";
import { cn } from "../lib/utils";
import { ChevronDown, Settings2 } from "lucide-react";

export type PreviewMode = "box" | "realistic";

interface MenuSettingsBlockProps {
  alwaysOnTop: boolean;
  onAlwaysOnTopChange: (value: boolean) => void;
  keepToolActive: boolean;
  onKeepToolActiveChange: (value: boolean) => void;
  previewMode: PreviewMode;
  onPreviewModeChange: (value: PreviewMode) => void;
  compact?: boolean;
  narrow?: boolean;
  allowEditing?: boolean;
  onAllowEditingChange?: (value: boolean) => void;
  allowMoving?: boolean;
  onAllowMovingChange?: (value: boolean) => void;
}

const Toggle = ({
  checked,
  narrow = false,
}: {
  checked: boolean;
  narrow?: boolean;
}) => (
  <div
    data-menu-toggle="true"
    data-state={checked ? "on" : "off"}
    className={cn(
      "menu-settings-toggle box-border rounded-full flex items-center transition-colors duration-200 ease-in-out shrink-0 border border-gray-500/60",
      narrow ? "h-3.5 w-6 p-px" : "h-4 w-7 p-0.5",
      checked ? "bg-blue-500" : "bg-gray-200",
    )}
  >
    <div
      className={cn(
        "menu-settings-toggle-thumb h-3 w-3 bg-white rounded-full shadow-sm transform transition-transform duration-200 ease-in-out",
        checked
          ? narrow
            ? "translate-x-2.5"
            : "translate-x-3"
          : "translate-x-0",
      )}
    />
  </div>
);

/**
 * Shared settings footer for tool menus.
 *
 * The settings stay collapsed until the user explicitly expands this row.
 * This keeps every menu compact while preserving one consistent interaction
 * for the global-default/per-tool-override controls.
 */
const MenuSettingsBlock = ({
  alwaysOnTop,
  onAlwaysOnTopChange,
  keepToolActive,
  onKeepToolActiveChange,
  previewMode,
  onPreviewModeChange,
  compact = false,
  narrow = false,
  allowEditing = false,
  onAllowEditingChange,
  allowMoving = false,
  onAllowMovingChange,
}: MenuSettingsBlockProps) => {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      data-compact={compact ? "true" : undefined}
      data-narrow={narrow ? "true" : undefined}
      data-menu-settings-height="24"
      className={cn(
        "menu-settings-block relative box-border min-w-0 w-full",
        compact
          ? "mt-0 border-t-0"
          : "mt-0 border-t-2 border-gray-300 pt-2",
      )}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={(event) => {
          event.stopPropagation();
          setExpanded((value) => !value);
        }}
        className={cn(
          "menu-settings-header box-border flex h-6 min-h-6 w-full items-center justify-between rounded-lg py-0 text-left font-bold leading-none text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900",
          narrow ? "px-1.5 text-[10px]" : "px-2 text-xs",
        )}
      >
        <span
          data-menu-settings-caption="true"
          className="menu-settings-caption flex min-w-0 items-center gap-2 leading-4"
        >
          <Settings2 className="h-3.5 w-3.5 text-gray-500" />
          Tool settings
        </span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-gray-500 transition-transform",
            expanded && "rotate-180",
          )}
        />
      </button>

      {expanded && (
        <div
          className={cn(
            "menu-settings-content mt-1 w-full min-w-0 max-w-[95vw] overflow-x-hidden overflow-y-hidden rounded-lg pb-1 pt-1",
            narrow ? "px-1" : "px-2",
          )}
        >
          <div className="menu-settings-content-inner flex w-full min-w-0 flex-col gap-2">
          {[
            { label: 'Allow editing elements', value: allowEditing, change: onAllowEditingChange },
            { label: 'Allow moving elements', value: allowMoving, change: onAllowMovingChange },
          ].map(({ label, value, change }) => change ? (
            <button key={label} type="button" aria-pressed={value}
              onClick={() => change(!value)}
              className="flex min-h-8 w-full items-center justify-between gap-3 text-left text-xs font-bold text-gray-700">
              <span>{label}</span><Toggle checked={value} narrow={narrow} />
            </button>
          ) : null)}
          <div
            className={cn(
              "flex min-w-0 w-full flex-wrap items-center justify-between gap-y-1 font-bold text-gray-700 select-none",
              narrow ? "gap-x-1 text-[10px]" : "gap-x-2 text-xs",
            )}
          >
            <span className="shrink-0 whitespace-nowrap">Always on top</span>
            <button
              type="button"
              aria-label="Always on top"
              onClick={(event) => {
                event.stopPropagation();
                onAlwaysOnTopChange(!alwaysOnTop);
              }}
              className="menu-settings-control cursor-pointer"
            >
              <Toggle checked={alwaysOnTop} narrow={narrow} />
            </button>
          </div>

          <div
            className={cn(
              "flex min-w-0 w-full flex-wrap items-center justify-between gap-y-1 font-bold text-gray-700",
              narrow ? "gap-x-1 text-[10px]" : "gap-x-2 text-xs",
            )}
          >
            <span className="shrink-0 whitespace-nowrap">Tool mode</span>
            <SegmentedControl label="Tool mode" narrow={narrow} value={keepToolActive ? 'fixed' : 'unfixed'} onChange={value => onKeepToolActiveChange(value === 'fixed')} options={[{ value: 'unfixed', label: 'Unfixed' }, { value: 'fixed', label: 'Fixed' }]} />
          </div>

          <div
            className={cn(
              "flex min-w-0 w-full flex-wrap items-center justify-between gap-y-1 font-bold text-gray-700",
              narrow ? "gap-x-1 text-[10px]" : "gap-x-2 text-xs",
            )}
          >
            <span className="shrink-0 whitespace-nowrap">Preview</span>
            <SegmentedControl label="Preview" narrow={narrow} value={previewMode} onChange={onPreviewModeChange} options={[{ value: 'box', label: 'Translucent' }, { value: 'realistic', label: 'True' }]} />
          </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MenuSettingsBlock;
