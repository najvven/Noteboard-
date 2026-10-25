import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { FiltersEngine, Request } from '@ghostery/adblocker';
import { atomicWriteJson } from './persistence.js';

const require = createRequire(import.meta.url);
export const FILTER_ENGINE_VERSION = require('@ghostery/adblocker/package.json').version;
export const FILTER_LISTS = [
  'https://easylist.to/easylist/easylist.txt',
  'https://easylist.to/easylist/easyprivacy.txt',
  'https://easylist-downloads.adblockplus.org/easylistpolish.txt',
  'https://pgl.yoyo.org/adservers/serverlist.php?hostformat=adblockplus&showintro=1&mimetype=plaintext',
  ...['badware', 'filters-2020', 'filters-2021', 'filters-2022', 'filters-2023', 'filters-2024', 'filters-2025', 'filters-2026', 'filters', 'quick-fixes', 'resource-abuse', 'unbreak', 'privacy']
    .map(name => `https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/${name}.txt`),
];
const RESOURCES_URL = 'https://raw.githubusercontent.com/ghostery/adblocker/master/packages/adblocker/assets/ublock-origin/resources.json';
const UPDATE_INTERVAL = 24 * 60 * 60 * 1000;
const MAX_RESOURCE_BYTES = 16 * 1024 * 1024;
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function download(url, fetchImpl) {
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Filter download failed (${response.status}).`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (!bytes.length || bytes.length > MAX_RESOURCE_BYTES) throw new Error('Invalid filter download size.');
  return { url, text: new TextDecoder().decode(bytes), sha256: hash(bytes), bytes: bytes.length };
}

export async function downloadFilterSnapshot(fetchImpl = fetch) {
  const [lists, resources] = await Promise.all([
    Promise.all(FILTER_LISTS.map(url => download(url, fetchImpl))),
    download(RESOURCES_URL, fetchImpl),
  ]);
  for (const list of lists) {
    if (!/^[!\[]/.test(list.text.trim()) || /^\s*</.test(list.text)) throw new Error('Unexpected filter list format.');
  }
  const engine = FiltersEngine.parse(lists.map(list => list.text).join('\n'), { enableCompression: true });
  engine.updateResources(resources.text, resources.sha256);
  const { networkFilters, cosmeticFilters } = engine.getFilters();
  if (networkFilters.length < 50000 || cosmeticFilters.length < 10000) throw new Error('Incomplete filter lists.');
  const binary = engine.serialize();
  const manifest = {
    engineVersion: FILTER_ENGINE_VERSION, fetchedAt: new Date().toISOString(), sha256: hash(binary),
    networkRules: networkFilters.length, cosmeticRules: cosmeticFilters.length,
    sources: [...lists, resources].map(({ text: _text, ...metadata }) => metadata),
  };
  return { engine, binary, manifest, sources: [...lists, resources] };
}

export function decodeFilterSnapshot(binary, manifest) {
  if (manifest.engineVersion !== FILTER_ENGINE_VERSION || hash(binary) !== manifest.sha256 || !Number.isFinite(Date.parse(manifest.fetchedAt))) {
    throw new Error('Invalid filter snapshot.');
  }
  return { engine: FiltersEngine.deserialize(binary), manifest };
}

export async function loadBundledFilters(directory = new URL('../build/web-filters/', import.meta.url)) {
  const folder = directory instanceof URL ? directory : pathToFileURL(path.resolve(directory) + path.sep);
  const [binary, manifest] = await Promise.all([
    fs.readFile(new URL('engine.bin', folder)),
    fs.readFile(new URL('manifest.json', folder), 'utf8').then(JSON.parse),
  ]);
  return decodeFilterSnapshot(binary, manifest);
}

/** One engine shared by fields; each request still uses its own source and switches. */
export async function createWebFilterService({ cacheFile, fetchImpl = fetch, bundleDirectory, updateInterval = UPDATE_INTERVAL } = {}) {
  let current = await loadBundledFilters(bundleDirectory);
  if (cacheFile) {
    try {
      const cached = JSON.parse(await fs.readFile(cacheFile, 'utf8'));
      const decoded = decodeFilterSnapshot(Buffer.from(cached.binary, 'base64'), cached.manifest);
      if (Date.parse(decoded.manifest.fetchedAt) > Date.parse(current.manifest.fetchedAt)) current = decoded;
    } catch { /* A missing/incompatible cache cannot disable the bundled filters. */ }
  }
  let refreshing;
  let lastAttempt = 0;
  return {
    get engine() { return current.engine; },
    get manifest() { return current.manifest; },
    refresh(force = false) {
      if (refreshing) return refreshing;
      if (!force && (Date.now() - Date.parse(current.manifest.fetchedAt) < updateInterval || Date.now() - lastAttempt < 60 * 60 * 1000)) return Promise.resolve(false);
      lastAttempt = Date.now();
      refreshing = (async () => {
        const next = await downloadFilterSnapshot(fetchImpl);
        if (cacheFile) {
          await fs.mkdir(path.dirname(cacheFile), { recursive: true });
          await atomicWriteJson(cacheFile, { manifest: next.manifest, binary: Buffer.from(next.binary).toString('base64') });
        }
        current = next;
        return true;
      })().finally(() => { refreshing = undefined; });
      return refreshing;
    },
  };
}

export function filterRequest(details, topLevelUrl = '') {
  const frameUrl = details.resourceType === 'subFrame' ? details.frame?.parent?.url : details.frame?.url;
  return Request.fromRawDetails({ url: details.url, type: details.resourceType || 'other', sourceUrl: details.referrer || frameUrl || topLevelUrl, requestId: String(details.id ?? '') });
}

export function adBlockingResponse(engine, details, topLevelUrl = '') {
  if (details.resourceType === 'mainFrame') return { cancel: false };
  const { match, redirect } = engine.match(filterRequest(details, topLevelUrl));
  return redirect ? { redirectURL: redirect.dataUrl } : { cancel: match };
}

export function addFilterCsp(engine, details, headers, topLevelUrl = '') {
  if (!['mainFrame', 'subFrame'].includes(details.resourceType)) return headers;
  const policy = engine.getCSPDirectives(filterRequest(details, topLevelUrl));
  if (!policy) return headers;
  const key = Object.keys(headers).find(name => name.toLowerCase() === 'content-security-policy') || 'Content-Security-Policy';
  // Separate policies intersect; existing site restrictions must never be weakened.
  return { ...headers, [key]: [...(headers[key] || []), policy] };
}
