import assert from "node:assert/strict";
import test from "node:test";

import {
  findShortcutConflict,
  isSafeStructuralShortcut,
  normalizeShortcut,
  normalizeShortcutKey,
  shouldHandleSpreadsheetKeyboard,
  shortcutFromEvent,
  shortcutMatchesEvent,
} from "../src/features/shortcuts/model.ts";

test("shortcuts are normalized into a stable modifier order", () => {
  assert.equal(normalizeShortcut("shift + ctrl + a"), "Ctrl+Shift+A");
  assert.equal(normalizeShortcut("control+alt+arrowdown"), "Ctrl+Alt+ArrowDown");
  assert.equal(normalizeShortcut("  "), "");
});

test("keyboard events can be recorded and matched consistently", () => {
  const event = {
    key: "d",
    ctrlKey: true,
    altKey: false,
    shiftKey: true,
    metaKey: false,
  };

  assert.equal(shortcutFromEvent(event), "Ctrl+Shift+D");
  assert.equal(shortcutMatchesEvent("shift+ctrl+d", event), true);
  assert.equal(shortcutMatchesEvent("Ctrl+D", event), false);
});

test("shortcut conflicts ignore disabled bindings and report the existing command", () => {
  const conflict = findShortcutConflict("Ctrl+Shift+D", [
    { commandId: "sheet.add-row", shortcut: "ctrl+shift+d", enabled: true },
    { commandId: "sheet.fill-down", shortcut: "Ctrl+D", enabled: false },
  ]);

  assert.equal(conflict?.commandId, "sheet.add-row");
  assert.equal(
    findShortcutConflict("Ctrl+D", [
      { commandId: "sheet.fill-down", shortcut: "Ctrl+D", enabled: false },
    ]),
    undefined,
  );
});

test("shortcut normalization covers function keys, modifier-only events and aliases", () => {
  assert.equal(normalizeShortcutKey(""), "");
  assert.equal(normalizeShortcutKey(" "), "Space");
  assert.equal(normalizeShortcutKey("option"), "Alt");
  assert.equal(normalizeShortcutKey("f12"), "F12");
  assert.equal(normalizeShortcutKey("PAGEUP"), "PageUp");
  assert.equal(normalizeShortcutKey("insert"), "Insert");
  assert.equal(
    shortcutFromEvent({ key: "Meta", altKey: true, metaKey: true }),
    "Alt+Meta",
  );
  assert.equal(shortcutMatchesEvent("", { key: "a" }), false);
  assert.equal(findShortcutConflict("", []), undefined);
});

test("spreadsheet navigation stays active only while its selected cell owns focus", () => {
  assert.equal(shouldHandleSpreadsheetKeyboard(false, false), true);
  assert.equal(shouldHandleSpreadsheetKeyboard(true, true), true);
  assert.equal(shouldHandleSpreadsheetKeyboard(true, false), false);
});

test("structural shortcuts require a strong modifier and reject typing keys", () => {
  assert.equal(isSafeStructuralShortcut("A"), false);
  assert.equal(isSafeStructuralShortcut("Shift+A"), false);
  assert.equal(isSafeStructuralShortcut("Enter"), false);
  assert.equal(isSafeStructuralShortcut("ArrowRight"), false);
  assert.equal(isSafeStructuralShortcut("Ctrl+Shift+A"), true);
  assert.equal(isSafeStructuralShortcut("Alt+Shift+ArrowDown"), true);
  assert.equal(isSafeStructuralShortcut("Meta+K"), true);
});
