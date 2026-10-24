import assert from "node:assert/strict";
import test from "node:test";

import {
  boardSnapshotPayloadKey,
  persistLatestBoardSnapshot,
  stabilizeBoardSnapshotRevision,
  type PendingBoardSave,
} from "../src/features/board/save-snapshot";
import type { Page } from "../src/types";
import { BoardConflictError, BoardValidationError } from '../src/lib/storage-errors';

const page = (updatedAt: number, cell: string, title = "Board"): Page => ({
  id: "save-snapshot-board",
  title,
  width: 800,
  height: 600,
  updatedAt,
  isPinned: false,
  elements: [{
    id: "sheet",
    type: "table",
    position: { x: 0, y: 0 },
    content: JSON.stringify({
      mode: "excel",
      workbook: { sheets: { sheet1: { cellData: { A1: { v: cell } }, views: [{ showGridlines: false }] } } },
    }),
    zIndex: 1,
  }],
  editorSettings: { toolbarLayout: { order: ["text", "media"], more: [] } },
});

test("an acknowledged unchanged snapshot does not issue another write", async () => {
  let writes = 0;
  const value = page(10, 'unchanged');
  const result = await persistLatestBoardSnapshot(value, null, 10, async () => { writes++; return true; }, () => undefined);
  assert.equal(writes, 0);
  assert.equal(result.accepted, true);
});

test('a definitive conflict or validation failure is not retained as an uncertain predecessor', async () => {
  for (const error of [new BoardConflictError('Changed'), new BoardValidationError('Invalid')]) {
    const old = { snapshot: page(2, 'old attempt'), baseRevision: 1 };
    let pending: PendingBoardSave | null = old;
    const rejected = await persistLatestBoardSnapshot(page(3, 'latest'), pending, 1,
      async () => { throw error; }, value => { pending = value; });
    assert.equal(pending, null);
    assert.equal(rejected.accepted, false);
    let attempted: Page | undefined;
    await persistLatestBoardSnapshot(page(4, 'newer valid draft'), pending, 1,
      async value => { attempted = value.snapshot; return false; }, () => undefined);
    assert.equal(attempted?.elements[0].content, page(4, 'newer valid draft').elements[0].content);
  }
});

test("stable revisions reuse only an identical full persisted Page payload", () => {
  const initial = page(1, "same");
  const first = stabilizeBoardSnapshotRevision(initial, null, () => 10);
  const samePayload = stabilizeBoardSnapshotRevision(page(999, "same"), first.stableRevision, () => 11);
  assert.equal(samePayload.snapshot.updatedAt, 10);
  const pendingRevision = stabilizeBoardSnapshotRevision(
    page(12, "same"),
    { payloadKey: "temporarily-different", revision: 11 },
    () => 13,
    { snapshot: page(10, "same"), baseRevision: 5 },
  );
  assert.equal(pendingRevision.snapshot.updatedAt, 10);

  const changedView = page(2, "same");
  changedView.elements[0].content = changedView.elements[0].content.replace("false", "true");
  assert.notEqual(boardSnapshotPayloadKey(changedView), boardSnapshotPayloadKey(initial));
  const viewRevision = stabilizeBoardSnapshotRevision(changedView, first.stableRevision, () => 12);
  assert.equal(viewRevision.snapshot.updatedAt, 12);

  const changedSettings = page(3, "same");
  changedSettings.editorSettings = { toolbarLayout: { order: ["media", "text"], more: [] } };
  assert.notEqual(boardSnapshotPayloadKey(changedSettings), boardSnapshotPayloadKey(initial));
});

test("a newer write retries an uncertain exact predecessor before sending its own payload", async () => {
  const previous = page(10, "first");
  const latest = page(20, "second");
  const pending: PendingBoardSave = { snapshot: previous, baseRevision: 5 };
  const calls: Array<{ revision: number; base: number | null; cell: string }> = [];
  const changed: Array<number | null> = [];

  const result = await persistLatestBoardSnapshot(
    latest,
    pending,
    5,
    async (save) => {
      calls.push({
        revision: save.snapshot.updatedAt,
        base: save.baseRevision,
        cell: JSON.parse(save.snapshot.elements[0].content).workbook.sheets.sheet1.cellData.A1.v,
      });
    },
    (save) => changed.push(save?.snapshot.updatedAt ?? null),
  );

  assert.deepEqual(calls, [
    { revision: 10, base: 5, cell: "first" },
    { revision: 20, base: 10, cell: "second" },
  ]);
  assert.equal(result.accepted, true);
  assert.equal(result.baseRevision, 20);
  assert.equal(result.pending, null);
  assert.deepEqual(changed, [null, 20, null]);
});

test("failed uncertain acknowledgment retains the exact predecessor and blocks newer writes", async () => {
  const previous = page(10, "first");
  const latest = page(20, "second");
  const pending: PendingBoardSave = { snapshot: previous, baseRevision: 5 };
  const calls: Page[] = [];
  const result = await persistLatestBoardSnapshot(
    latest,
    pending,
    5,
    async (save) => {
      calls.push(save.snapshot);
      throw new Error("connection lost");
    },
    () => undefined,
  );

  assert.deepEqual(calls, [previous]);
  assert.equal(result.accepted, false);
  assert.equal(result.baseRevision, 5);
  assert.equal(result.pending?.snapshot, previous);
  assert.equal(result.pending?.baseRevision, 5);
  assert.match(String(result.error), /connection lost/);
});

test("acknowledged predecessor advances the base even when the newer write fails", async () => {
  const previous = page(10, "first");
  const latest = page(20, "second");
  let attempts = 0;
  const result = await persistLatestBoardSnapshot(
    latest,
    { snapshot: previous, baseRevision: 5 },
    5,
    async () => {
      attempts += 1;
      if (attempts === 2) throw new Error("latest write lost its acknowledgment");
    },
    () => undefined,
  );

  assert.equal(attempts, 2);
  assert.equal(result.accepted, false);
  assert.equal(result.baseRevision, 10);
  assert.equal(result.pending?.snapshot, latest);
  assert.equal(result.pending?.baseRevision, 10);
});
