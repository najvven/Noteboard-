import assert from 'node:assert/strict';
import test from 'node:test';
import type { BoardElement } from '../src/types';
import { isPixelFillOpaqueAtPoint, rememberPixelFillAlphaMask } from '../src/features/board/pixel-fill-hit-test';

const content = 'data:image/png;base64,pixel-fill-alpha-hit-test';
const rgba = new Uint8ClampedArray(3 * 2 * 4);
for (const index of [0, 2, 4]) rgba[index * 4 + 3] = 255;
rememberPixelFillAlphaMask(content, rgba, 3, 2);

const element = (overrides: Partial<BoardElement> = {}): BoardElement => ({
  id: 'fill', type: 'image', isPixelFill: true, content,
  position: { x: 10, y: 20 }, size: { width: 3, height: 2 },
  zIndex: 1, ...overrides,
});

test('pixel-fill hits match opaque pixels and pass through transparent pixels', () => {
  const fill = element();
  assert.equal(isPixelFillOpaqueAtPoint(fill, { x: 10.25, y: 20.25 }), true);
  assert.equal(isPixelFillOpaqueAtPoint(fill, { x: 11.25, y: 20.25 }), false);
  assert.equal(isPixelFillOpaqueAtPoint(fill, { x: 12.25, y: 20.25 }), true);
  assert.equal(isPixelFillOpaqueAtPoint(fill, { x: 13, y: 20.25 }), false);
});

test('pixel-fill alpha hit testing follows rotation and horizontal flipping', () => {
  const flipped = element({ flipX: true });
  assert.equal(isPixelFillOpaqueAtPoint(flipped, { x: 12.25, y: 20.25 }), true);
  assert.equal(isPixelFillOpaqueAtPoint(flipped, { x: 11.25, y: 20.25 }), false);

  const rotated = element({ position: { x: 20, y: 30 }, rotation: 90 });
  assert.equal(isPixelFillOpaqueAtPoint(rotated, { x: 22, y: 30 }), true);
  assert.equal(isPixelFillOpaqueAtPoint(rotated, { x: 22, y: 31 }), false);
});

test('pixel-fill alpha hit testing maps the visible crop back to source pixels', () => {
  const cropped = element({ crop: { left: 33, top: 0, right: 0, bottom: 0 } });
  assert.equal(isPixelFillOpaqueAtPoint(cropped, { x: 10.25, y: 20.25 }), false);
  assert.equal(isPixelFillOpaqueAtPoint(cropped, { x: 12.25, y: 20.25 }), true);
});

test('non-pixel-fill elements keep their regular geometry hit behavior', () => {
  assert.equal(isPixelFillOpaqueAtPoint(element({ isPixelFill: false }), { x: 11, y: 21 }), true);
});

test('pixel fills report an unknown hit while their alpha mask is unavailable', () => {
  const unavailable = element({ content: 'data:image/png;base64,alpha-mask-not-yet-loaded' });
  assert.equal(isPixelFillOpaqueAtPoint(unavailable, { x: 11, y: 21 }), undefined);
});
