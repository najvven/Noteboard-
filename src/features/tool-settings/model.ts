/**
 * Settings shared by tool menus, with fixed app defaults and sparse per-tool overrides.
 *
 * Per-tool values are sparse overrides of fixed app defaults. No editable
 * global tool-settings group is persisted.
 * `previewMode: "box"` is the Area preview; `"realistic"` is Object.
 */
export interface ToolMenuSettings {
  alwaysOnTop: boolean;
  keepToolActive: boolean;
  ratio?: boolean;
  previewMode: "box" | "realistic";
  /** Opt-in transforms with the element's own creation tool. */
  allowEditing?: boolean;
  allowMoving?: boolean;
  pageInteractionWithSelect?: boolean;
  pageInteractionWithHand?: boolean;
}

export type ToolMenuSettingKey = keyof ToolMenuSettings;

/** Values explicitly changed for one tool. Missing keys inherit globally. */
export type ToolMenuSettingsOverride = Partial<ToolMenuSettings>;

/** Per-tool overrides keyed by the stable toolbar/tool identifier. */
export type ToolMenuSettingsOverrides = Record<
  string,
  ToolMenuSettingsOverride
>;

const MIGRATED_TOOL_MENU_IDS = [
  "select", "pan", "text", "shapes", "media", "draw", "fill", "eraser",
  "embed", "grid", "link", "object-presets", "table", "more",
] as const;

/**
 * Convert the former board-wide tool settings into per-tool overrides once.
 * Existing per-tool values win, and the independent picker menus retain
 * their always-on-top defaults unless the board already has an explicit value.
 */
export function migrateLegacyToolMenuSettings(
  overrides: Readonly<ToolMenuSettingsOverrides> | null | undefined,
  legacy: {
    alwaysOnTop?: unknown;
    keepToolActive?: unknown;
    previewMode?: unknown;
    proportionalScale?: unknown;
  },
): ToolMenuSettingsOverrides {
  const next: ToolMenuSettingsOverrides = Object.fromEntries(
    Object.entries(overrides ?? {}).map(([id, settings]) => [id, { ...settings }]),
  );
  const legacyValues: Partial<ToolMenuSettingsOverride> = {};
  if (typeof legacy.keepToolActive === "boolean") legacyValues.keepToolActive = legacy.keepToolActive;
  if (legacy.previewMode === "box" || legacy.previewMode === "realistic")
    legacyValues.previewMode = legacy.previewMode;
  if (typeof legacy.proportionalScale === "boolean") legacyValues.ratio = legacy.proportionalScale;
  if (typeof legacy.alwaysOnTop === "boolean") legacyValues.alwaysOnTop = legacy.alwaysOnTop;

  for (const menuId of MIGRATED_TOOL_MENU_IDS) {
    const current = next[menuId] ?? {};
    const migrated = { ...current };
    for (const [key, value] of Object.entries(legacyValues) as Array<[
      keyof ToolMenuSettingsOverride,
      ToolMenuSettingsOverride[keyof ToolMenuSettingsOverride],
    ]>) {
      if (migrated[key] !== undefined) continue;
      if (key === "alwaysOnTop" && (menuId === "link" || menuId === "object-presets")) continue;
      (migrated as Record<string, unknown>)[key] = value;
    }
    if (Object.keys(migrated).length) next[menuId] = migrated;
  }
  return next;
}

/**
 * Object-picking workflows need to remain available while the user clicks the
 * board, so they intentionally own per-tool defaults. Explicit overrides win.
 */
export const INDEPENDENT_WORKFLOW_MENU_DEFAULTS: Readonly<
  Record<string, Partial<ToolMenuSettings>>
> = {
  // These pickers stay open while the user chooses an item. Their other
  // settings use the same fixed app defaults as other tools.
  link: { alwaysOnTop: true },
  "object-presets": { alwaysOnTop: true },
};

/** Creation tools can have safe, tool-specific transform defaults. */
export const TOOL_MENU_DEFAULT_OVERRIDES: Readonly<
  Record<string, ToolMenuSettingsOverride>
> = {
  text: { allowEditing: true, allowMoving: true },
};

/**
 * Resolves a tool's effective settings without mutating either input object.
 * Overrides are intentionally sparse so every unchanged setting stays at
 * the app default.
 */
export const resolveToolMenuSettings = (
  defaults: Readonly<ToolMenuSettings>,
  override?: Readonly<ToolMenuSettingsOverride> | null,
): ToolMenuSettings => ({
  alwaysOnTop: override?.alwaysOnTop ?? defaults.alwaysOnTop,
  keepToolActive: override?.keepToolActive ?? defaults.keepToolActive,
  ratio: override?.ratio ?? defaults.ratio ?? false,
  previewMode: override?.previewMode ?? defaults.previewMode,
  ...((override?.allowEditing ?? defaults.allowEditing) !== undefined
    ? { allowEditing: override?.allowEditing ?? defaults.allowEditing }
    : {}),
  ...((override?.allowMoving ?? defaults.allowMoving) !== undefined
    ? { allowMoving: override?.allowMoving ?? defaults.allowMoving }
    : {}),
  ...((override?.pageInteractionWithSelect ?? defaults.pageInteractionWithSelect) !== undefined
    ? { pageInteractionWithSelect: override?.pageInteractionWithSelect ?? defaults.pageInteractionWithSelect } : {}),
  ...((override?.pageInteractionWithHand ?? defaults.pageInteractionWithHand) !== undefined
    ? { pageInteractionWithHand: override?.pageInteractionWithHand ?? defaults.pageInteractionWithHand } : {}),
});

export const resolveToolMenuSettingsForId = (
  defaults: Readonly<ToolMenuSettings>,
  overrides: Readonly<ToolMenuSettingsOverrides> | null | undefined,
  menuId: string,
): ToolMenuSettings =>
  resolveToolMenuSettings(
    { ...defaults, ...INDEPENDENT_WORKFLOW_MENU_DEFAULTS[menuId] },
    { ...TOOL_MENU_DEFAULT_OVERRIDES[menuId], ...overrides?.[menuId] },
  );

/**
 * Returns whether a container menu should remain open because it or one of
 * its currently contained child menus is pinned. Child IDs are supplied by
 * the caller so containers can change their contents without another source
 * of menu-setting truth.
 */
export const isContainerMenuPinned = (
  defaults: Readonly<ToolMenuSettings>,
  overrides: Readonly<ToolMenuSettingsOverrides> | null | undefined,
  containerId: string,
  childMenuIds: readonly string[] = [],
): boolean => {
  if (resolveToolMenuSettingsForId(defaults, overrides, containerId).alwaysOnTop) {
    return true;
  }

  return childMenuIds.some((childId) =>
    resolveToolMenuSettingsForId(defaults, overrides, childId).alwaysOnTop,
  );
};

/**
 * Returns a new override map with one setting changed for one tool.
 *
 * Passing `undefined` clears that key, returning the tool to the app default.
 * Empty tool override objects are removed as well.
 * Neither the supplied map nor its nested override objects are mutated.
 */
export const updateToolMenuSettingOverride = <
  K extends ToolMenuSettingKey,
>(
  overrides: Readonly<ToolMenuSettingsOverrides> | null | undefined,
  toolId: string,
  key: K,
  value: ToolMenuSettings[K] | undefined,
): ToolMenuSettingsOverrides => {
  const next: ToolMenuSettingsOverrides = Object.fromEntries(
    Object.entries(overrides ?? {}).map(([id, settings]) => [id, { ...settings }]),
  );
  const current = { ...(next[toolId] ?? {}) };

  if (value === undefined) {
    delete current[key];
  } else {
    current[key] = value;
  }

  if (Object.keys(current).length === 0) {
    delete next[toolId];
  } else {
    next[toolId] = current;
  }

  return next;
};
