import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { buildWebAdblockExtension } from './build-web-adblock-extension.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function buildNativeAssets(outdir = path.join(root, 'dist')) {
  await fs.mkdir(outdir, { recursive: true });
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
    }),
  ]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await buildNativeAssets();
