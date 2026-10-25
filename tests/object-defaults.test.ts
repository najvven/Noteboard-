import assert from "node:assert/strict";
import test from "node:test";

import { resolveObjectPlacementProps } from "../src/features/board/object-defaults.ts";

test("saved defaults replace stale values from another tool", () => {
  assert.deepEqual(
    resolveObjectPlacementProps({
      type: "rectangle",
      pendingProps: { color: "#ff0000", borderWidth: 9, opacity: 55 },
      savedDefaults: { color: "#2563eb", borderWidth: 2 },
      baseline: { tool: "ellipse", props: { color: "#ff0000", borderWidth: 9 } },
    }),
    { color: "#2563eb", borderWidth: 2, opacity: 55 },
  );
});

test("an explicit change after loading the same tool overrides its saved baseline", () => {
  assert.deepEqual(
    resolveObjectPlacementProps({
      type: "rectangle",
      pendingProps: { color: "#22c55e", borderWidth: 2 },
      savedDefaults: { color: "#2563eb", borderWidth: 2 },
      baseline: {
        tool: "rectangle",
        props: { color: "#2563eb", borderWidth: 2 },
      },
    }),
    { color: "#22c55e", borderWidth: 2 },
  );
});

test("pending values without a saved default remain available", () => {
  assert.deepEqual(
    resolveObjectPlacementProps({
      type: "text",
      pendingProps: { fontSize: 24, textColor: "#111827" },
      savedDefaults: { textColor: "#000000" },
      baseline: null,
    }),
    { fontSize: 24, textColor: "#000000" },
  );
});
