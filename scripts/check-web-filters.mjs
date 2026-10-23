import { loadBundledFilters } from '../shared/web-filter-engine.js';
const { manifest } = await loadBundledFilters();
console.log(`Verified bundled filters: ${manifest.networkRules} network + ${manifest.cosmeticRules} cosmetic rules (engine ${manifest.engineVersion}).`);
