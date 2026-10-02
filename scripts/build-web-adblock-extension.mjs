import { build } from 'esbuild';
import fs from 'node:fs/promises';

await fs.mkdir('dist/web-adblock-extension',{recursive:true});
await build({entryPoints:['scripts/web-adblock-extension/background.js'],outfile:'dist/web-adblock-extension/background.js',bundle:true,platform:'browser',format:'iife',target:'chrome145'});
await fs.copyFile('scripts/web-adblock-extension/manifest.json','dist/web-adblock-extension/manifest.json');
