import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { atomicWriteJson, readJsonWithBackup } from '../shared/persistence.js';
import { boardFile, loadStoredBoards, saveStoredBoard, saveStoredBoards, deleteStoredBoard } from '../shared/board-store.js';

const page = (updatedAt = 1, title = 'Board', id = 'board-one') => ({
  version: 4, id, title, width: 800, height: 600, elements: [], updatedAt,
});
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'noteboard-store-'));
  t.after(() => fs.rm(dir, { recursive: true, force: true }));
  return dir;
}
async function zipBoard(dir, value) {
  const zip = new JSZip().file('board.json', JSON.stringify(value));
  await fs.writeFile(path.join(dir, 'legacy.zip'), await zip.generateAsync({ type: 'nodebuffer' }));
}

test('invalid and oversized writes preserve both primary and backup', async t => {
  const dir = await fixture(t), file = path.join(dir, 'bounded.json');
  await atomicWriteJson(file, { value: 1 }, { maxBytes: 40 });
  await atomicWriteJson(file, { value: 2 }, { maxBytes: 40 });
  await assert.rejects(atomicWriteJson(file, { value: 'x'.repeat(100) }, { maxBytes: 40 }), /too large/);
  await assert.rejects(atomicWriteJson(file, { value: 3 }, { validate: () => { throw Error('Invalid'); } }), /Invalid/);
  assert.deepEqual(await readJsonWithBackup(file), { value: 2 });
  assert.deepEqual(JSON.parse(await fs.readFile(`${file}.bak`)), { value: 1 });
  assert.equal((await fs.readdir(dir)).filter(name => name.endsWith('.tmp')).length, 0);
});

test('corrupt JSON and invalid-schema primaries never replace the valid backup', async t => {
  const dir = await fixture(t), file = boardFile(dir, 'board-one');
  await saveStoredBoard(dir, page(1));
  await saveStoredBoard(dir, page(2));
  for (const invalid of ['broken', JSON.stringify({ id: 'board-one', title: 123 })]) {
    await fs.writeFile(file, invalid);
    assert.equal((await loadStoredBoards(dir))[0].updatedAt, 1);
    await saveStoredBoard(dir, page(3));
    assert.equal(JSON.parse(await fs.readFile(`${file}.bak`)).updatedAt, 1);
  }
});

test('backup-only boards are discovered, saved, and deleted without resurrection', async t => {
  const dir = await fixture(t), file = boardFile(dir, 'board-one');
  await fs.writeFile(`${file}.bak`, JSON.stringify(page()));
  assert.equal((await loadStoredBoards(dir)).length, 1);
  await saveStoredBoard(dir, page(2));
  await deleteStoredBoard(dir, 'board-one');
  assert.deepEqual(await loadStoredBoards(dir), []);
  assert.deepEqual(await fs.readdir(dir), []);
});

test('stale and ambiguous revisions reject before replacing saved data', async t => {
  const dir = await fixture(t);
  await saveStoredBoard(dir, page(3, 'Newest'));
  await assert.rejects(saveStoredBoard(dir, page(2, 'Old')), { code: 'STALE_BOARD_REVISION' });
  await assert.rejects(saveStoredBoard(dir, page(3, 'Different')), { code: 'STALE_BOARD_REVISION' });
  await saveStoredBoard(dir, page(3, 'Newest'));
  assert.equal((await loadStoredBoards(dir))[0].title, 'Newest');
  assert.throws(() => boardFile(dir, '../board-one'));
});

test('a stale editing base cannot overwrite or delete a newer document even with a higher new timestamp', async t => {
  const dir = await fixture(t);
  await saveStoredBoard(dir, page(1), { baseRevision: null });
  await saveStoredBoard(dir, page(2, 'First editor'), { baseRevision: 1 });
  await assert.rejects(saveStoredBoard(dir, page(99, 'Stale second editor'), { baseRevision: 1 }), { code: 'STALE_BOARD_REVISION' });
  await assert.rejects(deleteStoredBoard(dir, 'board-one', { baseRevision: 1 }), { code: 'STALE_BOARD_REVISION' });
  assert.equal((await loadStoredBoards(dir))[0].title, 'First editor');
  await saveStoredBoard(dir, page(3, 'Next acknowledged edit'), { baseRevision: 2 });
  assert.equal((await loadStoredBoards(dir))[0].updatedAt, 3);
});

test('batch validation and revision checks complete before any item is written', async t => {
  const dir = await fixture(t);
  await saveStoredBoard(dir, page(3));
  await assert.rejects(saveStoredBoards(dir, [page(1, 'New', 'new-board'), page(2)]), /newer version/);
  await assert.rejects(saveStoredBoards(dir, [page(1, 'A', 'new-board'), page(2, 'B', 'new-board')]), /unique/);
  await assert.rejects(saveStoredBoards(dir, [page(1, 'New', 'new-board'), { ...page(), width: -1 }]));
  assert.deepEqual((await loadStoredBoards(dir)).map(p => p.id), ['board-one']);
});

test('legacy ZIP chooses the newer revision and preserves an inert recovery archive', async t => {
  const dir = await fixture(t);
  await saveStoredBoard(dir, page(1, 'JSON'));
  await zipBoard(dir, page(2, 'ZIP'));
  const loaded = await loadStoredBoards(dir);
  assert.equal(loaded[0].title, 'ZIP');
  assert.ok((await fs.readdir(dir)).some(name => name.startsWith('legacy.zip.imported-')));
  assert.equal(JSON.parse(await fs.readFile(boardFile(dir, 'board-one'))).title, 'ZIP');
  await deleteStoredBoard(dir, 'board-one');
  assert.deepEqual(await loadStoredBoards(dir), []);
});

test('a newer JSON wins over an old ZIP and failed migrations retain their ZIP', async t => {
  const dir = await fixture(t);
  await saveStoredBoard(dir, page(5, 'JSON'));
  await zipBoard(dir, page(2, 'Old ZIP'));
  assert.equal((await loadStoredBoards(dir))[0].title, 'JSON');
  await zipBoard(dir, page(6, 'Blocked ZIP', 'blocked-board'));
  await fs.mkdir(boardFile(dir, 'blocked-board'));
  const warnings = [];
  const loaded = await loadStoredBoards(dir, message => warnings.push(message));
  assert.equal(loaded[0].title, 'JSON');
  assert.ok(warnings.some(message => message.includes('Could not import')));
  assert.ok((await fs.readdir(dir)).includes('legacy.zip'));
});

test('queued writes followed by deletion cannot replay after removal', async t => {
  const dir = await fixture(t);
  await Promise.all([saveStoredBoard(dir, page(1)), saveStoredBoard(dir, page(2)), deleteStoredBoard(dir, 'board-one')]);
  assert.deepEqual(await loadStoredBoards(dir), []);
});
