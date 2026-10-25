import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const backgroundSource = await fs.readFile(new URL('../scripts/web-adblock-extension/background.js', import.meta.url), 'utf8');

function createBackground({ responseFor }) {
  const workers = [];
  class FakeWorker {
    constructor(url) {
      this.url = url;
      this.terminated = false;
      workers.push(this);
      queueMicrotask(() => this.onmessage?.({ data: { type: 'ready' } }));
    }
    postMessage(message) {
      if (message.type !== 'match') return;
      responseFor(message, this);
    }
    terminate() { this.terminated = true; }
  }
  const context = vm.createContext({
    Worker: FakeWorker,
    chrome: { runtime: { getURL: path => `chrome-extension://fixture/${path}` } },
    console: { warn() {} },
    setTimeout,
    clearTimeout,
    queueMicrotask,
    Promise,
    Error,
    String,
    Boolean,
  });
  vm.runInContext(backgroundSource, context);
  return { api: context.noteboardAdBlock, workers };
}

test('web ad matching runs in a restartable worker and releases a timed-out request', async () => {
  const { api, workers } = createBackground({
    responseFor(message, worker) {
      if (message.request.url.includes('/hang')) return;
      queueMicrotask(() => worker.onmessage?.({ data: {
        type: 'result', id: message.id,
        result: { cancel: message.request.url.includes('/blocked') },
      } }));
    },
  });
  await api.configure({
    enabled: true,
    topLevelUrl: 'https://publisher.test/',
    manifest: { sha256: 'fixture', fetchedAt: new Date().toISOString(), networkRules: 1, cosmeticRules: 1 },
    binary: 'verified-fixture',
  });
  const timedOut = await api.filterRequest({ url: 'https://publisher.test/hang', type: 'script', requestId: '1' });
  assert.deepEqual(JSON.parse(JSON.stringify(timedOut)), { cancel: false });
  assert.equal(workers[0].terminated, true);
  const blocked = await api.filterRequest({ url: 'https://publisher.test/blocked', type: 'script', requestId: '2' });
  assert.deepEqual(JSON.parse(JSON.stringify(blocked)), { cancel: true });
  assert.equal(workers.length, 2);
  assert.equal(api.status().matcherTimeouts, 1);
});

test('web ad matcher queue stays bounded and disabled sessions bypass the worker', async () => {
  const { api, workers } = createBackground({ responseFor: () => {} });
  await api.configure({
    enabled: false,
    manifest: { sha256: 'fixture', fetchedAt: new Date().toISOString(), networkRules: 1, cosmeticRules: 1 },
    binary: 'verified-fixture',
  });
  assert.deepEqual(JSON.parse(JSON.stringify(await api.filterRequest({ url: 'https://publisher.test/', type: 'script' }))), {});
  assert.equal(workers.length, 0);
});
