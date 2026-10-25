import assert from 'node:assert/strict';
import test from 'node:test';
import { installAdCosmeticHandlers } from '../shared/electron-ad-cosmetics.js';

function fixture({ adBlock = true } = {}) {
  const handlers = new Map();
  const calls = [];
  const root = {
    url: 'https://publisher.test/', top: null, dead: false,
    isDestroyed() { return this.dead; },
    executeJavaScript(script) { calls.push({ frame: this, script }); return Promise.resolve(); },
  };
  root.top = root;
  const sender = { mainFrame: root, isDestroyed: () => false, getType: () => 'webview' };
  const subframe = { ...root, url: 'https://ads.test/inside', top: root };
  const foreign = { ...root, url: 'https://ads.test/foreign', top: { ...root } };
  installAdCosmeticHandlers({ handle: (channel, handler) => handlers.set(channel, handler) }, () => ({ adBlock }), async () => ({
    getCosmeticsFilters: ({ url, ids }) => ({
      active: true,
      styles: url.includes('ads.test') ? (ids?.includes('new') ? '.dynamic-ad { display:none }' : '.ad-slot { display:none }') : undefined,
      scripts: url.includes('ads.test') ? ['window.__blockedSlot = true;'] : [],
    }),
  }));
  const event = frame => ({ sender, senderFrame: frame });
  return { handlers, calls, root, sender, subframe, foreign, event };
}

test('cosmetic filtering targets an owned guest subframe in that frame', async () => {
  const f = fixture();
  const enabled = await f.handlers.get('@ghostery/adblocker/is-mutation-observer-enabled')(f.event(f.subframe));
  assert.equal(enabled, true);
  await f.handlers.get('@ghostery/adblocker/inject-cosmetic-filters')(f.event(f.subframe), 'https://untrusted.invalid/', undefined);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].frame, f.subframe);
  assert.match(f.calls[0].script, /\.ad-slot \{ display:none \}/);
  assert.match(f.calls[0].script, /noteboard-adblocker-cosmetics/);
  assert.equal(f.calls[1].frame, f.subframe);
  assert.match(f.calls[1].script, /__blockedSlot/);
  assert.equal(f.handlers.get('@ghostery/adblocker/is-mutation-observer-enabled')(f.event(f.foreign)), false);
});

test('subframe styles are deduplicated and untrusted or disabled frames are rejected', async () => {
  const f = fixture();
  const inject = f.handlers.get('@ghostery/adblocker/inject-cosmetic-filters');
  await inject(f.event(f.subframe), '', undefined);
  await inject(f.event(f.subframe), '', { ids: ['new'] });
  const styles = f.calls.filter(call => call.script.includes('noteboard-adblocker-cosmetics'));
  assert.equal(styles.length, 2);
  assert.equal((styles[1].script.match(/\.ad-slot \{ display:none \}/g) || []).length, 1);
  assert.equal((styles[1].script.match(/\.dynamic-ad \{ display:none \}/g) || []).length, 1);
  await inject(f.event(f.foreign), 'https://ads.test/inside', undefined);
  await inject({ ...f.event(f.subframe), sender: { ...f.sender, getType: () => 'browser-window' } }, '', undefined);
  assert.equal(f.calls.length, 4);

  const off = fixture({ adBlock: false });
  assert.equal(off.handlers.get('@ghostery/adblocker/is-mutation-observer-enabled')(off.event(off.subframe)), false);
  await off.handlers.get('@ghostery/adblocker/inject-cosmetic-filters')(off.event(off.subframe), '', undefined);
  assert.equal(off.calls.length, 0);
});

test('a subframe navigating while filters load does not receive stale rules', async () => {
  const f = fixture();
  let release;
  const install = new Map();
  installAdCosmeticHandlers({ handle: (channel, handler) => install.set(channel, handler) }, () => ({ adBlock: true }), () => new Promise(resolve => { release = resolve; }));
  const pending = install.get('@ghostery/adblocker/inject-cosmetic-filters')(f.event(f.subframe), '', undefined);
  f.subframe.url = 'https://new.test/document';
  release({ getCosmeticsFilters: () => ({ active: true, styles: '.old { display:none }', scripts: ['window.stale = true;'] }) });
  await pending;
  assert.equal(f.calls.length, 0);
});
