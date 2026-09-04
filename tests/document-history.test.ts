import assert from "node:assert/strict";
import test from "node:test";

import {
  createBoardDocumentHistory,
  pushBoardDocumentHistory,
  redoBoardDocumentHistory,
  undoBoardDocumentHistory,
} from "../src/features/board/document-history";

const snapshot = (content: string) => ({
  elements: [
    {
      id: `element-${content}`,
      type: "section" as const,
      position: { x: 0, y: 0 },
      content,
      zIndex: 1,
    },
  ],
  sectionSheets: [],
});

test("document history branches immutably and supports bounded undo and redo", () => {
  const initial = createBoardDocumentHistory(snapshot("one"));
  const second = pushBoardDocumentHistory(initial, snapshot("two"), 3);
  const third = pushBoardDocumentHistory(second, snapshot("three"), 3);
  const undone = undoBoardDocumentHistory(third);
  const branched = pushBoardDocumentHistory(undone, snapshot("branch"), 3);

  assert.equal(initial.entries.length, 1);
  assert.equal(third.entries.length, 3);
  assert.equal(undone.entries[undone.index].elements[0].content, "two");
  assert.deepEqual(
    branched.entries.map((entry) => entry.elements[0].content),
    ["one", "two", "branch"],
  );
  assert.equal(redoBoardDocumentHistory(branched), branched);

  const capped = pushBoardDocumentHistory(branched, snapshot("four"), 3);
  assert.deepEqual(
    capped.entries.map((entry) => entry.elements[0].content),
    ["two", "branch", "four"],
  );
  assert.equal(capped.index, 2);
  assert.equal(redoBoardDocumentHistory(undoBoardDocumentHistory(capped)).index, 2);
});
