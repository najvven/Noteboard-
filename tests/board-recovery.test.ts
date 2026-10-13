import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyBoardRecovery,
  clearBoardRecovery,
  clearRecoveryEntry,
  createRecoveredBoard,
  getBoardRecoveryOwnerId,
  loadBoardRecoveries,
  storeBoardRecovery,
  type BoardRecoveryEntry,
} from "../src/features/board/recovery";
import type { Page } from "../src/types";
import { assertValidBoard } from "../shared/board-data.js";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}

const page = (updatedAt: number, content: string): Page => ({
  id: "page-recovery",
  title: "Recovery",
  width: 800,
  height: 600,
  updatedAt,
  isPinned: false,
  elements: [{
    id: "element-a",
    type: "section",
    content,
    position: { x: 0, y: 0 },
    zIndex: 0,
  }],
});

const recoveryEntry = (
  snapshot: Page,
  options: Partial<BoardRecoveryEntry> = {},
): BoardRecoveryEntry => ({
  savedAt: 10,
  baseRevision: 1,
  ownerId: "owner-one",
  page: snapshot,
  storageKey: "noteboard:page-recovery:page-recovery:owner-one",
  rawValue: JSON.stringify({ savedAt: 10, baseRevision: 1, ownerId: "owner-one", page: snapshot }),
  legacy: false,
  ...options,
});

test("two document owners keep independent drafts and clear only their own key", () => {
  const storage = new MemoryStorage();
  const owner = getBoardRecoveryOwnerId();
  assert.equal(storeBoardRecovery(storage, page(2, "default"), 1), true);
  assert.equal(storeBoardRecovery(storage, page(3, "owner A"), 1, undefined, "owner-A"), true);
  assert.equal(storeBoardRecovery(storage, page(4, "owner B"), 1, undefined, "owner-B"), true);

  assert.equal(loadBoardRecoveries(storage).length, 3);
  clearBoardRecovery(storage, "page-recovery", 2);
  const entries = loadBoardRecoveries(storage);
  assert.deepEqual(entries.map((entry) => entry.ownerId).sort(), ["owner-A", "owner-B"]);
  assert.equal(storage.getItem(`noteboard:page-recovery:page-recovery:${owner}`), null);
});

test("exact-entry clearing refuses a newer replacement and removes only the loaded value", () => {
  const storage = new MemoryStorage();
  assert.equal(storeBoardRecovery(storage, page(2, "first"), 1, undefined, "owner-one"), true);
  const first = loadBoardRecoveries(storage)[0];
  assert.equal(storeBoardRecovery(storage, page(3, "replacement"), 1, undefined, "owner-one"), true);

  assert.equal(clearRecoveryEntry(storage, first), false);
  const replacement = loadBoardRecoveries(storage)[0];
  assert.equal(replacement.page.elements[0].content, "replacement");
  assert.equal(clearRecoveryEntry(storage, replacement), true);
  assert.equal(loadBoardRecoveries(storage).length, 0);
});

test("recovery classification distinguishes acknowledgment, safe replay, missing base, and conflict", () => {
  const draft = page(9, "draft");
  const storedAcknowledgment = page(10, "draft");
  const entry = recoveryEntry(draft, { baseRevision: 8 });
  assert.equal(classifyBoardRecovery(storedAcknowledgment, entry), "acknowledged");
  assert.equal(classifyBoardRecovery(page(8, "base"), entry), "restore");

  const predecessor = page(7, "uncertain predecessor");
  assert.equal(classifyBoardRecovery(predecessor, recoveryEntry(draft, {
    baseRevision: 4,
    predecessor,
  })), "restore");
  assert.equal(classifyBoardRecovery(page(9, "different newer"), entry), "conflict");

  assert.equal(classifyBoardRecovery(undefined, recoveryEntry(draft, { baseRevision: null })), "restore");
  assert.equal(classifyBoardRecovery(undefined, recoveryEntry(draft, { baseRevision: undefined, legacy: true })), "conflict");
  assert.equal(classifyBoardRecovery(page(8, "base"), recoveryEntry(draft, { baseRevision: undefined, legacy: true })), "conflict");
});

test("legacy recovery keys load with unknown ownership and remain ambiguous without a base", () => {
  const storage = new MemoryStorage();
  const legacy = { savedAt: 10, page: page(2, "legacy draft") };
  storage.setItem("noteboard:page-recovery:page-recovery", JSON.stringify(legacy));
  const [entry] = loadBoardRecoveries(storage);
  assert.equal(entry.legacy, true);
  assert.equal(entry.ownerId, "legacy");
  assert.equal(entry.storageKey, "noteboard:page-recovery:page-recovery");
  assert.equal(classifyBoardRecovery(undefined, entry), "conflict");
});

test("legacy stored revisions default to zero for base matching", () => {
  const stored = page(0, "base");
  delete (stored as Partial<Page>).updatedAt;
  assert.equal(classifyBoardRecovery(stored, recoveryEntry(page(2, "draft"), {
    baseRevision: 0,
  })), "restore");
});

test("loader rejects owner envelopes stored under a mismatched owner key", () => {
  const storage = new MemoryStorage();
  const envelope = {
    savedAt: 10,
    baseRevision: 1,
    ownerId: "owner-one",
    page: page(2, "draft"),
  };
  const aliasKey = "noteboard:page-recovery:page-recovery:owner-two";
  storage.setItem(aliasKey, JSON.stringify(envelope));
  assert.equal(loadBoardRecoveries(storage).length, 0);
  assert.equal(storage.getItem(aliasKey), null);
});

test("default-owner cleanup ignores denied Storage access", () => {
  const denied = {
    getItem() { throw new Error("storage denied"); },
    removeItem() { throw new Error("storage denied"); },
  } as unknown as Storage;
  assert.doesNotThrow(() => clearBoardRecovery(denied, "page-recovery", 10));
});

test("recovered copy IDs, links, styles, and Web sessions are deterministic and isolated", async () => {
  const source = page(4, "source");
  source.title = "A saved board";
  source.elements = [
    {
      id: "web-old",
      type: "embed",
      position: { x: 10, y: 20 },
      size: { width: 400, height: 260 },
      content: "https://example.com/",
      webSessionId: "old-session",
      color: "#f0f0f0",
      zIndex: 1,
    },
    {
      id: "text-old",
      type: "text",
      position: { x: 500, y: 20 },
      size: { width: 100, height: 50 },
      content: '<a href="#target-web-old">open</a>',
      linkToId: "web-old",
      zIndex: 2,
    },
  ];
  const entry = recoveryEntry(source);
  const recoveredA = await createRecoveredBoard(entry);
  const recoveredB = await createRecoveredBoard(entry);

  assert.equal(recoveredA.id, recoveredB.id);
  assert.deepEqual(recoveredA.elements, recoveredB.elements);
  assert.equal(recoveredA.title, "Recovered — A saved board");
  assert.equal(recoveredA.isPinned, false);
  assert.equal(recoveredA.updatedAt, source.updatedAt);
  assert.deepEqual(recoveredA.recoveryOrigin, {
    boardId: source.id,
    snapshotHash: recoveredA.recoveryOrigin?.snapshotHash,
  });
  assert.match(recoveredA.recoveryOrigin!.snapshotHash, /^[a-f0-9]{64}$/);
  assert.doesNotThrow(() => assertValidBoard(recoveredA));
  assert.throws(() => assertValidBoard({
    ...recoveredA,
    recoveryOrigin: { boardId: "bad/id", snapshotHash: "short" },
  }), /recovery origin/);
  const [web, text] = recoveredA.elements;
  assert.notEqual(web.id, "web-old");
  assert.notEqual(web.webSessionId, "old-session");
  assert.equal(text.linkToId, web.id);
  assert.ok(text.content.includes(`#target-${web.id}`));
  assert.equal(web.color, "#f0f0f0");
});
