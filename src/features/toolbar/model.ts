export const TOOLBAR_ITEM_IDS = [
  "generalSettings",
  "toolDefaults",
  "presetSettings",
  "behaviorSettings",
  "shortcutSettings",
  "zoom",
  "select",
  "pan",
  "text",
  "shapes",
  "media",
  "draw",
  "fill",
  "eraser",
  "embed",
  "board",
  "link",
  "object-presets",
  "table",
  "more",
  "grid",
  "layers",
  "save",
] as const;

export type ToolbarItemId = (typeof TOOLBAR_ITEM_IDS)[number];

/**
 * Settings sections are fixed in the General Settings surface. Keep this
 * list separate from generalSettings: that item opens the surface, while
 * these IDs identify the sections rendered inside it.
 */
export const GENERAL_SETTINGS_SECTION_IDS = [
  "grid",
  "toolDefaults",
  "presetSettings",
  "behaviorSettings",
  "shortcutSettings",
] as const satisfies readonly ToolbarItemId[];

export type GeneralSettingsSectionId =
  (typeof GENERAL_SETTINGS_SECTION_IDS)[number];

/** Backwards-compatible name used by the toolbar renderer. */
export const GENERAL_SETTINGS_TOOLBAR_ITEM_IDS = GENERAL_SETTINGS_SECTION_IDS;

export interface ToolbarLayout {
  order: ToolbarItemId[];
  more: ToolbarItemId[];
  /**
   * Canonical General Settings order. Every settings section is normalized
   * into this list and is hidden from the toolbar.
   */
  general: GeneralSettingsSectionId[];
  slots?: Partial<Record<ToolbarItemId, number>>;
}

export type SettingsSectionLocation = "general" | "toolbar" | "more";

export const BUILT_IN_MORE_TOOL_IDS = [
  "embed",
  "board",
  "link",
  "object-presets",
  "table",
] as const satisfies readonly ToolbarItemId[];

export const TOOLBAR_OVERFLOW_ITEM_IDS = [
  ...BUILT_IN_MORE_TOOL_IDS,
  "select",
  "pan",
  "text",
  "shapes",
  "media",
  "draw",
  "fill",
  "eraser",
] as const satisfies readonly ToolbarItemId[];

const TOOLBAR_OVERFLOW_ITEM_SET = new Set<ToolbarItemId>(
  TOOLBAR_OVERFLOW_ITEM_IDS,
);

export const canMoveToolbarItemToMore = (id: ToolbarItemId) =>
  TOOLBAR_OVERFLOW_ITEM_SET.has(id);

export interface ToolbarOccupiedSlot {
  start: number;
  span: number;
}

export interface ToolbarReturnSlotResult {
  side: "left" | "right";
  slot: number;
}

/**
 * Choose the edge position used when a tool is returned from More.
 *
 * The returned item belongs at the furthest free edge, not at an arbitrary
 * insertion point. Prefer the edge with more available space; ties resolve to
 * the left edge so repeated returns stay deterministic. Internal gaps are
 * considered only when neither edge can fit the item.
 */
export const chooseToolbarReturnSlot = ({
  slotCount,
  itemSlots,
  occupiedSlots,
}: {
  slotCount: number;
  itemSlots: number;
  occupiedSlots: readonly ToolbarOccupiedSlot[];
}): ToolbarReturnSlotResult => {
  const safeSlotCount = Math.max(0, Math.floor(slotCount));
  const safeSpan = Math.max(1, Math.floor(itemSlots));
  const intervals = occupiedSlots
    .filter(
      (entry) =>
        Number.isFinite(entry.start) &&
        Number.isFinite(entry.span) &&
        entry.span > 0,
    )
    .map((entry) => ({
      start: Math.max(0, Math.min(safeSlotCount, Math.floor(entry.start))),
      end: Math.max(
        0,
        Math.min(safeSlotCount, Math.ceil(entry.start + entry.span)),
      ),
    }))
    .filter((entry) => entry.end > entry.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const merged: Array<{ start: number; end: number }> = [];
  intervals.forEach((interval) => {
    const previous = merged[merged.length - 1];
    if (!previous || interval.start > previous.end) {
      merged.push({ ...interval });
      return;
    }
    previous.end = Math.max(previous.end, interval.end);
  });

  const gaps: Array<{ start: number; end: number }> = [];
  let cursor = 0;
  merged.forEach((interval) => {
    if (interval.start > cursor) gaps.push({ start: cursor, end: interval.start });
    cursor = Math.max(cursor, interval.end);
  });
  if (cursor < safeSlotCount) gaps.push({ start: cursor, end: safeSlotCount });

  const leftGap = gaps.find((gap) => gap.start === 0) ?? null;
  const lastGap = gaps[gaps.length - 1];
  const rightGap = lastGap?.end === safeSlotCount ? lastGap : null;
  const leftEdgeGap = leftGap ? leftGap.end - leftGap.start : 0;
  const rightEdgeGap = rightGap ? rightGap.end - rightGap.start : 0;
  const leftEdge = leftGap && leftEdgeGap >= safeSpan
    ? { side: "left" as const, slot: 0 }
    : null;
  const rightEdge = rightGap && rightEdgeGap >= safeSpan
    ? {
        side: "right" as const,
        slot: safeSlotCount - safeSpan,
      }
    : null;

  if (leftEdge && rightEdge) {
    return rightEdgeGap > leftEdgeGap ? rightEdge : leftEdge;
  }
  if (leftEdge) return leftEdge;
  if (rightEdge) return rightEdge;

  // No edge can fit the item. Use the widest internal gap as a stable
  // fallback; the caller's normal packing step will resolve any remaining
  // capacity pressure without moving the More button unpredictably.
  const internal = gaps
    .filter((gap) => gap.end - gap.start > 0)
    .sort(
      (a, b) =>
        b.end - b.start - (a.end - a.start) || a.start - b.start,
    )[0];
  if (internal) {
    return {
      side: internal.start <= safeSlotCount / 2 ? "left" : "right",
      slot:
        internal.start <= safeSlotCount / 2
          ? internal.start
          : Math.max(internal.start, internal.end - safeSpan),
    };
  }

  return {
    side: "left",
    slot: 0,
  };
};

export interface ToolbarReorderPreviewInput {
  pointerSlot: number;
  currentStart: number;
  itemSlots: number;
  targetStart: number;
  pendingSince: number | null;
  now: number;
  thresholdSlots?: number;
  dwellMs?: number;
}

export interface ToolbarReorderPreviewResult {
  shouldPreview: boolean;
  pendingSince: number | null;
}

/**
 * Keeps adjacent toolbar items stable until the pointer has crossed the
 * item's center plus a small hysteresis band for a short dwell period.
 * Larger jumps are intentional enough to preview immediately.
 */
export const evaluateToolbarReorderPreview = ({
  pointerSlot,
  currentStart,
  itemSlots,
  targetStart,
  pendingSince,
  now,
  thresholdSlots = 0.35,
  dwellMs = 90,
}: ToolbarReorderPreviewInput): ToolbarReorderPreviewResult => {
  if (targetStart === currentStart || !Number.isFinite(pointerSlot)) {
    return { shouldPreview: false, pendingSince: null };
  }

  const direction = targetStart > currentStart ? 1 : -1;
  const center = currentStart + Math.max(1, itemSlots) / 2;
  const threshold = Math.max(0, thresholdSlots);
  const crossed =
    direction > 0
      ? pointerSlot >= center + threshold
      : pointerSlot <= center - threshold;
  if (!crossed) return { shouldPreview: false, pendingSince: null };

  if (Math.abs(targetStart - currentStart) > 1) {
    return { shouldPreview: true, pendingSince: null };
  }

  const nextPendingSince = pendingSince ?? now;
  return {
    shouldPreview: now - nextPendingSince >= Math.max(0, dwellMs),
    pendingSince:
      now - nextPendingSince >= Math.max(0, dwellMs)
        ? null
        : nextPendingSince,
  };
};

const TOOLBAR_ITEM_SET = new Set<ToolbarItemId>(TOOLBAR_ITEM_IDS);

export const DEFAULT_TOOLBAR_LAYOUT: ToolbarLayout = {
  order: [
    "generalSettings",
    ...GENERAL_SETTINGS_SECTION_IDS.filter((id) => id !== "grid"),
    "zoom",
    "select",
    "pan",
    "text",
    "shapes",
    "media",
    "draw",
    "fill",
    "eraser",
    ...BUILT_IN_MORE_TOOL_IDS,
    "more",
    "grid",
    "layers",
    "save",
  ],
  more: [...BUILT_IN_MORE_TOOL_IDS],
  general: [...GENERAL_SETTINGS_SECTION_IDS],
};

const uniqueValidIds = (ids: readonly string[] | undefined) => {
  const seen = new Set<ToolbarItemId>();
  return (ids ?? []).filter((id): id is ToolbarItemId => {
    if (!TOOLBAR_ITEM_SET.has(id as ToolbarItemId) || seen.has(id as ToolbarItemId)) {
      return false;
    }
    seen.add(id as ToolbarItemId);
    return true;
  });
};

export const isGeneralSettingsSection = (
  id: string,
): id is GeneralSettingsSectionId =>
  (GENERAL_SETTINGS_SECTION_IDS as readonly string[]).includes(id);

export interface PersistedToolbarLayout {
  order?: readonly string[];
  more?: readonly string[];
  general?: readonly string[];
  slots?: Readonly<Record<string, number>>;
}

export const normalizeToolbarLayout = (
  layout?: PersistedToolbarLayout,
): ToolbarLayout => {
  if (!layout) {
    return {
      order: [...DEFAULT_TOOLBAR_LAYOUT.order],
      more: [...DEFAULT_TOOLBAR_LAYOUT.more],
      general: [...DEFAULT_TOOLBAR_LAYOUT.general],
    };
  }

  const persistedOrder = uniqueValidIds(layout.order);
  const persistedMore = uniqueValidIds(layout.more);
  const completeOrder = [
    ...persistedOrder,
    ...DEFAULT_TOOLBAR_LAYOUT.order.filter((id) => !persistedOrder.includes(id)),
  ];
  const order = completeOrder;
  const persistedMoreAllowed = persistedMore.filter((id) =>
    canMoveToolbarItemToMore(id),
  );
  // These tools historically lived in a hard-coded More list and therefore
  // do not exist in older persisted layouts. Keep them in More during
  // migration, while respecting an explicit newer layout that returned one
  // of them to the toolbar.
  const missingLegacyMoreTools = DEFAULT_TOOLBAR_LAYOUT.more.filter(
    (id) => !persistedOrder.includes(id) && !persistedMoreAllowed.includes(id),
  );
  const nativeMoreTools = DEFAULT_TOOLBAR_LAYOUT.more.filter(
    (id) => persistedMoreAllowed.includes(id) || missingLegacyMoreTools.includes(id),
  );
  const movedToolbarTools = persistedMoreAllowed.filter(
    (id) => !DEFAULT_TOOLBAR_LAYOUT.more.includes(id),
  );
  const more = [...nativeMoreTools, ...movedToolbarTools];
  // Older layouts represented a section in either More or the toolbar order.
  // General Settings is now the sole location and has one predictable order.
  const general = [...GENERAL_SETTINGS_SECTION_IDS];

  const slots: Partial<Record<ToolbarItemId, number>> = {};

  Object.entries(layout.slots ?? {}).forEach(([id, slot]) => {
    if (
      !TOOLBAR_ITEM_SET.has(id as ToolbarItemId) ||
      !Number.isFinite(slot)
    ) {
      return;
    }
    slots[id as ToolbarItemId] = Math.max(0, Math.round(slot));
  });

  return Object.keys(slots).length > 0
    ? { order, more, general, slots }
    : { order, more, general };
};

export const getVisibleToolbarItems = (
  layout: ToolbarLayout | PersistedToolbarLayout,
) => {
  const normalized = normalizeToolbarLayout(layout);
  const general = new Set<GeneralSettingsSectionId>(normalized.general);
  return normalized.order.filter(
    (id) =>
      !normalized.more.includes(id) &&
      !general.has(id as GeneralSettingsSectionId),
  );
};

/** Return the canonical ordered sections currently shown in General Settings. */
export const getGeneralSettingsSections = (
  layout: ToolbarLayout | PersistedToolbarLayout,
): GeneralSettingsSectionId[] => normalizeToolbarLayout(layout).general;

/** Return the fixed location of a General Settings section. */
export const getSettingsSectionLocation = (
  _layout: ToolbarLayout | PersistedToolbarLayout,
  _sectionId: GeneralSettingsSectionId,
): SettingsSectionLocation => {
  return "general";
};

/**
 * Keep the legacy placement API for shared callers while enforcing the
 * current policy: General Settings sections always remain in General.
 */
export const moveSettingsSection = (
  layout: ToolbarLayout | PersistedToolbarLayout,
  _sectionId: GeneralSettingsSectionId,
  _destination: SettingsSectionLocation,
): ToolbarLayout => {
  return normalizeToolbarLayout(layout);
};

// Descriptive aliases keep call sites readable while retaining one canonical
// implementation for all placement changes.
export const getGeneralSettingsSectionLocation = getSettingsSectionLocation;
export const moveGeneralSettingsSection = moveSettingsSection;
