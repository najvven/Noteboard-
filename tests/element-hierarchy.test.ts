import assert from "node:assert/strict";
import test from "node:test";

import type { BoardElement } from "../src/types";
import { createElementHierarchy } from "../src/features/board/element-hierarchy";

const element = (
  id: string,
  parentId?: string,
  values: Partial<BoardElement> = {},
): BoardElement => ({
  id,
  type: "section",
  position: { x: 0, y: 0 },
  content: "",
  zIndex: 1,
  parentId,
  ...values,
});

test("element hierarchy indexes ancestry, visibility and locks once", () => {
  const elements = [
    element("root", undefined, { zIndex: 2, isHidden: true }),
    element("child", "root", { zIndex: 3 }),
    element("grandchild", "child", { zIndex: 4, isLocked: true }),
  ];
  const hierarchy = createElementHierarchy(elements);

  assert.equal(hierarchy.isDescendantOf("grandchild", "root"), true);
  assert.equal(hierarchy.isVisible("grandchild", true), false);
  assert.equal(hierarchy.isLocked("grandchild"), true);
  assert.deepEqual(hierarchy.stackPath("grandchild"), [2, 3, 4]);
});

test("element hierarchy terminates defensively if given a cycle", () => {
  const hierarchy = createElementHierarchy([
    element("a", "b"),
    element("b", "a"),
  ]);

  assert.doesNotThrow(() => hierarchy.stackPath("a"));
  assert.equal(hierarchy.isDescendantOf("a", "missing"), false);
});
