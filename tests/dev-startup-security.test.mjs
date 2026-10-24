import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createServer } from 'vite';
import { addReactRefreshPreambleHash, reactRefreshCspPlugin } from '../scripts/dev-inline-csp.mjs';
import { buildNativeAssets } from '../scripts/build-native-assets.mjs';

const policyOf = (html) => html.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/i)?.[1];

test('the dev CSP hashes only Vite React Refresh inline preambles', () => {
  const preamble = 'import { injectIntoGlobalHook } from "/@react-refresh";\ninjectIntoGlobalHook(window);\nwindow.$RefreshReg$ = () => {};\nwindow.$RefreshSig$ = () => (type) => type;';
  const html = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; object-src 'none'"><script type="module">${preamble}</script>`;
  const output = addReactRefreshPreambleHash(html);
  const hash = createHash('sha256').update(preamble).digest('base64');
  assert.match(policyOf(output), new RegExp(`'sha256-${hash}'`));
  assert.match(policyOf(output), /script-src 'self'/);
  assert.doesNotMatch(policyOf(output), /unsafe-inline|unsafe-eval/);
  assert.equal(addReactRefreshPreambleHash(output), output);
  assert.equal(reactRefreshCspPlugin().apply, 'serve');
  assert.equal(reactRefreshCspPlugin().transformIndexHtml.order, 'post');
  assert.equal(addReactRefreshPreambleHash('<script>window.$RefreshReg$ = 1</script>'), '<script>window.$RefreshReg$ = 1</script>');
});

test('Vite 6 development HTML authorizes its actual plugin-react preamble', async () => {
  const server = await createServer({
    configFile: path.resolve('vite.config.ts'),
    server: { middlewareMode: true },
    // This test transforms entry HTML; dependency prebundling has no consumer.
    optimizeDeps: { noDiscovery: true, include: [] },
    plugins: [{
      name: 'html-contract-without-dependency-prebundling',
      configResolved(config) {
        // Vite merges include arrays with the application's explicit workers.
        // Clear the resolved test configuration before creating the optimizer.
        config.optimizeDeps.include = [];
        config.optimizeDeps.noDiscovery = true;
      },
    }],
  });
  try {
    for (const entry of ['index.html', 'sheet.html']) {
      const source = await fs.readFile(entry, 'utf8');
      const output = await server.transformIndexHtml(`/${entry}`, source);
      const preamble = output.match(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/i);
      assert.ok(preamble, `${entry} includes the plugin-react preamble`);
      assert.match(preamble[2], /injectIntoGlobalHook\(window\)/);
      const hash = createHash('sha256').update(preamble[2]).digest('base64');
      assert.match(policyOf(output), new RegExp(`'sha256-${hash}'`));
      assert.ok(output.indexOf('Content-Security-Policy') < output.indexOf(preamble[0]));
      assert.ok(output.indexOf('Content-Security-Policy') < output.indexOf('src="/@vite/client"'));
      assert.doesNotMatch(policyOf(source), /sha256-/);
      assert.doesNotMatch(policyOf(output), /script-src[^;]*(?:unsafe-inline|unsafe-eval)/);
    }
  } finally {
    await server.close();
  }
});

test('native dev assets build into a clean output directory without relying on dist', async (t) => {
  const scripts = JSON.parse(await fs.readFile('package.json', 'utf8')).scripts;
  assert.match(scripts['electron:dev'], /^node scripts\/build-native-assets\.mjs &&/);
  assert.match(scripts.build, /vite build && node scripts\/build-native-assets\.mjs &&/);
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'noteboard-native-dev-'));
  t.after(async () => fs.rm(directory, { recursive: true, force: true }));
  const outdir = path.join(directory, 'fresh-dist');
  await buildNativeAssets(outdir);
  const preload = await fs.readFile(path.join(outdir, 'web-privacy-preload.cjs'), 'utf8');
  const background = await fs.readFile(path.join(outdir, 'web-adblock-extension', 'background.js'), 'utf8');
  const manifest = JSON.parse(await fs.readFile(path.join(outdir, 'web-adblock-extension', 'manifest.json'), 'utf8'));
  assert.match(preload, /contextBridge|electron/);
  assert.match(background, /noteboardAdBlock/);
  assert.equal(manifest.manifest_version, 2);
});
