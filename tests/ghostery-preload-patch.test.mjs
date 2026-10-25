import assert from 'node:assert/strict';
import test from 'node:test';
import { enableGhosterySubframeCosmetics } from '../shared/ghostery-preload-patch.js';

test('pinned Ghostery preload runs its cosmetics monitor in subframes', () => {
  const original = "if (window === window.top && window.location.href.startsWith('devtools://') === false) { run(); }";
  assert.equal(enableGhosterySubframeCosmetics(original), "if (window.location.href.startsWith('devtools://') === false) { run(); }");
});

test('a Ghostery dependency change fails the build instead of silently dropping frame support', () => {
  assert.throws(() => enableGhosterySubframeCosmetics('if (window === window.top) { run(); }'), /no longer matches/i);
});
