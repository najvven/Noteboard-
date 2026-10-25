import assert from "node:assert/strict";
import test from "node:test";

import { removeElementTreeAndReferences } from "../src/features/board/element-removal";
import type { BoardElement } from "../src/types";

const element = (
  id: string,
  parentId?: string,
  overrides: Partial<BoardElement> = {},
): BoardElement => ({
  id,
  type: "section",
  content: "",
  position: { x: 0, y: 0 },
  size: { width: 100, height: 100 },
  zIndex: 1,
  parentId,
  ...overrides,
});

test("deleting a container follows explicit hierarchy and preserves overlapping roots", () => {
  const source = [
    element("board", undefined, { type: "board" }),
    element("child-outside", "board", { position: { x: 500, y: 500 } }),
    element("grandchild", "child-outside"),
    element("overlapping-root", undefined, { position: { x: 10, y: 10 } }),
  ];

  const result = removeElementTreeAndReferences(source, "board");

  assert.deepEqual([...result.removedIds].sort(), ["board", "child-outside", "grandchild"]);
  assert.deepEqual(result.elements.map(({ id }) => id), ["overlapping-root"]);
});

test("deleting a target clears direct and rich-text references immutably", () => {
  const source = [
    element("target"),
    element("source", undefined, {
      linkToId: "target",
      content: '<a href="#target-target">Jump</a>',
    }),
    element("web", undefined, { linkToId: "https://example.com/path" }),
  ];
  const snapshot = structuredClone(source);

  const result = removeElementTreeAndReferences(source, "target");

  assert.deepEqual(source, snapshot);
  assert.equal(result.elements[0].linkToId, undefined);
  assert.equal(result.elements[0].content, '<a href="#">Jump</a>');
  assert.equal(result.elements[1].linkToId, "https://example.com/path");
});
