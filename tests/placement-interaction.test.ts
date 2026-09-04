import assert from "node:assert/strict";
import test from "node:test";

import {
  getMinimumAreaRect,
  hasMeaningfulAreaDrag,
  isBoardPlacementSurface,
  shouldPreservePresetPicking,
} from "../src/features/board/placement-interaction.ts";

test("a delayed selection starts as one board cell in every drag direction", () => {
  assert.deepEqual(
    getMinimumAreaRect({ x: 120, y: 80 }, { x: 120, y: 80 }, 40),
    { x: 120, y: 80, w: 40, h: 40 },
  );
  assert.deepEqual(
    getMinimumAreaRect({ x: 120, y: 80 }, { x: 112, y: 75 }, 40),
    { x: 80, y: 40, w: 40, h: 40 },
  );
});

test("selection minimum geometry stays inside its active board", () => {
  assert.deepEqual(
    getMinimumAreaRect(
      { x: 198, y: 98 },
      { x: 198, y: 98 },
      40,
      { minX: 0, minY: 0, maxX: 200, maxY: 100 },
    ),
    { x: 160, y: 60, w: 40, h: 40 },
  );
});

test("secondary boards remain valid placement surfaces without drawing through elements", () => {
  assert.equal(
    isBoardPlacementSurface({
      hasBoardSurfaceMarker: true,
      isElementTarget: true,
      isSecondaryBoardSurface: true,
    }),
    true,
  );
  assert.equal(
    isBoardPlacementSurface({
      hasBoardSurfaceMarker: true,
      isElementTarget: true,
      isSecondaryBoardSurface: false,
    }),
    false,
  );
  assert.equal(
    isBoardPlacementSurface({
      hasBoardSurfaceMarker: true,
      isElementTarget: false,
      isSecondaryBoardSurface: false,
    }),
    true,
  );
});

test("preset picking survives only the primary click that can complete it", () => {
  assert.equal(
    shouldPreservePresetPicking({
      hasActivePreset: true,
      isPrimaryPointer: true,
      isElementTarget: true,
    }),
    true,
  );
  assert.equal(
    shouldPreservePresetPicking({
      hasActivePreset: true,
      isPrimaryPointer: true,
      isElementTarget: false,
    }),
    false,
  );
  assert.equal(
    shouldPreservePresetPicking({
      hasActivePreset: true,
      isPrimaryPointer: false,
      isElementTarget: true,
    }),
    false,
  );
});

test("a click with no movement is not an area drag", () => {
  assert.equal(hasMeaningfulAreaDrag({ x: 12, y: 8 }, { x: 12, y: 8 }), false);
  assert.equal(
    hasMeaningfulAreaDrag({ x: 12, y: 8 }, { x: 12, y: 8 }, 0),
    false,
  );
});

test("axis movement below the default threshold is ignored", () => {
  assert.equal(hasMeaningfulAreaDrag({ x: 0, y: 0 }, { x: 3, y: 0 }), false);
  assert.equal(hasMeaningfulAreaDrag({ x: 0, y: 0 }, { x: 0, y: -3.99 }), false);
});

test("axis movement at or above the threshold is accepted", () => {
  assert.equal(hasMeaningfulAreaDrag({ x: 0, y: 0 }, { x: 4, y: 0 }), true);
  assert.equal(hasMeaningfulAreaDrag({ x: 0, y: 0 }, { x: 0, y: -8 }), true);
});

test("diagonal movement uses Euclidean distance", () => {
  assert.equal(hasMeaningfulAreaDrag({ x: 10, y: 10 }, { x: 13, y: 13 }), true);
  assert.equal(hasMeaningfulAreaDrag({ x: 10, y: 10 }, { x: 12, y: 12 }), false);
});

test("the threshold is configurable and inclusive", () => {
  assert.equal(
    hasMeaningfulAreaDrag({ x: 0, y: 0 }, { x: 5, y: 0 }, 5),
    true,
  );
  assert.equal(
    hasMeaningfulAreaDrag({ x: 0, y: 0 }, { x: 5, y: 0 }, 6),
    false,
  );
  assert.equal(
    hasMeaningfulAreaDrag({ x: 0, y: 0 }, { x: 0.5, y: 0 }, 0),
    true,
  );
});

test("invalid points and thresholds never count as an area drag", () => {
  const valid = { x: 20, y: 20 };
  assert.equal(hasMeaningfulAreaDrag({ x: Number.NaN, y: 0 }, valid), false);
  assert.equal(hasMeaningfulAreaDrag({ x: 0, y: Number.POSITIVE_INFINITY }, valid), false);
  assert.equal(hasMeaningfulAreaDrag(valid, { x: Number.NEGATIVE_INFINITY, y: 0 }), false);
  assert.equal(hasMeaningfulAreaDrag(valid, { x: 0, y: Number.NaN }), false);
  assert.equal(hasMeaningfulAreaDrag(valid, { x: 30, y: 30 }, Number.NaN), false);
  assert.equal(hasMeaningfulAreaDrag(valid, { x: 30, y: 30 }, Number.POSITIVE_INFINITY), false);
  assert.equal(hasMeaningfulAreaDrag(valid, { x: 30, y: 30 }, -1), false);
  assert.equal(hasMeaningfulAreaDrag(null, valid), false);
  assert.equal(hasMeaningfulAreaDrag(valid, undefined), false);
});
