import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createWebSessionConfigurationQueue,
  normalizeWebSessionSettings,
  resolveWebRequestPolicy,
  shouldBlockCookies,
} from '../shared/electron-web-policy.js';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

test('Web session configuration applies in request order after delayed filter setup', async () => {
  const configure = createWebSessionConfigurationQueue();
  const filterReady = deferred();
  const firstStarted = deferred();
  const applied = [];
  const partition = 'persist:noteboard-web-field';

  const enable = configure(partition, async () => {
    firstStarted.resolve();
    await filterReady.promise;
    applied.push('adBlock:on');
    applied.push('cookies:third-party');
  });
  await firstStarted.promise;
  const disable = configure(partition, async () => {
    applied.push('adBlock:off');
    applied.push('cookies:off');
  });
  const otherField = configure('persist:noteboard-web-other', async () => {
    applied.push('other-field');
  });

  await otherField;
  assert.deepEqual(applied, ['other-field']);
  filterReady.resolve();
  await Promise.all([enable, disable]);
  assert.deepEqual(applied, [
    'other-field',
    'adBlock:on',
    'cookies:third-party',
    'adBlock:off',
    'cookies:off',
  ]);
});

test('a provisional main-frame request does not replace committed first-party context', () => {
  const settings = {
    topLevelUrl: 'https://publisher.example/page',
    cookieBlocker: 'third-party',
  };
  const blockedNavigation = {
    resourceType: 'mainFrame',
    url: 'https://tracker.example/landing',
  };
  const policy = resolveWebRequestPolicy(
    blockedNavigation,
    settings,
    settings.topLevelUrl,
  );
  assert.equal(policy.settings.topLevelUrl, blockedNavigation.url);
  assert.equal(policy.mainFrameUrl, blockedNavigation.url);

  // The request policy can use a provisional navigation URL for that request,
  // but the committed context is only updated from a main-frame navigation event.
  const rememberedTopLevelUrl = settings.topLevelUrl;
  assert.equal(rememberedTopLevelUrl, settings.topLevelUrl);

  const followingRequest = resolveWebRequestPolicy(
    { resourceType: 'script', url: 'https://cdn.tracker.example/app.js' },
    settings,
    rememberedTopLevelUrl,
  );
  assert.equal(followingRequest.settings.topLevelUrl, settings.topLevelUrl);
  assert.equal(
    shouldBlockCookies('https://cdn.tracker.example/app.js', followingRequest.settings),
    true,
  );
  const notCommitted = resolveWebRequestPolicy(
    { resourceType: 'script', url: 'http://localhost/tracker' },
    settings,
    rememberedTopLevelUrl,
  );
  assert.equal(notCommitted.settings.topLevelUrl, settings.topLevelUrl);
});

test('hostless about:blank context fails closed instead of treating tracker cookies as first-party', () => {
  assert.equal(normalizeWebSessionSettings({
    cookieBlocker: 'third-party',
    topLevelUrl: 'about:blank',
  }).topLevelUrl, '');
  assert.equal(shouldBlockCookies('https://tracker.example/data', {
    cookieBlocker: 'third-party',
    topLevelUrl: 'about:blank',
  }), true);
});
