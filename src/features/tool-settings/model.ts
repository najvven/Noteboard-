/**
 * The three settings shared by tool menus.
 *
 * `keepToolActive: true` is the Fixed tool mode; `false` is Unfixed.
 * `previewMode: "box"` is the Translucent preview; `"realistic"` is True.
 */
export interface ToolMenuSettings {
  alwaysOnTop: boolean;
  keepToolActive: boolean;
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

/**
 * Object-picking workflows need to remain available while the user clicks the
 * board, so they intentionally own defaults instead of inheriting Global Tool
 * Settings. Explicit per-workflow overrides still win.
 */
export const INDEPENDENT_WORKFLOW_MENU_DEFAULTS: Readonly<
  Record<string, ToolMenuSettings>
> = {
  link: {
    alwaysOnTop: true,
    keepToolActive: true,
    previewMode: "box",
  },
  "object-presets": {
    alwaysOnTop: true,
    keepToolActive: true,
    previewMode: "box",
  },
};

/** Creation tools can have safe, tool-specific transform defaults. */
export const TOOL_MENU_DEFAULT_OVERRIDES: Readonly<
  Record<string, ToolMenuSettingsOverride>
> = {
  text: { allowEditing: true, allowMoving: true },
};

/**
 * Resolves a tool's effective settings without mutating either input object.
 * An override is intentionally sparse so later global changes remain visible
 * for every setting the tool has not changed itself.
 */
export const resolveToolMenuSettings = (
  global: Readonly<ToolMenuSettings>,
  override?: Readonly<ToolMenuSettingsOverride> | null,
): ToolMenuSettings => ({
  alwaysOnTop: override?.alwaysOnTop ?? global.alwaysOnTop,
  keepToolActive: override?.keepToolActive ?? global.keepToolActive,
  previewMode: override?.previewMode ?? global.previewMode,
  ...((override?.allowEditing ?? global.allowEditing) !== undefined
    ? { allowEditing: override?.allowEditing ?? global.allowEditing }
    : {}),
  ...((override?.allowMoving ?? global.allowMoving) !== undefined
    ? { allowMoving: override?.allowMoving ?? global.allowMoving }
    : {}),
  ...((override?.pageInteractionWithSelect ?? global.pageInteractionWithSelect) !== undefined
    ? { pageInteractionWithSelect: override?.pageInteractionWithSelect ?? global.pageInteractionWithSelect } : {}),
  ...((override?.pageInteractionWithHand ?? global.pageInteractionWithHand) !== undefined
    ? { pageInteractionWithHand: override?.pageInteractionWithHand ?? global.pageInteractionWithHand } : {}),
});

export const resolveToolMenuSettingsForId = (
  global: Readonly<ToolMenuSettings>,
  overrides: Readonly<ToolMenuSettingsOverrides> | null | undefined,
  menuId: string,
): ToolMenuSettings =>
  resolveToolMenuSettings(
    INDEPENDENT_WORKFLOW_MENU_DEFAULTS[menuId] ?? global,
    { ...TOOL_MENU_DEFAULT_OVERRIDES[menuId], ...overrides?.[menuId] },
  );

/**
 * Returns whether a container menu should remain open because it or one of
 * its currently contained child menus is pinned. Child IDs are supplied by
 * the caller so containers can change their contents without another source
 * of menu-setting truth.
 */
export const isContainerMenuPinned = (
  global: Readonly<ToolMenuSettings>,
  overrides: Readonly<ToolMenuSettingsOverrides> | null | undefined,
  containerId: string,
  childMenuIds: readonly string[] = [],
): boolean => {
  if (resolveToolMenuSettings(global, overrides?.[containerId]).alwaysOnTop) {
    return true;
  }

  return childMenuIds.some((childId) =>
    resolveToolMenuSettings(global, overrides?.[childId]).alwaysOnTop,
  );
};

/**
 * Returns a new override map with one setting changed for one tool.
 *
 * Passing `undefined` clears that key, returning the tool to global
 * inheritance for it. Empty tool override objects are removed as well.
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
