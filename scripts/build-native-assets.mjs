import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { buildWebAdblockExtension } from './build-web-adblock-extension.mjs';
import { enableGhosterySubframeCosmetics } from '../shared/ghostery-preload-patch.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function buildNativeAssets(outdir = path.join(root, 'dist')) {
  await fs.mkdir(outdir, { recursive: true });
  const require = createRequire(import.meta.url);
  const ghosteryEntry = require.resolve('@ghostery/adblocker-electron-preload');
  const ghosterySource = await fs.readFile(ghosteryEntry, 'utf8');
  const ghosteryFrameSafeSource = enableGhosterySubframeCosmetics(ghosterySource);
  await Promise.all([
    buildWebAdblockExtension(path.join(outdir, 'web-adblock-extension')),
    build({
      absWorkingDir: root,
      entryPoints: ['web-privacy-preload.cjs'],
      outfile: path.join(outdir, 'web-privacy-preload.cjs'),
      bundle: true,
      platform: 'node',
      format: 'cjs',
      external: ['electron'],
      plugins: [{
        name: 'ghostery-subframe-cosmetics',
        setup(builder) {
          builder.onResolve({ filter: /^@ghostery\/adblocker-electron-preload$/ }, () => ({
            path: ghosteryEntry,
            namespace: 'ghostery-frame-safe',
          }));
          builder.onLoad({ filter: /.*/, namespace: 'ghostery-frame-safe' }, () => ({
            contents: ghosteryFrameSafeSource,
            loader: 'js',
            resolveDir: path.dirname(ghosteryEntry),
          }));
        },
      }],
    }),
  ]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await buildNativeAssets();
