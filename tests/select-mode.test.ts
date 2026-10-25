import assert from "node:assert/strict";
import test from "node:test";
import {
  SELECT_MODES,
  initialSelectMode,
} from "../src/features/board/select-mode";
import {
  normalizeToolbarLayout,
  getVisibleToolbarItems,
} from "../src/features/toolbar/model";

test("three Select variations replace legacy separate tools while retaining the chosen variation", () => {
  assert.deepEqual(SELECT_MODES, ["rectangle", "lasso", "polygon"]);
  assert.equal(initialSelectMode(undefined, "polygon-select"), "polygon");
  assert.equal(initialSelectMode(undefined, "lasso"), "lasso");
  assert.equal(initialSelectMode("rectangle", "lasso"), "rectangle");
  const layout = normalizeToolbarLayout({
    order: ["select", "lasso", "polygon-select", "more"],
    more: ["lasso", "polygon-select"],
  });
  for (const id of ["lasso", "polygon-select"]) {
    assert.ok(!layout.order.includes(id as any));
    assert.ok(!layout.more.includes(id as any));
  }
  assert.ok(getVisibleToolbarItems(layout).includes("select"));
});
