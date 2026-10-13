import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export async function buildWebAdblockExtension(outdir='dist/web-adblock-extension') {
  outdir=path.resolve(root,outdir);
  await fs.mkdir(outdir,{recursive:true});
  await build({absWorkingDir:root,entryPoints:['scripts/web-adblock-extension/background.js'],outfile:path.join(outdir,'background.js'),bundle:true,platform:'browser',format:'iife',target:'chrome145'});
  await fs.copyFile(path.join(root,'scripts/web-adblock-extension/manifest.json'),path.join(outdir,'manifest.json'));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await buildWebAdblockExtension();
