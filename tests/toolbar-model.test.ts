import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_TOOLBAR_LAYOUT,
  GENERAL_SETTINGS_SECTION_IDS,
  GENERAL_SETTINGS_TOOLBAR_ITEM_IDS,
  TOOLBAR_ITEM_IDS,
  canMoveToolbarItemToMore,
  chooseToolbarReturnSlot,
  evaluateToolbarReorderPreview,
  getGeneralSettingsSections,
  getSettingsSectionLocation,
  getVisibleToolbarItems,
  moveSettingsSection,
  normalizeToolbarLayout,
} from "../src/features/toolbar/model.ts";

const DEFAULT_MORE_TOOL_IDS = [
  "embed",
  "board",
  "link",
  "object-presets",
] as const;

test("the default toolbar keeps every composite tool and its controls visible", () => {
  assert.deepEqual(DEFAULT_TOOLBAR_LAYOUT.order, [
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
    ...DEFAULT_MORE_TOOL_IDS,
    "more",
    "grid",
    "layers",
    "save",
  ]);
  assert.deepEqual(DEFAULT_TOOLBAR_LAYOUT.more, DEFAULT_MORE_TOOL_IDS);
  assert.deepEqual(
    DEFAULT_TOOLBAR_LAYOUT.general,
    GENERAL_SETTINGS_SECTION_IDS,
  );
  assert.deepEqual(getVisibleToolbarItems(DEFAULT_TOOLBAR_LAYOUT), [
    "generalSettings",
    "zoom",
    "select",
    "pan",
    "text",
    "shapes",
    "media",
    "draw",
    "fill",
    "eraser",
    "more",
    "layers",
    "save",
  ]);
  assert.equal(new Set(DEFAULT_TOOLBAR_LAYOUT.order).size, TOOLBAR_ITEM_IDS.length);
});

test("general settings sections are fixed in General Settings", () => {
  for (const id of GENERAL_SETTINGS_TOOLBAR_ITEM_IDS) {
    assert.equal(canMoveToolbarItemToMore(id), false);
    assert.equal(DEFAULT_TOOLBAR_LAYOUT.order.includes(id), true);
    assert.equal(DEFAULT_TOOLBAR_LAYOUT.general.includes(id), true);
    assert.equal(DEFAULT_TOOLBAR_LAYOUT.more.includes(id), false);
    assert.equal(getVisibleToolbarItems(DEFAULT_TOOLBAR_LAYOUT).includes(id), false);
  }
});

test("toolbar normalization removes invalid duplicates without mutating persisted input", () => {
  const persisted = {
    order: ["select", "select", "unknown", "more", "grid"],
    more: ["eraser", "fill", "fill", "select", "media", "grid"],
    slots: { select: -3, grid: 4.4, unknown: 2 },
  };
  const snapshot = structuredClone(persisted);

  const normalized = normalizeToolbarLayout(persisted);

  assert.deepEqual(persisted, snapshot);
  assert.deepEqual(normalized.order.slice(0, 3), ["select", "more", "grid"]);
  assert.equal(new Set(normalized.order).size, TOOLBAR_ITEM_IDS.length);
  assert.deepEqual(normalized.more, [
    ...DEFAULT_MORE_TOOL_IDS,
    "eraser",
    "fill",
    "select",
    "media",
  ]);
  assert.deepEqual(normalized.general, GENERAL_SETTINGS_SECTION_IDS);
  assert.deepEqual(normalized.slots, { select: 0, grid: 4 });
});

test("board settings stay fixed in General Settings", () => {
  assert.equal(canMoveToolbarItemToMore("grid"), false);

  const movedToMore = normalizeToolbarLayout({
    order: [...TOOLBAR_ITEM_IDS],
    more: ["grid"],
  });

  assert.deepEqual(movedToMore.more, []);
  assert.equal(movedToMore.general.includes("grid"), true);
  assert.equal(getVisibleToolbarItems(movedToMore).includes("grid"), false);

  const restoredToToolbar = normalizeToolbarLayout({
    order: movedToMore.order,
    more: [],
  });

  assert.deepEqual(restoredToToolbar.more, []);
  assert.equal(getVisibleToolbarItems(restoredToToolbar).includes("grid"), false);
  assert.equal(
    restoredToToolbar.order.indexOf("grid"),
    DEFAULT_TOOLBAR_LAYOUT.order.indexOf("grid"),
  );
});

test("legacy layouts migrate toolbar settings sections into General Settings", () => {
  const legacy = normalizeToolbarLayout({
    order: [
      "generalSettings",
      "zoom",
      "select",
      "pan",
      "text",
      "shapes",
      "media",
      "draw",
      "fill",
      "eraser",
      "more",
      "grid",
      "layers",
      "save",
    ],
    more: [],
  });

  assert.deepEqual(legacy.more, DEFAULT_MORE_TOOL_IDS);
  assert.deepEqual(legacy.general, GENERAL_SETTINGS_SECTION_IDS);
  assert.deepEqual(
    getVisibleToolbarItems(legacy),
    getVisibleToolbarItems(DEFAULT_TOOLBAR_LAYOUT),
  );
});

test("legacy settings sections in More normalize back to General Settings", () => {
  const normalized = normalizeToolbarLayout({
    order: [...TOOLBAR_ITEM_IDS],
    more: [
      "select",
      ...GENERAL_SETTINGS_TOOLBAR_ITEM_IDS,
      "pan",
      "text",
    ],
  });

  assert.deepEqual(normalized.general, GENERAL_SETTINGS_SECTION_IDS);
  assert.deepEqual(normalized.more, ["select", "pan", "text"]);
  for (const id of GENERAL_SETTINGS_SECTION_IDS) {
    assert.equal(getSettingsSectionLocation(normalized, id), "general");
    assert.equal(getVisibleToolbarItems(normalized).includes(id), false);
  }
});

test("partial legacy layouts still migrate every settings section into General Settings", () => {
  const normalized = normalizeToolbarLayout({
    order: [
      "generalSettings",
      "toolDefaults",
      "zoom",
      "more",
      "grid",
      "layers",
      "save",
    ],
    more: ["presetSettings"],
  });

  assert.deepEqual(normalized.more, DEFAULT_MORE_TOOL_IDS);
  assert.deepEqual(normalized.general, GENERAL_SETTINGS_SECTION_IDS);
  assert.equal(getVisibleToolbarItems(normalized).includes("toolDefaults"), false);
  assert.equal(getVisibleToolbarItems(normalized).includes("presetSettings"), false);
  assert.equal(getVisibleToolbarItems(normalized).includes("behaviorSettings"), false);
  assert.equal(getVisibleToolbarItems(normalized).includes("shortcutSettings"), false);
});

test("an explicit empty General list cannot detach settings sections", () => {
  const current = normalizeToolbarLayout({
    order: [...TOOLBAR_ITEM_IDS],
    more: [],
    general: [],
  });

  assert.deepEqual(current.more, []);
  assert.deepEqual(current.general, GENERAL_SETTINGS_SECTION_IDS);
  assert.deepEqual(
    getVisibleToolbarItems(current).filter((id) =>
      GENERAL_SETTINGS_TOOLBAR_ITEM_IDS.includes(
        id as (typeof GENERAL_SETTINGS_TOOLBAR_ITEM_IDS)[number],
      ),
    ),
    [],
  );
});

test("new section IDs are normalized uniquely with other toolbar IDs", () => {
  const normalized = normalizeToolbarLayout({
    order: [
      "toolDefaults",
      "toolDefaults",
      "shortcutSettings",
      "shortcutSettings",
      "unknown",
    ],
    more: [
      "presetSettings",
      "presetSettings",
      "behaviorSettings",
      "behaviorSettings",
      "not-a-toolbar-item",
    ],
  });

  assert.equal(normalized.order.filter((id) => id === "toolDefaults").length, 1);
  assert.equal(normalized.order.filter((id) => id === "shortcutSettings").length, 1);
  assert.deepEqual(normalized.more, DEFAULT_MORE_TOOL_IDS);
  assert.deepEqual(normalized.general, GENERAL_SETTINGS_SECTION_IDS);
  assert.equal(new Set(normalized.order).size, TOOLBAR_ITEM_IDS.length);
});

test("ordinary toolbar tools can enter More with their slots preserved", () => {
  for (const id of [
    "select",
    "pan",
    "text",
    "shapes",
    "media",
    "draw",
    "fill",
    "eraser",
  ] as const) {
    assert.equal(canMoveToolbarItemToMore(id), true);
  }
  for (const id of [
    "generalSettings",
    "grid",
    "toolDefaults",
    "presetSettings",
    "behaviorSettings",
    "shortcutSettings",
    "zoom",
    "more",
    "layers",
    "save",
  ] as const) {
    assert.equal(canMoveToolbarItemToMore(id), false);
  }

  const normalized = normalizeToolbarLayout({
    order: [
      ...TOOLBAR_ITEM_IDS.filter((id) => id !== "fill"),
      "fill",
    ],
    more: ["select", "pan", "text", "shapes", "draw", "fill"],
    slots: { fill: 99, text: 3 },
  });

  assert.deepEqual(normalized.more, [
    "select",
    "pan",
    "text",
    "shapes",
    "draw",
    "fill",
  ]);
  assert.deepEqual(normalized.slots, { fill: 99, text: 3 });
  assert.deepEqual(
    getVisibleToolbarItems(normalized).filter((id) =>
      ["select", "pan", "text", "shapes", "draw", "fill"].includes(id),
    ),
    [],
  );
});

test("built-in More tools can return to the toolbar and migrate from legacy layouts", () => {
  for (const id of DEFAULT_MORE_TOOL_IDS) {
    assert.equal(canMoveToolbarItemToMore(id), true);
  }

  const legacy = normalizeToolbarLayout({
    order: ["generalSettings", "zoom", "select", "more", "layers", "save"],
    more: [],
  });
  assert.deepEqual(legacy.more, DEFAULT_MORE_TOOL_IDS);

  const withWebOnToolbar = normalizeToolbarLayout({
    order: [...TOOLBAR_ITEM_IDS],
    more: DEFAULT_MORE_TOOL_IDS.filter((id) => id !== "embed"),
  });
  assert.equal(withWebOnToolbar.more.includes("embed"), false);
  assert.equal(getVisibleToolbarItems(withWebOnToolbar).includes("embed"), true);
});

test("an explicitly saved empty overflow is preserved", () => {
  const normalized = normalizeToolbarLayout({
    order: [...TOOLBAR_ITEM_IDS],
    more: [],
  });

  assert.deepEqual(normalized.more, []);
});

test("settings sections resolve to exactly one fixed location", () => {
  const normalized = normalizeToolbarLayout({
    order: ["generalSettings", "grid", "toolDefaults", "more"],
    more: ["grid", "presetSettings", "text", "presetSettings"],
    general: [
      "grid",
      "toolDefaults",
      "grid",
      "behaviorSettings",
      "behaviorSettings",
    ],
  });

  assert.deepEqual(normalized.general, GENERAL_SETTINGS_SECTION_IDS);
  assert.deepEqual(normalized.more, [...DEFAULT_MORE_TOOL_IDS, "text"]);
  assert.deepEqual(
    GENERAL_SETTINGS_SECTION_IDS.map((id) => getSettingsSectionLocation(normalized, id)),
    ["general", "general", "general", "general", "general"],
  );
  for (const id of GENERAL_SETTINGS_SECTION_IDS) {
    const locationCount = [
      normalized.general.includes(id),
      normalized.more.includes(id),
      getVisibleToolbarItems(normalized).includes(id),
    ].filter(Boolean).length;
    assert.equal(locationCount, 1, id + " should have one location");
  }
});

test("legacy settings placement moves keep sections fixed in General Settings", () => {
  const initial = normalizeToolbarLayout({
    order: [
      "generalSettings",
      "grid",
      "toolDefaults",
      "zoom",
      "more",
      "layers",
      "save",
    ],
    more: ["text"],
    general: ["toolDefaults", "grid", "presetSettings"],
    slots: { grid: 7, toolDefaults: 3, select: 2 },
  });
  const snapshot = structuredClone(initial);

  const movedToMore = moveSettingsSection(initial, "grid", "more");

  assert.deepEqual(initial, snapshot);
  assert.deepEqual(movedToMore.general, GENERAL_SETTINGS_SECTION_IDS);
  assert.deepEqual(movedToMore.more, [...DEFAULT_MORE_TOOL_IDS, "text"]);
  assert.equal(getSettingsSectionLocation(movedToMore, "grid"), "general");
  assert.deepEqual(movedToMore.order, initial.order);
  assert.deepEqual(movedToMore.slots, initial.slots);

  const movedToGeneral = moveSettingsSection(movedToMore, "grid", "general");

  assert.deepEqual(movedToGeneral.general, GENERAL_SETTINGS_SECTION_IDS);
  assert.deepEqual(movedToGeneral.more, [...DEFAULT_MORE_TOOL_IDS, "text"]);
  assert.equal(getSettingsSectionLocation(movedToGeneral, "grid"), "general");

  const restoredToToolbar = moveSettingsSection(
    movedToGeneral,
    "grid",
    "toolbar",
  );

  assert.deepEqual(restoredToToolbar.general, GENERAL_SETTINGS_SECTION_IDS);
  assert.deepEqual(restoredToToolbar.more, [...DEFAULT_MORE_TOOL_IDS, "text"]);
  assert.equal(getSettingsSectionLocation(restoredToToolbar, "grid"), "general");
  assert.equal(getVisibleToolbarItems(restoredToToolbar).includes("grid"), false);
  assert.deepEqual(restoredToToolbar.order, initial.order);
  assert.deepEqual(restoredToToolbar.slots, initial.slots);
});

test("General Settings readers return ordered copies without mutating the layout", () => {
  const layout = normalizeToolbarLayout();
  const sections = getGeneralSettingsSections(layout);

  sections.reverse();

  assert.deepEqual(layout.general, GENERAL_SETTINGS_SECTION_IDS);
  assert.deepEqual(getGeneralSettingsSections(layout), GENERAL_SETTINGS_SECTION_IDS);
});

test("toolbar reorder preview waits for adjacent crossing dwell", () => {
  const pending = evaluateToolbarReorderPreview({
    pointerSlot: 5.4,
    currentStart: 4,
    itemSlots: 1,
    targetStart: 5,
    pendingSince: null,
    now: 100,
  });
  assert.equal(pending.shouldPreview, false);
  assert.equal(pending.pendingSince, 100);

  const held = evaluateToolbarReorderPreview({
    pointerSlot: 5.4,
    currentStart: 4,
    itemSlots: 1,
    targetStart: 5,
    pendingSince: pending.pendingSince,
    now: 150,
  });
  assert.equal(held.shouldPreview, false);

  const crossed = evaluateToolbarReorderPreview({
    pointerSlot: 5.4,
    currentStart: 4,
    itemSlots: 1,
    targetStart: 5,
    pendingSince: held.pendingSince,
    now: 200,
  });
  assert.equal(crossed.shouldPreview, true);
  assert.equal(crossed.pendingSince, null);
});

test("toolbar reorder preview allows deliberate multi-slot jumps immediately", () => {
  const result = evaluateToolbarReorderPreview({
    pointerSlot: 9,
    currentStart: 2,
    itemSlots: 2,
    targetStart: 7,
    pendingSince: null,
    now: 50,
  });
  assert.deepEqual(result, { shouldPreview: true, pendingSince: null });
});

test("returning a tool chooses the roomier toolbar edge", () => {
  assert.deepEqual(
    chooseToolbarReturnSlot({
      slotCount: 16,
      itemSlots: 2,
      occupiedSlots: [
        { start: 2, span: 2 },
        { start: 4, span: 4 },
        { start: 8, span: 2 },
      ],
    }),
    { side: "right", slot: 14 },
  );

  assert.deepEqual(
    chooseToolbarReturnSlot({
      slotCount: 16,
      itemSlots: 2,
      occupiedSlots: [
        { start: 6, span: 2 },
        { start: 8, span: 4 },
        { start: 12, span: 2 },
      ],
    }),
    { side: "left", slot: 0 },
  );
});

test("returning a tool resolves equal edge gaps deterministically", () => {
  assert.deepEqual(
    chooseToolbarReturnSlot({
      slotCount: 12,
      itemSlots: 2,
      occupiedSlots: [{ start: 5, span: 2 }],
    }),
    { side: "left", slot: 0 },
  );
});
