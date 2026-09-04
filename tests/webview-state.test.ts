import assert from "node:assert/strict";
import test from "node:test";

import type { BoardElement } from "../src/types";
import { mergeLiveWebviewUrls } from "../src/features/web/webview-state";

test("save-time webview synchronization returns an immutable copy", () => {
  const elements: BoardElement[] = [
    {
      id: "web-1",
      type: "embed",
      position: { x: 0, y: 0 },
      content: "https://example.com/old",
      zIndex: 1,
    },
  ];
  const snapshot = structuredClone(elements);

  const merged = mergeLiveWebviewUrls(
    elements,
    new Map([["web-1", "https://example.com/new"]]),
  );

  assert.deepEqual(elements, snapshot);
  assert.notEqual(merged, elements);
  assert.equal(merged[0].content, "https://example.com/new");
});
