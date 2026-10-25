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

test("element hierarchy resolves ancestry, visibility, locks and stacking", () => {
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

test("deep hierarchies keep traversal bounded without caching every ancestor chain", () => {
  const elements = Array.from({ length: 20_000 }, (_, index) => element(
    `deep-${index}`,
    index ? `deep-${index - 1}` : undefined,
    { zIndex: index, ...(index === 0 ? { isLocked: true } : {}) },
  ));
  const hierarchy = createElementHierarchy(elements);
  const lastId = `deep-${elements.length - 1}`;
  assert.equal(hierarchy.ancestors(lastId).length, elements.length);
  assert.equal(hierarchy.stackPath(lastId).length, elements.length);
  assert.equal(hierarchy.isLocked(lastId), true);
  assert.equal(hierarchy.isDescendantOf(lastId, "deep-0"), true);
});

test("element hierarchy terminates defensively if given a cycle", () => {
  const hierarchy = createElementHierarchy([
    element("a", "b"),
    element("b", "a"),
  ]);

  assert.doesNotThrow(() => hierarchy.stackPath("a"));
  assert.equal(hierarchy.isDescendantOf("a", "missing"), false);
});
