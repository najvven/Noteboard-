import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fork } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { loadStoredPresets, updateStoredPreset } from '../shared/preset-store.js';

async function directory(t) {
  const value = await fs.mkdtemp(path.join(os.tmpdir(), 'noteboard-preset-store-'));
  t.after(() => fs.rm(value, { recursive: true, force: true }));
  return value;
}

async function worker(t, target) {
  const child = fork(fileURLToPath(new URL('./fixtures/preset-store-worker.mjs', import.meta.url)), [target], {
    execArgv: [],
    stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGKILL');
      await exited;
    }
  });
  const [ready] = await once(child, 'message');
  assert.deepEqual(ready, { ready: true });
  return child;
}

function update(child, operation) {
  const response = once(child, 'message');
  child.send(operation);
  return response.then(([result]) => result);
}

const preset = id => ({ id, name: id, elements: [], isBuiltIn: false });

test('concurrent template additions from separate app processes preserve both templates', async t => {
  const target = await directory(t);
  const a = await worker(t, target), b = await worker(t, target);
  const results = await Promise.all([
    update(a, { type: 'add', preset: preset('from-a') }),
    update(b, { type: 'add', preset: preset('from-b') }),
  ]);
  assert.ok(results.every(result => result.ok), JSON.stringify(results));
  assert.deepEqual(new Set((await loadStoredPresets(target)).map(item => item.id)), new Set(['from-a', 'from-b']));
});

test('an uncertain template-add retry is idempotent and rejects a conflicting reused id', async t => {
  const target = await directory(t);
  const candidate = preset('stable-id');
  await updateStoredPreset(target, { type: 'add', preset: candidate });
  await updateStoredPreset(target, { type: 'add', preset: candidate });
  assert.equal((await loadStoredPresets(target)).filter(item => item.id === candidate.id).length, 1);
  const foreignElement = { id: 'foreign-payload', type: 'rectangle', position: { x: 0, y: 0 }, size: { width: 20, height: 20 }, content: '', zIndex: 1 };
  await assert.rejects(updateStoredPreset(target, { type: 'add', preset: { ...candidate, elements: [foreignElement] } }), /different template/i);
});

test('an uncertain template-add retry preserves a concurrent rename and allows later queue operations', async t => {
  const target = await directory(t), candidate = preset('stable-id');
  await updateStoredPreset(target, { type: 'add', preset: candidate });
  await updateStoredPreset(target, { type: 'rename', id: candidate.id, name: 'Renamed in another window' });

  const replayed = await updateStoredPreset(target, { type: 'add', preset: candidate });
  assert.equal(replayed.find(item => item.id === candidate.id)?.name, 'Renamed in another window');
  await updateStoredPreset(target, { type: 'add', preset: preset('later-add') });
  assert.deepEqual((await loadStoredPresets(target)).map(item => item.id), ['stable-id', 'later-add']);
});

test('a rename for a template deleted in another process is resolved without blocking later operations', async t => {
  const target = await directory(t), removed = preset('removed-elsewhere');
  await updateStoredPreset(target, { type: 'add', preset: removed });
  await updateStoredPreset(target, { type: 'delete', id: removed.id });
  assert.deepEqual(await updateStoredPreset(target, { type: 'rename', id: removed.id, name: 'Stale rename' }), []);
  await updateStoredPreset(target, { type: 'add', preset: preset('later-add') });
  assert.deepEqual((await loadStoredPresets(target)).map(item => item.id), ['later-add']);
});

test('templates validate element identity before writing and keep invalid legacy records recoverable', async t => {
  const target = await directory(t);
  const element = { id: 'cell', type: 'section', position: { x: 0, y: 0 }, size: { width: 20, height: 20 }, content: 'legacy value', zIndex: 1 };
  const invalid = { ...preset('duplicate-cell'), elements: [element, { ...element }] };
  await assert.rejects(updateStoredPreset(target, { type: 'add', preset: invalid }), /unique/);
  assert.deepEqual(await loadStoredPresets(target), []);

  await fs.writeFile(path.join(target, 'presets.json'), JSON.stringify([invalid]));
  assert.equal((await loadStoredPresets(target))[0].id, 'duplicate-cell');
  await assert.rejects(updateStoredPreset(target, { type: 'add', preset: preset('new-valid') }), /unique/);
  assert.deepEqual(JSON.parse(await fs.readFile(path.join(target, 'presets.json'), 'utf8')), [invalid]);
});
