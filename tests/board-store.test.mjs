import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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

test('mismatched JSON names migrate to embedded-id ownership once and remain inert', async t => {
  const dir = await fixture(t), alias = path.join(dir, 'board.json'), canonical = boardFile(dir, 'page-sjtqz36');
  await fs.writeFile(alias, JSON.stringify(page(7, 'Legacy name', 'page-sjtqz36')));
  assert.deepEqual((await loadStoredBoards(dir)).map(value => value.id), ['page-sjtqz36']);
  assert.equal(JSON.parse(await fs.readFile(canonical, 'utf8')).title, 'Legacy name');
  const filesAfterMigration = await fs.readdir(dir);
  assert.ok(filesAfterMigration.some(name => /^board\.json\.retired-/.test(name)));
  assert.deepEqual((await loadStoredBoards(dir)).map(value => value.id), ['page-sjtqz36']);
  assert.deepEqual(await fs.readdir(dir), filesAfterMigration);
});

test('direct deletion retires a mismatched-name board without requiring a prior load', async t => {
  const dir = await fixture(t), alias = path.join(dir, 'board.json');
  await fs.writeFile(alias, JSON.stringify(page(4, 'Alias', 'page-sjtqz36')));
  await deleteStoredBoard(dir, 'page-sjtqz36');
  assert.deepEqual(await loadStoredBoards(dir), []);
  const files = await fs.readdir(dir);
  assert.ok(files.some(name => /^board\.json\.retired-/.test(name)));
  assert.ok(!files.includes('page-sjtqz36.json'));
});

test('mutations reject a canonical filename owned by a different board before changing any source', async t => {
  const dir = await fixture(t);
  const foreign = page(4, 'Logical board B', 'board-b');
  const requested = page(3, 'Logical board A', 'a');
  const foreignPath = path.join(dir, 'a.json');
  const requestedPath = path.join(dir, 'legacy-a.json');
  const foreignBytes = Buffer.from(JSON.stringify(foreign));
  const requestedBytes = Buffer.from(JSON.stringify(requested));
  await fs.writeFile(foreignPath, foreignBytes);
  await fs.writeFile(requestedPath, requestedBytes);

  await assert.rejects(deleteStoredBoard(dir, 'a', { baseRevision: 3 }), { code: 'BOARD_ID_PATH_COLLISION' });
  await assert.rejects(saveStoredBoard(dir, page(4, 'Changed A', 'a'), { baseRevision: 3 }), { code: 'BOARD_ID_PATH_COLLISION' });
  assert.deepEqual(await fs.readFile(foreignPath), foreignBytes);
  assert.deepEqual(await fs.readFile(requestedPath), requestedBytes);
  assert.deepEqual(new Map((await loadStoredBoards(dir)).map(board => [board.id, board.title])), new Map([
    ['board-b', 'Logical board B'], ['a', 'Logical board A'],
  ]));
});

test('foreign backup ownership and alias cycles are preserved without partial batch writes', async t => {
  const dir = await fixture(t);
  const backupPath = path.join(dir, 'a.json.bak');
  const aliasPath = path.join(dir, 'legacy-a.json');
  const backupBytes = Buffer.from(JSON.stringify(page(8, 'Backup owner B', 'board-b')));
  const aliasBytes = Buffer.from(JSON.stringify(page(7, 'Alias owner A', 'a')));
  await fs.writeFile(backupPath, backupBytes);
  await fs.writeFile(aliasPath, aliasBytes);
  await assert.rejects(deleteStoredBoard(dir, 'a', { baseRevision: 7 }), { code: 'BOARD_ID_PATH_COLLISION' });
  await assert.rejects(saveStoredBoards(dir, [page(1, 'Fresh board', 'fresh'), page(8, 'Changed A', 'a')]), {
    code: 'BOARD_ID_PATH_COLLISION',
  });
  assert.deepEqual(await fs.readFile(backupPath), backupBytes);
  assert.deepEqual(await fs.readFile(aliasPath), aliasBytes);
  await assert.rejects(fs.stat(boardFile(dir, 'fresh')), { code: 'ENOENT' });

  const cycle = path.join(dir, 'cycle');
  await fs.mkdir(cycle);
  const aPath = path.join(cycle, 'a.json'), bPath = path.join(cycle, 'b.json');
  const aBytes = Buffer.from(JSON.stringify(page(2, 'B in A path', 'b')));
  const bBytes = Buffer.from(JSON.stringify(page(2, 'A in B path', 'a')));
  await fs.writeFile(aPath, aBytes);
  await fs.writeFile(bPath, bBytes);
  assert.deepEqual(new Map((await loadStoredBoards(cycle)).map(board => [board.id, board.title])), new Map([
    ['b', 'B in A path'], ['a', 'A in B path'],
  ]));
  assert.deepEqual(await fs.readFile(aPath), aBytes);
  assert.deepEqual(await fs.readFile(bPath), bBytes);
});

test('a failed multi-source deletion restores every moved board source before rejecting', async t => {
  const dir = await fixture(t);
  await saveStoredBoard(dir, page(1));
  await saveStoredBoard(dir, page(2, 'Latest'));
  const primaryPath = boardFile(dir, 'board-one');
  const backupPath = `${primaryPath}.bak`;
  const primaryBytes = await fs.readFile(primaryPath);
  const backupBytes = await fs.readFile(backupPath);
  const rename = fs.rename.bind(fs);
  let failed = false;
  t.mock.method(fs, 'rename', async (source, destination, ...args) => {
    if (!failed && String(source) === backupPath && String(destination).includes('.noteboard-delete-transactions')) {
      failed = true;
      throw Object.assign(new Error('Injected backup rename failure'), { code: 'EIO' });
    }
    return rename(source, destination, ...args);
  });

  await assert.rejects(deleteStoredBoard(dir, 'board-one', { baseRevision: 2 }), /Injected backup rename failure/);
  assert.equal(failed, true);
  assert.deepEqual(await fs.readFile(primaryPath), primaryBytes);
  assert.deepEqual(await fs.readFile(backupPath), backupBytes);
  assert.equal((await loadStoredBoards(dir))[0].title, 'Latest');
  await assert.rejects(fs.stat(path.join(dir, '.noteboard-delete-transactions')), { code: 'ENOENT' });
});

test('startup restores a pending deletion after a process exits between source moves and commit', async t => {
  const dir = await fixture(t), transactionId = '11111111-1111-4111-8111-111111111111';
  const transactionDirectory = path.join(dir, '.noteboard-delete-transactions', `.delete-${transactionId}`);
  const filesDirectory = path.join(transactionDirectory, 'files');
  const bytes = Buffer.from(JSON.stringify(page(4, 'Recover pending delete')));
  const sourceName = 'board-one.json';
  const stagedName = `0-${Buffer.from(sourceName).toString('base64url')}`;
  await fs.mkdir(filesDirectory, { recursive: true });
  await fs.writeFile(path.join(filesDirectory, stagedName), bytes);
  await fs.writeFile(path.join(transactionDirectory, 'manifest.json'), JSON.stringify({
    version: 1, transactionId, boardId: 'board-one',
    sources: [{ sourceName, stagedName, sha256: createHash('sha256').update(bytes).digest('hex'), preserveAsRetired: false }],
  }));

  assert.equal((await loadStoredBoards(dir))[0].title, 'Recover pending delete');
  assert.deepEqual(await fs.readFile(boardFile(dir, 'board-one')), bytes);
  await assert.rejects(fs.stat(path.join(dir, '.noteboard-delete-transactions')), { code: 'ENOENT' });
});

test('a committed deletion cleans staged recovery bytes without resurrecting the board', async t => {
  const dir = await fixture(t), transactionId = '22222222-2222-4222-8222-222222222222';
  const transactionDirectory = path.join(dir, '.noteboard-delete-transactions', `.delete-${transactionId}`);
  const filesDirectory = path.join(transactionDirectory, 'files');
  const bytes = Buffer.from(JSON.stringify(page(4, 'Already deleted')));
  const sourceName = 'board-one.json';
  const stagedName = `0-${Buffer.from(sourceName).toString('base64url')}`;
  const manifestBytes = Buffer.from(JSON.stringify({
    version: 1, transactionId, boardId: 'board-one',
    sources: [{ sourceName, stagedName, sha256: createHash('sha256').update(bytes).digest('hex'), preserveAsRetired: false }],
  }));
  await fs.mkdir(filesDirectory, { recursive: true });
  await fs.writeFile(path.join(filesDirectory, stagedName), bytes);
  await fs.writeFile(path.join(transactionDirectory, 'manifest.json'), manifestBytes);
  await fs.writeFile(path.join(transactionDirectory, 'committed'), JSON.stringify({
    version: 1, transactionId, manifestSha256: createHash('sha256').update(manifestBytes).digest('hex'),
  }));

  assert.deepEqual(await loadStoredBoards(dir), []);
  await assert.rejects(fs.stat(path.join(dir, '.noteboard-delete-transactions')), { code: 'ENOENT' });
});

test('failure writing the deletion commit marker restores the acknowledged board sources', async t => {
  const dir = await fixture(t);
  await saveStoredBoard(dir, page(1));
  await saveStoredBoard(dir, page(2, 'Latest'));
  const originalOpen = fs.open.bind(fs);
  t.mock.method(fs, 'open', async (filePath, ...args) => {
    if (String(filePath).includes('.noteboard-delete-transactions') && path.basename(String(filePath)) === 'committed')
      throw Object.assign(new Error('Injected deletion commit failure'), { code: 'EIO' });
    return originalOpen(filePath, ...args);
  });

  await assert.rejects(deleteStoredBoard(dir, 'board-one', { baseRevision: 2 }), /Injected deletion commit failure/);
  assert.equal((await loadStoredBoards(dir))[0].title, 'Latest');
  await assert.rejects(fs.stat(path.join(dir, '.noteboard-delete-transactions')), { code: 'ENOENT' });
});

test('backup-only aliases migrate and later delete without resurrection', async t => {
  const dir = await fixture(t), alias = path.join(dir, 'old-name.json');
  await fs.writeFile(`${alias}.bak`, JSON.stringify(page(3, 'Backup alias', 'page-sjtqz36')));
  assert.equal((await loadStoredBoards(dir))[0].title, 'Backup alias');
  assert.equal(JSON.parse(await fs.readFile(boardFile(dir, 'page-sjtqz36'), 'utf8')).title, 'Backup alias');
  await deleteStoredBoard(dir, 'page-sjtqz36');
  assert.deepEqual(await loadStoredBoards(dir), []);
});

test('case-folded canonical path collisions preserve legacy files on every filesystem', async t => {
  const dir = await fixture(t);
  const sources = new Map([
    ['legacy-a.json', JSON.stringify(page(7, 'Uppercase', 'Page'))],
    ['legacy-b.json', JSON.stringify(page(6, 'Lowercase', 'page'))],
  ]);
  for (const [name, content] of sources) await fs.writeFile(path.join(dir, name), content);
  await zipBoard(dir, page(8, 'ZIP collision', 'PAGE'));
  const originalZip = await fs.readFile(path.join(dir, 'legacy.zip'));
  const warnings = [];

  const loaded = await loadStoredBoards(dir, message => warnings.push(message));
  assert.deepEqual(new Map(loaded.map(board => [board.id, board.title])), new Map([
    ['Page', 'Uppercase'],
    ['page', 'Lowercase'],
  ]));
  assert.ok(warnings.some(message => message.includes('Could not migrate stored board: Page')));
  assert.ok(warnings.some(message => message.includes('Could not migrate stored board: page')));
  assert.ok(warnings.some(message => message.includes('Could not import stored archive: legacy.zip')));

  await assert.rejects(saveStoredBoard(dir, page(9, 'Overwrite upper', 'Page')), { code: 'BOARD_ID_PATH_COLLISION' });
  await assert.rejects(saveStoredBoard(dir, page(9, 'Overwrite lower', 'page')), { code: 'BOARD_ID_PATH_COLLISION' });
  await assert.rejects(saveStoredBoards(dir, [page(9, 'Fresh', 'fresh'), page(9, 'Colliding', 'PAGE')]), {
    code: 'BOARD_ID_PATH_COLLISION',
  });
  await assert.rejects(saveStoredBoards(dir, [page(9, 'Batch upper', 'Page'), page(9, 'Batch lower', 'page')]), {
    code: 'BOARD_ID_PATH_COLLISION',
  });
  await assert.rejects(deleteStoredBoard(dir, 'Page'), { code: 'BOARD_ID_PATH_COLLISION' });
  await assert.rejects(deleteStoredBoard(dir, 'page'), { code: 'BOARD_ID_PATH_COLLISION' });

  const names = await fs.readdir(dir);
  assert.deepEqual(names.sort(), ['legacy-a.json', 'legacy-b.json', 'legacy.zip'].sort());
  for (const [name, content] of sources) assert.equal(await fs.readFile(path.join(dir, name), 'utf8'), content);
  assert.deepEqual(await fs.readFile(path.join(dir, 'legacy.zip')), originalZip);
});

test('primary and backup alias contents are assigned independently by embedded id', async t => {
  const dir = await fixture(t), alias = path.join(dir, 'legacy-name.json');
  await fs.writeFile(alias, JSON.stringify(page(2, 'Primary board', 'primary-id')));
  await fs.writeFile(`${alias}.bak`, JSON.stringify(page(5, 'Backup board', 'backup-id')));
  const loaded = await loadStoredBoards(dir);
  assert.deepEqual(new Map(loaded.map(board => [board.id, board.title])), new Map([
    ['backup-id', 'Backup board'], ['primary-id', 'Primary board'],
  ]));
  assert.equal(JSON.parse(await fs.readFile(boardFile(dir, 'primary-id'), 'utf8')).title, 'Primary board');
  assert.equal(JSON.parse(await fs.readFile(boardFile(dir, 'backup-id'), 'utf8')).title, 'Backup board');
});

test('equal-revision aliases choose lexical source name regardless of enumeration order', async t => {
  const parent = await fixture(t), id = 'shared-id';
  for (const [directory, names] of [
    [path.join(parent, 'reverse'), ['z-alias.json', 'a-alias.json']],
    [path.join(parent, 'forward'), ['a-alias.json', 'z-alias.json']],
  ]) {
    await fs.mkdir(directory);
    for (const name of names) {
      await fs.writeFile(path.join(directory, name), JSON.stringify(page(4, name.startsWith('a-') ? 'A source' : 'Z source', id)));
    }
    assert.equal((await loadStoredBoards(directory))[0].title, 'A source');
  }
});

test('first save, batch save, and delete work when the store directory is missing', async t => {
  const parent = await fixture(t);
  const single = path.join(parent, 'single'), batch = path.join(parent, 'batch'), deleted = path.join(parent, 'deleted');
  await saveStoredBoard(single, page(1, 'First save'));
  assert.equal((await loadStoredBoards(single))[0].title, 'First save');
  await saveStoredBoards(batch, [page(1, 'Batch save', 'batch-board')]);
  assert.equal((await loadStoredBoards(batch))[0].title, 'Batch save');
  await deleteStoredBoard(deleted, 'missing-board');
  await assert.rejects(fs.stat(deleted), { code: 'ENOENT' });
});

test('one blocked canonical migration does not prevent loading other boards', async t => {
  const dir = await fixture(t), id = 'page-sjtqz36', alias = path.join(dir, 'old-name.json');
  await fs.writeFile(alias, JSON.stringify(page(5, 'Recoverable alias', id)));
  await fs.mkdir(boardFile(dir, id));
  await fs.writeFile(boardFile(dir, 'unrelated'), JSON.stringify(page(3, 'Unrelated', 'unrelated')));
  const warnings = [];
  const loaded = await loadStoredBoards(dir, message => warnings.push(message));
  assert.deepEqual(new Map(loaded.map(board => [board.id, board.title])), new Map([
    ['page-sjtqz36', 'Recoverable alias'], ['unrelated', 'Unrelated'],
  ]));
  assert.equal(JSON.parse(await fs.readFile(alias, 'utf8')).title, 'Recoverable alias');
  assert.ok(!(await fs.readdir(dir)).some(name => /^old-name\.json\.retired-/.test(name)));
  assert.ok(warnings.some(message => message.includes('Could not migrate stored board: page-sjtqz36')));
});

test('canonical and alias revisions use newest content and canonical wins ties', async t => {
  const dir = await fixture(t), id = 'page-sjtqz36', canonical = boardFile(dir, id), alias = path.join(dir, 'board.json');
  await fs.writeFile(canonical, JSON.stringify(page(8, 'Canonical', id)));
  await fs.writeFile(alias, JSON.stringify(page(7, 'Old alias', id)));
  assert.equal((await loadStoredBoards(dir))[0].title, 'Canonical');
  assert.equal(JSON.parse(await fs.readFile(canonical, 'utf8')).title, 'Canonical');
  await fs.writeFile(alias, JSON.stringify(page(8, 'Equal-time alias', id)));
  assert.equal((await loadStoredBoards(dir))[0].title, 'Canonical');
  await fs.writeFile(alias, JSON.stringify(page(9, 'Newer alias', id)));
  await assert.rejects(saveStoredBoard(dir, page(8, 'Stale save', id), { baseRevision: 8 }), { code: 'STALE_BOARD_REVISION' });
  assert.equal(JSON.parse(await fs.readFile(alias, 'utf8')).title, 'Newer alias');
  assert.equal((await loadStoredBoards(dir))[0].title, 'Newer alias');
  assert.equal(JSON.parse(await fs.readFile(canonical, 'utf8')).title, 'Newer alias');
});

test('failed canonical migration preserves the original alias for recovery', async t => {
  const dir = await fixture(t), id = 'page-sjtqz36', alias = path.join(dir, 'board.json');
  await fs.writeFile(alias, JSON.stringify(page(2, 'Recover me', id)));
  await fs.mkdir(boardFile(dir, id));
  const warnings = [];
  assert.equal((await loadStoredBoards(dir, message => warnings.push(message)))[0].title, 'Recover me');
  assert.equal(JSON.parse(await fs.readFile(alias, 'utf8')).title, 'Recover me');
  assert.ok(!(await fs.readdir(dir)).some(name => /^board\.json\.retired-/.test(name)));
  assert.ok(warnings.some(message => message.includes('Could not migrate stored board')));
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

test('ZIP-only boards participate in save and delete ownership checks', async t => {
  const dir = await fixture(t);
  await zipBoard(dir, page(2, 'ZIP-only source', 'zip-only'));
  await assert.rejects(saveStoredBoard(dir, page(3, 'Conflicting create', 'zip-only'), { baseRevision: null }), { code: 'STALE_BOARD_REVISION' });

  await saveStoredBoard(dir, page(3, 'Updated from ZIP', 'zip-only'), { baseRevision: 2 });
  const names = await fs.readdir(dir);
  assert.ok(names.some(name => name.startsWith('legacy.zip.retired-')));
  assert.ok(!names.includes('legacy.zip'));
  assert.equal((await loadStoredBoards(dir))[0].title, 'Updated from ZIP');

  await deleteStoredBoard(dir, 'zip-only', { baseRevision: 3 });
  assert.deepEqual(await loadStoredBoards(dir), []);
  assert.ok((await fs.readdir(dir)).some(name => name.startsWith('legacy.zip.retired-')));
});

test('saving a legacy Layer normalizes missing content before write acknowledgment', async t => {
  const dir = await fixture(t);
  const legacy = {
    ...page(1, 'Legacy layer', 'legacy-layer'),
    elements: [{ id: 'layer-one', type: 'layer', position: { x: 0, y: 0 }, name: 'Layer 1', zIndex: 1 }],
  };
  await saveStoredBoards(dir, [legacy]);
  const stored = JSON.parse(await fs.readFile(boardFile(dir, 'legacy-layer'), 'utf8'));
  assert.equal(stored.elements[0].content, '');
  await saveStoredBoard(dir, legacy, { baseRevision: 1 });
  assert.equal(JSON.parse(await fs.readFile(boardFile(dir, 'legacy-layer'), 'utf8')).elements[0].content, '');
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
