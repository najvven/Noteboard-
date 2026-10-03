import assert from "node:assert/strict";
import test from "node:test";
import { createWorkbookDocument } from "../src/features/spreadsheet/workbook";

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

test("spreadsheet thumbnails refresh the current snapshot without consuming Undo", () => {
  const document = createWorkbookDocument("History", [[12]]);
  const initial = {
    elements: [
      {
        id: "sheet",
        type: "table" as const,
        position: { x: 0, y: 0 },
        content: JSON.stringify(document),
        zIndex: 1,
      },
    ],
    sectionSheets: [],
  };
  const history = createBoardDocumentHistory(initial);
  document.preview = "data:image/png;base64,AAAA";
  const painted = {
    ...initial,
    elements: [{ ...initial.elements[0], content: JSON.stringify(document) }],
  };
  const refreshed = pushBoardDocumentHistory(history, painted);
  assert.equal(refreshed.entries.length, 1);
  assert.equal(refreshed.index, 0);
  assert.equal(
    refreshed.entries[0].elements[0].content,
    painted.elements[0].content,
  );
  document.workbook.sheets!["sheet-1"].cellData[0][0].v = 13;
  const changed = pushBoardDocumentHistory(refreshed, {
    ...initial,
    elements: [{ ...initial.elements[0], content: JSON.stringify(document) }],
  });
  assert.equal(changed.entries.length, 2);
  assert.equal(undoBoardDocumentHistory(changed).index, 0);
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
  assert.equal(
    redoBoardDocumentHistory(undoBoardDocumentHistory(capped)).index,
    2,
  );
});

test("identical updates preserve the last meaningful action and the redo branch", () => {
  const initial = createBoardDocumentHistory(snapshot("one"));
  const changed = pushBoardDocumentHistory(initial, snapshot("two"));
  assert.equal(
    pushBoardDocumentHistory(changed, structuredClone(snapshot("two"))),
    changed,
  );
  const undone = undoBoardDocumentHistory(changed);
  assert.equal(
    pushBoardDocumentHistory(undone, structuredClone(snapshot("one"))),
    undone,
  );
  assert.equal(
    redoBoardDocumentHistory(undone).entries[1].elements[0].content,
    "two",
  );
});
