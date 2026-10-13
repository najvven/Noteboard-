import assert from 'node:assert/strict';
import test from 'node:test';
import { enqueueBoardOperation, flushBoardOperations, nextBoardRevision, registerDocumentFlush } from '../src/lib/board-operations';
import { loadPages, savePage, deletePage, prepareBrowserUnload } from '../src/lib/storage';
import { storeBoardRecovery, loadBoardRecoveries, classifyBoardRecovery, getBoardRecoveryOwnerId } from '../src/features/board/recovery';
import { BoardConflictError } from '../src/lib/storage-errors';
import type { Page } from '../src/types';

class MemoryStorage implements Storage {
  values = new Map<string, string>();
  get length() { return this.values.size; }
  clear() { this.values.clear(); }
  getItem(key: string) { return this.values.get(key) ?? null; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  removeItem(key: string) { this.values.delete(key); }
  setItem(key: string, value: string) { this.values.set(key, value); }
}
const page = (revision = 1, content = ''): Page => ({ id: 'operation-board', title: 'Board', width: 800, height: 600,
  isPinned: false, updatedAt: revision, elements: [{ id: 'text-one', type: 'text', position: { x: 0, y: 0 }, content, zIndex: 1 }] });
const defer = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };
function windowFixture(t: any, api?: any) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const storage = new MemoryStorage();
  const value = { localStorage: storage, noteboardAPI: api };
  Object.defineProperty(globalThis, 'window', { value, configurable: true, writable: true });
  t.after(() => { if (previous) Object.defineProperty(globalThis, 'window', previous); else Reflect.deleteProperty(globalThis, 'window'); });
  return { storage, window: value };
}

test('per-board operations serialize, resume after failure, and report pending failures to close', async () => {
  const gate = defer(), events: string[] = [];
  const first = enqueueBoardOperation('ordered', async () => { events.push('first'); await gate.promise; throw Error('Disk full'); });
  const failure = assert.rejects(first, /Disk full/);
  const flush = assert.rejects(flushBoardOperations(), /Disk full/);
  gate.resolve();
  await Promise.all([failure, flush]);
  await enqueueBoardOperation('ordered', async () => { events.push('second'); });
  assert.deepEqual(events, ['first', 'second']);
});

test('flush waits for the active document and ignores cleanup from an old owner', async () => {
  const oldCleanup = registerDocumentFlush(async () => true);
  let called = 0;
  const cleanup = registerDocumentFlush(async () => { called++; return false; });
  oldCleanup();
  try { await assert.rejects(flushBoardOperations(), /current board/); assert.equal(called, 1); }
  finally { cleanup(); }
  await flushBoardOperations();
});

test('revisions increase within one millisecond and above persisted revisions', t => {
  t.mock.method(Date, 'now', () => 500);
  assert.equal(nextBoardRevision('monotonic', 600), 601);
  assert.equal(nextBoardRevision('monotonic', 500), 602);
  assert.throws(() => nextBoardRevision('invalid', Number.NaN));
});

test('native final saves bypass the browser keepalive cap even if recovery storage is full', async t => {
  let saved: Page | undefined;
  const { storage } = windowFixture(t, { savePage: async (value: Page) => { saved = value; return true; } });
  storage.setItem = () => { throw Error('Quota'); };
  await savePage(page(1, 'a'.repeat(70_000)), { keepalive: true });
  assert.equal(saved?.elements[0].content?.length, 70_000);
});

test('browser final-save failure is explicit when a large recovery cannot be stored', async t => {
  const { storage } = windowFixture(t);
  storage.setItem = () => { throw Error('Quota'); };
  const value = page(2, 'a'.repeat(70_000));
  assert.equal(prepareBrowserUnload(value), false);
  await assert.rejects(savePage(value, { keepalive: true }), /recovery/);
  assert.equal(prepareBrowserUnload({ ...value, width: -1 }), false);
});

test('browser large recovery replays through acknowledged persistence on the next load', async t => {
  const fixture = windowFixture(t);
  assert.equal(await savePage(page(2, 'a'.repeat(70_000)), { keepalive: true, baseRevision: 1 }), false, 'Recovery storage is not a persistence acknowledgment');
  let saved: Page | undefined;
  fixture.window.noteboardAPI = { loadPages: async () => [page(1)], savePage: async (value: Page) => { saved = value; return true; } };
  const loaded = await loadPages();
  assert.equal(loaded[0].updatedAt, 2);
  assert.equal(saved?.updatedAt, 2);
  assert.equal(loadBoardRecoveries(fixture.storage).length, 0);
});

test('failed recovery replay rereads a concurrent newer board instead of presenting the stale merge', async t => {
  let reads = 0, failures = 0;
  const { storage } = windowFixture(t, {
    loadPages: async () => [++reads === 1 ? page(1, 'old') : page(3, 'newer')],
    savePage: async () => { throw Error('Newer version'); },
  });
  storeBoardRecovery(storage, page(2, 'recovery'));
  const loaded = await loadPages({ onRecoveryError: () => { failures++; } });
  assert.equal(reads, 2); assert.equal(failures, 1);
  assert.equal(loaded[0].elements[0].content, 'newer');
  assert.equal(loadBoardRecoveries(storage).length, 1, 'An unacknowledged divergent draft must remain recoverable');
});

test('reload recovers a newer draft after its unacknowledged predecessor committed', async t => {
  let stored = page(2, 'Committed without acknowledgment');
  const attempts: number[] = [];
  const { storage } = windowFixture(t, {
    loadPages: async () => [stored],
    savePage: async (value: Page, options: { baseRevision: number }) => {
      attempts.push(value.updatedAt);
      if (JSON.stringify(value) !== JSON.stringify(stored) && options.baseRevision !== stored.updatedAt) throw Error('Conflict');
      stored = value; return true;
    },
  });
  storeBoardRecovery(storage, page(3, 'Latest draft'), 1, page(2, 'Committed without acknowledgment'));
  const loaded = await loadPages();
  assert.deepEqual(attempts, [2, 3]);
  assert.equal(loaded[0].elements[0].content, 'Latest draft');
  assert.equal(stored.updatedAt, 3);
  assert.equal(loadBoardRecoveries(storage).length, 0);
});

test('recovery cannot use its predecessor to overwrite another editor', async t => {
  const stored = page(4, 'Other editor');
  const { storage } = windowFixture(t, {
    loadPages: async () => [stored],
    savePage: async () => { throw Error('Conflict'); },
  });
  storeBoardRecovery(storage, page(5, 'Local draft'), 1, page(2, 'Old unacknowledged write'));
  let failures = 0;
  await loadPages({ onRecoveryError: () => failures++ });
  assert.equal(stored.elements[0].content, 'Other editor');
  assert.equal(failures, 1);
  assert.equal(loadBoardRecoveries(storage).length, 1);
});

test('unacknowledged native writes reject and retain recovery data', async t => {
  const { storage } = windowFixture(t, { savePage: async () => false });
  await assert.rejects(savePage(page(2), { keepalive: true }), /acknowledge/);
  assert.equal(loadBoardRecoveries(storage).length, 1);
});

test('native conflicts retain their code and invalid snapshots never reach persistence', async t => {
  let writes = 0;
  windowFixture(t, { savePage: async () => { writes++; return { ok: false, code: 'STALE_BOARD_REVISION', message: 'Changed' }; } });
  await assert.rejects(savePage(page()), { code: 'STALE_BOARD_REVISION' });
  assert.equal(writes, 1);
  await assert.rejects(savePage({ ...page(), width: -1 }), { code: 'INVALID_BOARD_DATA' });
  assert.equal(writes, 1);
});

test('save captures its payload and deletion runs after all queued saves', async t => {
  const gate = defer(), events: string[] = [];
  windowFixture(t, {
    savePage: async (value: Page) => { events.push(value.elements[0].content!); if (value.updatedAt === 1) await gate.promise; return true; },
    deletePage: async () => { events.push('delete'); return true; },
  });
  const first = savePage(page(1, 'first'));
  const mutable = page(2, 'second'), second = savePage(mutable);
  mutable.elements[0].content = 'mutated after request';
  const removal = deletePage(mutable.id);
  gate.resolve();
  await Promise.all([first, second, removal]);
  assert.deepEqual(events, ['first', 'second', 'delete']);
});

test('recovery enumeration does not skip the next key after removing corrupt entries', () => {
  const storage = new MemoryStorage();
  storage.setItem('noteboard:page-recovery:broken', '{broken');
  storeBoardRecovery(storage, page(2));
  storage.setItem('noteboard:page-recovery:invalid', JSON.stringify({ savedAt: 1, page: { ...page(3), width: -1 } }));
  assert.equal(loadBoardRecoveries(storage).length, 1);
  assert.equal(storage.length, 1);
  assert.equal(classifyBoardRecovery(page(2, 'saved'), loadBoardRecoveries(storage)[0]), 'conflict');
});

test('a successful save and explicit discard clear only the calling editor recovery', async t => {
  const { storage } = windowFixture(t, { savePage: async () => true });
  storeBoardRecovery(storage, page(2, 'Local'), 1);
  storeBoardRecovery(storage, page(3, 'Other tab'), 1, undefined, 'other-owner');
  await savePage(page(2, 'Local'), { baseRevision: 1 });
  assert.deepEqual(loadBoardRecoveries(storage).map(entry => entry.ownerId), ['other-owner']);
  const { discardBoardRecovery } = await import('../src/lib/storage');
  discardBoardRecovery(page().id);
  assert.equal(loadBoardRecoveries(storage)[0].page.elements[0].content, 'Other tab');
});

test('two divergent owner drafts become an acknowledged original and a visible independent copy', async t => {
  const stored = new Map<string, Page>([[page().id, page(1, 'Original')]]);
  const { storage } = windowFixture(t, {
    loadPages: async () => [...stored.values()],
    savePage: async (value: Page, options: { baseRevision: number | null }) => {
      assert.equal(options.baseRevision, stored.get(value.id)?.updatedAt ?? null);
      stored.set(value.id, value); return true;
    },
  });
  storeBoardRecovery(storage, page(3, 'Draft A'), 1, undefined, 'owner-a');
  storeBoardRecovery(storage, page(2, 'Draft B'), 1, undefined, 'owner-b');
  const loaded = await loadPages();
  assert.equal(loaded.length, 2);
  assert.deepEqual(loaded.map(value => value.elements[0].content).sort(), ['Draft A', 'Draft B']);
  const copy = loaded.find(value => value.id !== page().id)!;
  assert.match(copy.title, /^Recovered — /);
  assert.notEqual(copy.elements[0].id, 'text-one');
  assert.equal(loadBoardRecoveries(storage).length, 0);
});

test('an older conflicting draft and a deleted original are preserved as copies, never resurrected', async t => {
  const stored = new Map<string, Page>([[page().id, page(9, 'Newest')]]);
  const { storage } = windowFixture(t, {
    loadPages: async () => [...stored.values()],
    savePage: async (value: Page, options: { baseRevision: null }) => {
      assert.equal(options.baseRevision, null);
      assert.equal(stored.has(value.id), false);
      stored.set(value.id, value); return true;
    },
  });
  storeBoardRecovery(storage, page(2, 'Older draft'), 1);
  const deleted = { ...page(3, 'Deleted board draft'), id: 'deleted-board' };
  storeBoardRecovery(storage, deleted, 1, undefined, 'deleted-owner');
  const loaded = await loadPages();
  assert.equal(loaded.length, 3);
  assert.equal(stored.get(page().id)?.elements[0].content, 'Newest');
  assert.equal(stored.has(deleted.id), false);
  assert.equal(loaded.some(value => value.elements[0].content === 'Deleted board draft'), true);
  assert.equal(loadBoardRecoveries(storage).length, 0);
});

test('lost copy acknowledgment retries the same copy and preserves subsequent edits', async t => {
  const stored = new Map<string, Page>([[page().id, page(5, 'Other editor')]]);
  let writes = 0, failures = 0;
  const { storage } = windowFixture(t, {
    loadPages: async () => [...stored.values()],
    savePage: async (value: Page) => {
      writes++; stored.set(value.id, value); throw Error('Lost acknowledgment');
    },
  });
  storeBoardRecovery(storage, page(2, 'Local'), 1);
  const firstLoad = await loadPages({ onRecoveryError: () => failures++ });
  assert.equal(failures, 1);
  assert.equal(firstLoad.length, 2, 'Only the reread acknowledged store is presented');
  assert.equal(loadBoardRecoveries(storage).length, 1);
  const copy = [...stored.values()].find(value => value.id !== page().id)!;
  const editedCopy = { ...copy, title: 'My recovered work', updatedAt: 10 };
  stored.set(copy.id, editedCopy);
  const loaded = await loadPages();
  assert.equal(loaded.find(value => value.id === copy.id)?.title, editedCopy.title);
  assert.equal(writes, 1);
  assert.equal(loadBoardRecoveries(storage).length, 0);
});

test('a recovery racing a different writer rereads the store and forks instead of overwriting it', async t => {
  const stored = new Map<string, Page>([[page().id, page(1, 'Original')]]);
  let writes = 0;
  const { storage } = windowFixture(t, {
    loadPages: async () => [...stored.values()],
    savePage: async (value: Page, options: { baseRevision: number | null }) => {
      writes++;
      if (writes === 1) { stored.set(page().id, page(4, 'Other writer')); throw new BoardConflictError('Changed'); }
      assert.equal(options.baseRevision, null);
      stored.set(value.id, value); return true;
    },
  });
  storeBoardRecovery(storage, page(2, 'Local draft'), 1);
  const loaded = await loadPages();
  assert.equal(loaded.length, 2);
  assert.equal(stored.get(page().id)?.elements[0].content, 'Other writer');
  assert.equal(loaded.some(value => value.elements[0].content === 'Local draft'), true);
  assert.equal(loadBoardRecoveries(storage).length, 0);
});

test('a replacement recovery written during replay is retained for the next load', async t => {
  const { storage } = windowFixture(t, {
    loadPages: async () => [page(1)],
    savePage: async () => {
      storeBoardRecovery(storage, page(3, 'Newer draft'), 2, undefined, getBoardRecoveryOwnerId());
      return true;
    },
  });
  storeBoardRecovery(storage, page(2, 'First draft'), 1);
  await loadPages();
  assert.equal(loadBoardRecoveries(storage)[0].page.elements[0].content, 'Newer draft');
});
