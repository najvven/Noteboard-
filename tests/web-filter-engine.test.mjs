import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { FiltersEngine } from '@ghostery/adblocker';
import { loadBundledFilters, createWebFilterService, decodeFilterSnapshot, adBlockingResponse, addFilterCsp, downloadFilterSnapshot, MAX_FILTER_RESPONSE_BYTES } from '../shared/web-filter-engine.js';
import { isolateScriptlet } from '../shared/electron-ad-cosmetics.js';

const snapshot = await loadBundledFilters();
const blocked = result => Boolean(result.cancel || result.redirectURL);

test('scriptlet helper declarations remain separate from each other and the website', () => {
  const context = vm.createContext({});
  vm.runInContext('const JSONPath="website"; const _={factory:"website"};', context);
  for (let i=0;i<2;i++) vm.runInContext(isolateScriptlet('class JSONPath {}; var _={}; globalThis.installed=(globalThis.installed||0)+1;'), context);
  assert.equal(vm.runInContext('JSONPath', context), 'website');
  assert.equal(vm.runInContext('_.factory', context), 'website');
  assert.equal(vm.runInContext('installed', context), 2);
});

test('generated scriptlet arguments preserve literal percent patterns without URI errors', () => {
  const context = vm.createContext({});
  vm.runInContext(isolateScriptlet('(function(...args){globalThis.args=args})(...["v1%[-%0-9C]{300,}","a%2Fb"].filter(Boolean).map((a) => decodeURIComponent(a)))'), context);
  assert.equal(vm.runInContext('args[0]', context), 'v1%[-%0-9C]{300,}');
  assert.equal(vm.runInContext('args[1]', context), 'a%2Fb');
});

test('bundled maintained lists block ads/trackers while allowing ordinary content with similar names', () => {
  assert.ok(snapshot.manifest.networkRules > 100000);
  for (const url of ['https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', 'https://www.google-analytics.com/analytics.js', 'https://securepubads.g.doubleclick.net/tag/js/gpt.js']) {
    assert.equal(blocked(adBlockingResponse(snapshot.engine, { url, resourceType: 'script' }, 'https://publisher.example.org')), true, url);
  }
  for (const url of ['https://example.com/assets/banner.png', 'https://example.com/sponsor-information', 'https://example.com/search?q=doubleclick.net']) {
    assert.equal(blocked(adBlockingResponse(snapshot.engine, { url, resourceType: 'image' }, 'https://example.com')), false, url);
  }
  assert.deepEqual(adBlockingResponse(snapshot.engine, { url: 'https://example.com/ads-guide', resourceType: 'mainFrame' }), { cancel: false });
});

test('filter exceptions, request types and third-party context are honored', () => {
  const engine = FiltersEngine.parse('||ads.example.test^$script,third-party\n@@||ads.example.test/allowed.js$script');
  const request = { url: 'https://ads.example.test/script.js', resourceType: 'script' };
  assert.equal(blocked(adBlockingResponse(engine, request, 'https://other.test')), true);
  assert.equal(blocked(adBlockingResponse(engine, { ...request, url: 'https://ads.example.test/allowed.js' }, 'https://other.test')), false);
  assert.equal(blocked(adBlockingResponse(engine, request, 'https://example.test')), false);
  assert.equal(blocked(adBlockingResponse(engine, { ...request, resourceType: 'image' }, 'https://other.test')), false);
});

test('cosmetic rules target actual ad slots and retain useful content', () => {
  const result = snapshot.engine.getCosmeticsFilters({ url: 'https://publisher.example.org', hostname: 'publisher.example.org', domain: 'example.org', ids: ['ad-slot', 'main-article'], classes: ['hero-banner'], getRulesFromDOM: true, getBaseRules: false, getRulesFromHostname: false, getInjectionRules: false, getExtendedRules: false });
  assert.match(result.styles, /#ad-slot/);
  assert.doesNotMatch(result.styles, /main-article|hero-banner/);
});

test('ad CSP additions do not replace or weaken the site policy', () => {
  const engine = FiltersEngine.parse("||publisher.example.org^$csp=script-src 'none'");
  const original = { 'Content-Security-Policy': ["default-src 'self'"] };
  const result = addFilterCsp(engine, { url: 'https://publisher.example.org/', resourceType: 'mainFrame' }, original);
  assert.deepEqual(original['Content-Security-Policy'], ["default-src 'self'"]);
  assert.deepEqual(result['Content-Security-Policy'], ["default-src 'self'", "script-src 'none'"]);
});

test('offline startup and failed updates retain verified bundled blocking', async () => {
  const service = await createWebFilterService({ fetchImpl: async () => { throw new Error('Offline'); } });
  const previous = service.manifest.sha256;
  await assert.rejects(service.refresh(true), /Offline/);
  assert.equal(service.manifest.sha256, previous);
  assert.equal(blocked(adBlockingResponse(service.engine, { url: 'https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js', resourceType: 'script' }, 'https://example.org')), true);
});

test('filter downloads reject oversized declared bodies before allocating them', async () => {
  let bodyReads = 0;
  await assert.rejects(() => downloadFilterSnapshot(async () => ({
    ok: true,
    headers: { get: name => name.toLowerCase() === 'content-length' ? String(MAX_FILTER_RESPONSE_BYTES + 1) : null },
    body: { getReader: () => { bodyReads += 1; return { read: async () => ({ done: true }), releaseLock() {} }; } },
  })), /Invalid filter download size/);
  assert.equal(bodyReads, 0);
});

test('concurrent filter downloads share a total byte budget and cancel overflow', async () => {
  let cancellations = 0;
  let calls = 0;
  await assert.rejects(() => downloadFilterSnapshot(async () => {
    const index = calls++;
    if (index === 1) await new Promise(resolve => setTimeout(resolve, 10));
    return {
      ok: true,
      headers: { get: () => null },
      body: new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array(4));
          if (index === 0) controller.close();
        },
        cancel() { cancellations += 1; },
      }),
    };
  }, { maxTotalBytes: 6 }), /Invalid filter download size/);
  assert.ok(cancellations >= 1);
});

test('filter refresh is cached atomically and corrupted caches fall back to bundled lists', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'noteboard-filter-test-'));
  const cacheFile = path.join(folder, 'filters.json');
  try {
    const sources = new Map(await Promise.all(snapshot.manifest.sources.map(async (source, index) => [source.url, await fs.readFile(new URL(`../build/web-filters/sources/${index}-${new URL(source.url).pathname.split('/').pop()}`, import.meta.url))])));
    const fetchImpl = async url => {
      const bytes=sources.get(url);
      return {ok:true,headers:{get:name=>name.toLowerCase()==='content-length'?String(bytes.byteLength):null},body:new ReadableStream({start(controller){controller.enqueue(bytes);controller.close();}})};
    };
    const service = await createWebFilterService({ cacheFile, fetchImpl });
    assert.equal(await service.refresh(true), true);
    const cached = JSON.parse(await fs.readFile(cacheFile, 'utf8'));
    assert.equal(cached.manifest.sha256, service.manifest.sha256);
    const reopened = await createWebFilterService({ cacheFile, fetchImpl: async () => { throw Error('Offline'); } });
    assert.equal(reopened.manifest.fetchedAt, cached.manifest.fetchedAt);
    cached.binary = 'corrupt';
    await fs.writeFile(cacheFile, JSON.stringify(cached));
    assert.equal((await createWebFilterService({ cacheFile })).manifest.sha256, snapshot.manifest.sha256);
    assert.throws(() => decodeFilterSnapshot(Buffer.from('broken'), snapshot.manifest), /Invalid filter snapshot/);
  } finally {
    assert.ok(path.resolve(folder).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(folder).startsWith('noteboard-filter-test-'));
    await fs.rm(folder, { recursive: true, force: true });
  }
});
