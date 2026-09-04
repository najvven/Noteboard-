import assert from "node:assert/strict";
import test from "node:test";

import {
  clearBoardRecovery,
  loadBoardRecoveries,
  mergeBoardRecoveries,
  storeBoardRecovery,
} from "../src/features/board/recovery";
import type { Page } from "../src/types";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() {
    return this.values.size;
  }
  clear() {
    this.values.clear();
  }
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const page = (updatedAt: number, content: string): Page => ({
  id: "page-recovery",
  title: "Recovery",
  width: 800,
  height: 600,
  updatedAt,
  isPinned: false,
  elements: [
    {
      id: "element-a",
      type: "section",
      content,
      position: { x: 0, y: 0 },
      zIndex: 0,
    },
  ],
});

test("newer local recovery overlays storage and clears only after its revision saves", () => {
  const storage = new MemoryStorage();
  assert.equal(storeBoardRecovery(storage, page(2, "new")), true);
  const recoveries = loadBoardRecoveries(storage);
  const merged = mergeBoardRecoveries([page(1, "old")], recoveries);

  assert.equal(merged.pages[0].elements[0].content, "new");
  assert.equal(merged.recoveredPages.length, 1);
  clearBoardRecovery(storage, "page-recovery", 1);
  assert.equal(loadBoardRecoveries(storage).length, 1);
  clearBoardRecovery(storage, "page-recovery", 2);
  assert.equal(loadBoardRecoveries(storage).length, 0);
});

test("older recovery never replaces a newer stored board", () => {
  const storage = new MemoryStorage();
  storeBoardRecovery(storage, page(1, "old"));
  const merged = mergeBoardRecoveries(
    [page(2, "new")],
    loadBoardRecoveries(storage),
  );
  assert.equal(merged.pages[0].elements[0].content, "new");
  assert.deepEqual(merged.staleRecoveryIds, ["page-recovery"]);
});
