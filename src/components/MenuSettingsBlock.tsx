import React, { useState } from "react";
import SegmentedControl from "./SegmentedControl";
import ToggleSwitch from "./ToggleSwitch";
import { cn } from "../lib/utils";
import { ChevronDown, Settings2 } from "lucide-react";

export type PreviewMode = "box" | "realistic";

interface MenuSettingsBlockProps {
  menuId?: string;
  alwaysOnTop: boolean;
  onAlwaysOnTopChange: (value: boolean) => void;
  alwaysOnTopDisabled?: boolean;
  alwaysOnTopOnly?: boolean;
  keepToolActive: boolean;
  onKeepToolActiveChange: (value: boolean) => void;
  ratio?: boolean;
  onRatioChange?: (value: boolean) => void;
  previewMode: PreviewMode;
  onPreviewModeChange: (value: PreviewMode) => void;
  compact?: boolean;
  narrow?: boolean;
  allowEditing?: boolean;
  onAllowEditingChange?: (value: boolean) => void;
  allowMoving?: boolean;
  onAllowMovingChange?: (value: boolean) => void;
  pageInteractionWithSelect?: boolean;
  onPageInteractionWithSelectChange?: (value: boolean) => void;
  pageInteractionWithHand?: boolean;
  onPageInteractionWithHandChange?: (value: boolean) => void;
}

/**
 * Shared settings footer for tool menus.
 *
 * The settings stay collapsed until the user explicitly expands this row.
 * This keeps every menu compact while preserving one consistent interaction
 * for the global-default/per-tool-override controls.
 */
const MenuSettingsBlock = ({
  menuId = "tool",
  alwaysOnTop,
  onAlwaysOnTopChange,
  alwaysOnTopDisabled = false,
  alwaysOnTopOnly = false,
  keepToolActive,
  onKeepToolActiveChange,
  ratio = false,
  onRatioChange = () => undefined,
  previewMode,
  onPreviewModeChange,
  compact = false,
  narrow = false,
  allowEditing = false,
  onAllowEditingChange,
  allowMoving = false,
  onAllowMovingChange,
  pageInteractionWithSelect = false,
  onPageInteractionWithSelectChange,
  pageInteractionWithHand = true,
  onPageInteractionWithHandChange,
}: MenuSettingsBlockProps) => {
  const [expanded, setExpanded] = useState(false);
  const shortcutCategory = menuId === "select" ? "Select"
    : menuId === "text" ? "Text"
    : menuId === "shapes" ? "Shapes"
    : menuId === "draw" ? "Draw"
    : menuId === "media" ? "Media"
    : menuId === "embed" ? "Web"
    : menuId === "grid" ? "Board Settings"
    : menuId === "table" ? "Spreadsheet"
    : menuId === "object-presets" ? "Object Presets"
    : menuId === "link" ? "Object Links"
    : menuId === "eraser" ? "Eraser"
    : "Tool Settings";

  return (
    <div
      data-menu-settings-for={menuId}
      data-compact={compact ? "true" : undefined}
      data-narrow={narrow ? "true" : undefined}
      data-menu-settings-height="24"
      className={cn(
        "menu-settings-block relative box-border min-w-0 w-full",
        compact
          ? "mt-1 border-t border-gray-300 pt-1"
          : "mt-2 border-t-2 border-gray-300 pt-2",
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
          Tool Settings
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
          className="menu-settings-content mt-1 w-full min-w-0 max-w-[95vw] overflow-x-hidden overflow-y-hidden rounded-lg pb-1 pt-1"
        >
          <div className="menu-settings-content-inner flex w-full min-w-0 flex-col gap-2">
          {[
            { label: 'Allow Editing Elements', key: 'allowEditing', value: allowEditing, change: onAllowEditingChange },
            { label: 'Allow Moving Elements', key: 'allowMoving', value: allowMoving, change: onAllowMovingChange },
            { label: 'Use Page With Select', key: 'pageInteractionWithSelect', value: pageInteractionWithSelect, change: onPageInteractionWithSelectChange },
            { label: 'Use Page With Hand', key: 'pageInteractionWithHand', value: pageInteractionWithHand, change: onPageInteractionWithHandChange },
          ].map(({ label, key, value, change }) => change ? (
            <button key={label} type="button" aria-pressed={value}
              data-shortcut-action={`tool:${menuId}:${key}`}
              data-shortcut-label={label}
              data-shortcut-category={shortcutCategory}
              onClick={() => change(!value)}
              className="settings-row flex min-h-8 w-full items-center justify-between gap-3 text-left text-xs font-bold text-gray-700">
              <span className="settings-label settings-label-strong">{label}</span><ToggleSwitch checked={value} compact={narrow} />
            </button>
          ) : null)}
          <div
            className={cn(
              "settings-row flex min-w-0 w-full flex-wrap items-center justify-between gap-y-1 font-bold select-none",
              alwaysOnTopDisabled ? "text-gray-400" : "text-gray-700",
              narrow ? "gap-x-1 text-[10px]" : "gap-x-2 text-xs",
            )}
          >
            <span className={cn("settings-label settings-label-strong min-w-0 flex-1", alwaysOnTopDisabled && "settings-label-disabled")}>Tool Settings Always On Top</span>
            <button
              type="button"
              aria-label="Tool Settings Always On Top"
              aria-pressed={alwaysOnTop}
              aria-disabled={alwaysOnTopDisabled}
              disabled={alwaysOnTopDisabled}
              data-menu-always-on-top={menuId}
              data-shortcut-action={`tool:${menuId}:alwaysOnTop`}
              data-shortcut-label="Tool Settings Always On Top"
              title={alwaysOnTopDisabled ? "More controls whether this menu stays open while the tool is there." : "Keep this tool's settings menu open."}
              data-shortcut-category={shortcutCategory}
              onClick={(event) => {
                event.stopPropagation();
                onAlwaysOnTopChange(!alwaysOnTop);
              }}
              className="menu-settings-control cursor-pointer disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ToggleSwitch checked={alwaysOnTop} compact={narrow} />
            </button>
          </div>

          {!alwaysOnTopOnly && <>
          <div
            className={cn(
              "settings-row flex min-w-0 w-full flex-wrap items-center justify-between gap-y-1 font-bold text-gray-700",
              narrow ? "gap-x-1 text-[10px]" : "gap-x-2 text-xs",
            )}
          >
            <span className="settings-label settings-label-strong min-w-0 flex-1">Keep Tool Active</span>
            <button type="button" aria-label="Keep Tool Active" aria-pressed={keepToolActive}
              data-shortcut-action={`tool:${menuId}:keepToolActive`}
              data-shortcut-label="Keep Tool Active"
              data-shortcut-category={shortcutCategory}
              onClick={() => onKeepToolActiveChange(!keepToolActive)} className="menu-settings-control">
              <ToggleSwitch checked={keepToolActive} compact={narrow} />
            </button>
          </div>

          <div className={cn(
            "settings-row flex min-w-0 w-full flex-wrap items-center justify-between gap-y-1 font-bold text-gray-700",
            narrow ? "gap-x-1 text-[10px]" : "gap-x-2 text-xs",
          )}>
            <span className="settings-label settings-label-strong min-w-0 flex-1">Ratio</span>
            <div className="flex shrink-0 items-center gap-1.5">
              <button type="button" aria-label="Ratio" aria-pressed={ratio}
                data-shortcut-action={`tool:${menuId}:ratio`}
                data-shortcut-label="Ratio"
                data-shortcut-category={shortcutCategory}
                onClick={() => onRatioChange(!ratio)} className="menu-settings-control">
                <ToggleSwitch checked={ratio} compact={narrow} />
              </button>
            </div>
          </div>

          <div
            data-shortcut-action={`tool:${menuId}:previewMode`}
            data-shortcut-label="Preview"
            data-shortcut-category={shortcutCategory}
            className={cn(
              "settings-row flex min-w-0 w-full flex-wrap items-center justify-between gap-y-1 font-bold text-gray-700",
              narrow ? "gap-x-1 text-[10px]" : "gap-x-2 text-xs",
            )}
          >
            <span className="settings-label settings-label-strong shrink-0 whitespace-nowrap">Preview</span>
            <SegmentedControl label="Preview" narrow={narrow} value={previewMode} onChange={onPreviewModeChange} options={[{ value: 'box', label: 'Area' }, { value: 'realistic', label: 'Object' }]} />
          </div>
          </>}
          </div>
        </div>
      )}
    </div>
  );
};

export default MenuSettingsBlock;
