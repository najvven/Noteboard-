import assert from "node:assert/strict";
import test from "node:test";

import {
  INDEPENDENT_WORKFLOW_MENU_DEFAULTS,
  isContainerMenuPinned,
  resolveToolMenuSettings,
  resolveToolMenuSettingsForId,
  updateToolMenuSettingOverride,
  type ToolMenuSettings,
  type ToolMenuSettingsOverrides,
} from "../src/features/tool-settings/model.ts";

const globalSettings: ToolMenuSettings = {
  alwaysOnTop: false,
  keepToolActive: true,
  previewMode: "box",
};

test("a tool with no override inherits every global setting", () => {
  assert.deepEqual(resolveToolMenuSettings(globalSettings), globalSettings);
  assert.deepEqual(
    resolveToolMenuSettings({ ...globalSettings, previewMode: "realistic" }),
    { alwaysOnTop: false, keepToolActive: true, previewMode: "realistic" },
  );
});

test("resolving settings does not mutate global or override inputs", () => {
  const globalSnapshot = structuredClone(globalSettings);
  const override = { keepToolActive: false };
  const overrideSnapshot = structuredClone(override);

  const resolved = resolveToolMenuSettings(globalSettings, override);

  assert.notStrictEqual(resolved, globalSettings);
  assert.notStrictEqual(resolved, override);
  assert.deepEqual(globalSettings, globalSnapshot);
  assert.deepEqual(override, overrideSnapshot);
});

test("an absent override follows later global changes", () => {
  const overrides: ToolMenuSettingsOverrides = {};
  const before = resolveToolMenuSettings(globalSettings, overrides.text);
  const after = resolveToolMenuSettings(
    { alwaysOnTop: true, keepToolActive: false, previewMode: "realistic" },
    overrides.text,
  );

  assert.deepEqual(before, globalSettings);
  assert.deepEqual(after, {
    alwaysOnTop: true,
    keepToolActive: false,
    previewMode: "realistic",
  });
});

test("overriding one setting leaves the other settings inherited", () => {
  const overrides: ToolMenuSettingsOverrides = updateToolMenuSettingOverride(
    {},
    "media",
    "previewMode",
    "realistic",
  );
  const mediaOverride: ToolMenuSettingsOverrides["media"] = overrides.media;

  assert.deepEqual(overrides, { media: { previewMode: "realistic" } });
  assert.deepEqual(resolveToolMenuSettings(globalSettings, mediaOverride), {
    alwaysOnTop: false,
    keepToolActive: true,
    previewMode: "realistic",
  });

  const changedGlobal = {
    alwaysOnTop: true,
    keepToolActive: false,
    previewMode: "box" as const,
  };
  assert.deepEqual(resolveToolMenuSettings(changedGlobal, mediaOverride), {
    alwaysOnTop: true,
    keepToolActive: false,
    previewMode: "realistic",
  });
});

test("different tools keep independent sparse overrides", () => {
  let overrides = updateToolMenuSettingOverride(
    {},
    "text",
    "keepToolActive",
    false,
  );
  overrides = updateToolMenuSettingOverride(
    overrides,
    "media",
    "alwaysOnTop",
    true,
  );

  assert.deepEqual(resolveToolMenuSettings(globalSettings, overrides.text), {
    alwaysOnTop: false,
    keepToolActive: false,
    previewMode: "box",
  });
  assert.deepEqual(resolveToolMenuSettings(globalSettings, overrides.media), {
    alwaysOnTop: true,
    keepToolActive: true,
    previewMode: "box",
  });
});

test("object-picking workflows use switchable defaults independent of global settings", () => {
  for (const menuId of ["link", "object-presets"]) {
    assert.equal(INDEPENDENT_WORKFLOW_MENU_DEFAULTS[menuId].alwaysOnTop, true);
    assert.equal(
      resolveToolMenuSettingsForId(globalSettings, {}, menuId).alwaysOnTop,
      true,
    );
    assert.equal(
      resolveToolMenuSettingsForId(
        { ...globalSettings, alwaysOnTop: false, previewMode: "realistic" },
        { [menuId]: { alwaysOnTop: false } },
        menuId,
      ).alwaysOnTop,
      false,
    );
  }
});

test("a container with a globally disabled pin is not pinned by default", () => {
  assert.equal(
    isContainerMenuPinned(globalSettings, {}, "more", ["media", "eraser"]),
    false,
  );
});

test("a container override pins the container", () => {
  const overrides = updateToolMenuSettingOverride(
    {},
    "more",
    "alwaysOnTop",
    true,
  );

  assert.equal(
    isContainerMenuPinned(globalSettings, overrides, "more", ["media"]),
    true,
  );
});

test("a pinned child keeps its container open", () => {
  const overrides = updateToolMenuSettingOverride(
    {},
    "dynamic-child-42",
    "alwaysOnTop",
    true,
  );

  assert.equal(
    isContainerMenuPinned(globalSettings, overrides, "more", [
      "dynamic-child-42",
    ]),
    true,
  );
});

test("containers and dynamic children inherit a globally enabled pin", () => {
  const global = { ...globalSettings, alwaysOnTop: true };

  assert.equal(
    isContainerMenuPinned(global, {}, "dynamic-container", [
      "dynamic-child-a",
      "dynamic-child-b",
    ]),
    true,
  );
});

test("a pinned tool outside the container does not affect it", () => {
  const overrides = updateToolMenuSettingOverride(
    {},
    "unrelated-tool",
    "alwaysOnTop",
    true,
  );

  assert.equal(
    isContainerMenuPinned(globalSettings, overrides, "more", ["media"]),
    false,
  );
});

test("updates and clearing overrides do not mutate the input map", () => {
  const original: ToolMenuSettingsOverrides = {
    text: { keepToolActive: false, previewMode: "realistic" },
    media: { alwaysOnTop: true },
  };
  const snapshot = structuredClone(original);

  const changed = updateToolMenuSettingOverride(
    original,
    "text",
    "alwaysOnTop",
    true,
  );
  assert.deepEqual(original, snapshot);
  assert.notStrictEqual(changed, original);
  assert.notStrictEqual(changed.text, original.text);

  const cleared = updateToolMenuSettingOverride(
    changed,
    "text",
    "previewMode",
    undefined,
  );
  assert.deepEqual(cleared, {
    text: { keepToolActive: false, alwaysOnTop: true },
    media: { alwaysOnTop: true },
  });

  const onlyOverride = updateToolMenuSettingOverride(
    {},
    "media",
    "alwaysOnTop",
    true,
  );
  assert.deepEqual(
    updateToolMenuSettingOverride(onlyOverride, "media", "alwaysOnTop", undefined),
    {},
  );
});
