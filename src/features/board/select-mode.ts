export const SELECT_MODES = ["rectangle", "lasso", "polygon"] as const;
export type SelectMode = (typeof SELECT_MODES)[number];

/** Retain the selected variation when opening documents with older tools. */
export function initialSelectMode(
  mode?: string,
  legacyTool?: string,
): SelectMode {
  if (SELECT_MODES.includes(mode as SelectMode)) return mode as SelectMode;
  if (legacyTool === "lasso") return "lasso";
  if (legacyTool === "polygon-select") return "polygon";
  return "rectangle";
}
