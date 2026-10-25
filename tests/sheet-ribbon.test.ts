import assert from "node:assert/strict";
import test from "node:test";
import { clearStaleSheetRibbonNodes } from "../src/features/spreadsheet/sheet-ribbon";

test("a new spreadsheet iframe removes only owned stale ribbon nodes", () => {
  const removed: string[] = [];
  const owned = ["style", "layout", "mount"].map(kind => ({
    remove: () => removed.push(kind),
  }));
  clearStaleSheetRibbonNodes({
    querySelectorAll: selector => {
      assert.equal(
        selector,
        "[data-sheet-ribbon-style], [data-sheet-ribbon-layout], [data-sheet-ribbon-mount]",
      );
      return owned as unknown as NodeListOf<Element>;
    },
  } as unknown as ShadowRoot);
  assert.deepEqual(removed, ["style", "layout", "mount"]);
});
