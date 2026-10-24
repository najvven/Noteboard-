import assert from "node:assert/strict";
import test from "node:test";

import { assertValidBoard } from "../shared/board-data.js";
import { repairLegacyBoard } from "../shared/board-migration.js";

const board = (elements) => ({
  id: "legacy-board",
  title: "Legacy",
  width: 800,
  height: 600,
  elements,
});

test("load migration repairs dangling legacy relations before strict validation", () => {
  const repaired = repairLegacyBoard(
    board([
      {
        id: "element-a",
        type: "section",
        position: { x: 0, y: 0 },
        parentId: "missing",
        linkToId: "missing",
      },
    ]),
  );
  assert.doesNotThrow(() => assertValidBoard(repaired));
  assert.equal(repaired.elements[0].parentId, undefined);
  assert.equal(repaired.elements[0].linkToId, undefined);
  assert.equal(repaired.elements[0].content, "");
  assert.equal(repaired.elements[0].zIndex, 0);
});

test("load migration does not conceal parent cycles", () => {
  const repaired = repairLegacyBoard(
    board([
      {
        id: "a",
        type: "section",
        content: "",
        position: { x: 0, y: 0 },
        zIndex: 0,
        parentId: "b",
      },
      {
        id: "b",
        type: "section",
        content: "",
        position: { x: 0, y: 0 },
        zIndex: 1,
        parentId: "a",
      },
    ]),
  );
  assert.throws(() => assertValidBoard(repaired), /cycle/i);
});
