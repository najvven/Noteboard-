import assert from "node:assert/strict";
import test from "node:test";

import {
  constrainProportionalSize,
  getMediaResizeMinimum,
} from "../src/features/board/resize-geometry.ts";

const assertRatio = (
  size: { width: number; height: number },
  expected: number,
) => {
  assert.ok(
    Math.abs(size.width / size.height - expected) < 1e-10,
    `Expected ${expected}, received ${size.width / size.height}`,
  );
};

test("proportional resize preserves a wide ratio below both minimums", () => {
  const size = constrainProportionalSize({
    width: 1,
    height: 1,
    aspectRatio: 16 / 9,
    minWidth: 24,
    minHeight: 24,
    primaryAxis: "width",
    snap: (value) => Math.round(value / 12) * 12,
  });

  assertRatio(size, 16 / 9);
  assert.ok(size.width >= 24);
  assert.ok(size.height >= 24);
});

test("proportional resize preserves an extreme portrait ratio at minimum size", () => {
  const ratio = 1 / 8;
  const size = constrainProportionalSize({
    width: 0.1,
    height: 0.1,
    aspectRatio: ratio,
    minWidth: 24,
    minHeight: 24,
    primaryAxis: "height",
    snap: (value) => Math.round(value / 8) * 8,
  });

  assertRatio(size, ratio);
  assert.ok(size.width >= 24);
  assert.ok(size.height >= 24);
});

test("only the pointer-driven axis is snapped before deriving its pair", () => {
  const ratio = 3 / 2;
  const fromWidth = constrainProportionalSize({
    width: 137,
    height: 50,
    aspectRatio: ratio,
    minWidth: 8,
    minHeight: 8,
    primaryAxis: "width",
    snap: (value) => Math.round(value / 10) * 10,
  });
  const fromHeight = constrainProportionalSize({
    width: 50,
    height: 83,
    aspectRatio: ratio,
    minWidth: 8,
    minHeight: 8,
    primaryAxis: "height",
    snap: (value) => Math.round(value / 10) * 10,
  });

  assert.deepEqual(fromWidth, { width: 140, height: 140 / ratio });
  assert.deepEqual(fromHeight, { width: 80 * ratio, height: 80 });
  assertRatio(fromWidth, ratio);
  assertRatio(fromHeight, ratio);
});

test("raster media can shrink to pixel dimensions without changing its aspect ratio", () => {
  assert.deepEqual(getMediaResizeMinimum("raster"), { width: 1, height: 1 });
  assert.deepEqual(getMediaResizeMinimum("video"), { width: 180, height: 96 });
  assert.deepEqual(getMediaResizeMinimum("audio"), { width: 320, height: 86 });

  const tallRatio = 64 / 2048;
  const tall = constrainProportionalSize({
    width: 10,
    height: 320,
    aspectRatio: tallRatio,
    minWidth: getMediaResizeMinimum("raster").width,
    minHeight: getMediaResizeMinimum("raster").height,
    primaryAxis: "width",
  });
  assert.deepEqual(tall, { width: 10, height: 320 });
  assertRatio(tall, tallRatio);

  const wideRatio = 3000 / 32;
  const wide = constrainProportionalSize({
    width: 468.75,
    height: 5,
    aspectRatio: wideRatio,
    minWidth: getMediaResizeMinimum("raster").width,
    minHeight: getMediaResizeMinimum("raster").height,
    primaryAxis: "height",
  });
  assert.deepEqual(wide, { width: 468.75, height: 5 });
  assertRatio(wide, wideRatio);
});
