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
  await assert.rejects(updateStoredPreset(target, { type: 'add', preset: { ...candidate, name: 'Different template' } }), /different template/i);
});
