import fs from 'node:fs/promises';
import { downloadFilterSnapshot } from '../shared/web-filter-engine.js';

const folder = new URL('../build/web-filters/', import.meta.url);
const snapshot = await downloadFilterSnapshot();
await fs.mkdir(new URL('sources/', folder), { recursive: true });
const names = new Set(snapshot.sources.map((source, index) => `${index}-${new URL(source.url).pathname.split('/').pop()}`));
for (const name of await fs.readdir(new URL('sources/', folder))) {
  if (/^\d+-[\w.-]+$/.test(name) && !names.has(name)) await fs.unlink(new URL(`sources/${name}`, folder));
}
for (const [index, source] of snapshot.sources.entries()) {
  await fs.writeFile(new URL(`sources/${index}-${new URL(source.url).pathname.split('/').pop()}`, folder), source.text);
}
await fs.writeFile(new URL('engine.bin', folder), snapshot.binary);
await fs.writeFile(new URL('manifest.json', folder), JSON.stringify(snapshot.manifest, null, 2) + '\n');
console.log(`Bundled ${snapshot.manifest.networkRules} network rules and ${snapshot.manifest.cosmeticRules} cosmetic rules.`);
