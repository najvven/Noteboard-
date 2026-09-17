import assert from 'node:assert/strict';
import test from 'node:test';
import { anchoredZoomScroll, clampZoom } from '../src/features/board/zoom.ts';

test('zoom keeps the board point under an anchor stationary at different board offsets', () => {
  for (const boardOrigin of [64, 1700, 50000]) for (const previousZoom of [.1, .7, 1, 2, 5]) for (const nextZoom of [.1, .8, 1.5, 5]) {
    const scroll = boardOrigin + 250, anchor = 137;
    const nextScroll = anchoredZoomScroll({ scroll, anchor, boardOrigin, previousZoom, nextZoom });
    assert.ok(Math.abs((nextScroll + anchor - boardOrigin) / nextZoom - (scroll + anchor - boardOrigin) / previousZoom) < 1e-7);
  }
});

test('zoom limits preserve the established ten to five hundred percent range', () => {
  assert.equal(clampZoom(-20), .1);
  assert.equal(clampZoom(20), 5);
  assert.equal(clampZoom(1.15), 1.15);
});
