import assert from "node:assert/strict";
import test from "node:test";
import { fillConnectedPixels } from "../src/features/board/pixel-fill";

const raster = (width: number, height: number, color: [number, number, number, number]) => {
  const pixels = new Uint8ClampedArray(width * height * 4);
  for (let offset = 0; offset < pixels.length; offset += 4) pixels.set(color, offset);
  return pixels;
};
const at = (pixels: Uint8ClampedArray, width: number, x: number, y: number) =>
  [...pixels.slice((y * width + x) * 4, (y * width + x) * 4 + 4)];

test("fills the visible closed interior and leaves its outline transparent in the new fill layer", () => {
  const pixels = raster(7, 7, [255, 255, 255, 255]);
  for (let x = 1; x <= 5; x++) {
    pixels.set([0, 0, 0, 255], (1 * 7 + x) * 4);
    pixels.set([0, 0, 0, 255], (5 * 7 + x) * 4);
  }
  for (let y = 1; y <= 5; y++) {
    pixels.set([0, 0, 0, 255], (y * 7 + 1) * 4);
    pixels.set([0, 0, 0, 255], (y * 7 + 5) * 4);
  }

  const result = fillConnectedPixels(pixels, 7, 7, 3, 3, "#ff0000");
  assert.deepEqual(result, {
    filledPixels: 9,
    bounds: { x: 2, y: 2, width: 3, height: 3 },
    touchesEdge: false,
  });
  assert.deepEqual(at(pixels, 7, 3, 3), [255, 0, 0, 255]);
  assert.deepEqual(at(pixels, 7, 1, 3), [0, 0, 0, 0]);
  assert.deepEqual(at(pixels, 7, 0, 0), [255, 255, 255, 0]);
});

test("tolerance follows anti-aliased interior pixels without crossing a contrasting outline", () => {
  const pixels = raster(5, 5, [255, 255, 255, 255]);
  for (let y = 1; y < 4; y++) {
    for (let x = 1; x < 4; x++) pixels.set([244, 244, 244, 255], (y * 5 + x) * 4);
  }
  for (let i = 0; i < 5; i++) {
    pixels.set([0, 0, 0, 255], (0 * 5 + i) * 4);
    pixels.set([0, 0, 0, 255], (4 * 5 + i) * 4);
    pixels.set([0, 0, 0, 255], (i * 5) * 4);
    pixels.set([0, 0, 0, 255], (i * 5 + 4) * 4);
  }
  const result = fillConnectedPixels(pixels, 5, 5, 2, 2, "#00ff00", 18);
  assert.equal(result?.filledPixels, 9);
  assert.deepEqual(at(pixels, 5, 2, 2), [0, 255, 0, 255]);
  assert.deepEqual(at(pixels, 5, 0, 2), [0, 0, 0, 0]);
});

test("reports a region that reaches the captured view edge", () => {
  const pixels = raster(4, 3, [230, 230, 230, 255]);
  pixels.set([0, 0, 0, 255], (1 * 4 + 2) * 4);
  const result = fillConnectedPixels(pixels, 4, 3, 0, 0, "#123456");
  assert.equal(result?.touchesEdge, true);
  assert.equal(result?.filledPixels, 11);
});

test("invalid seeds, transparent pixels and an unchanged fill color do not create a mask", () => {
  const pixels = raster(2, 2, [255, 255, 255, 255]);
  assert.equal(fillConnectedPixels(pixels, 2, 2, -1, 0, "#000000"), null);
  assert.equal(fillConnectedPixels(pixels, 2, 2, 0, 0, "#ffffff"), null);
  assert.equal(fillConnectedPixels(pixels, 2, 2, 0, 0, "rgb(0,0,0)"), null);
  pixels[3] = 0;
  assert.equal(fillConnectedPixels(pixels, 2, 2, 0, 0, "#000000"), null);
});
