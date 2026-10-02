import assert from "node:assert/strict";
import test from "node:test";

import {
  getMinimumAreaRect,
  hasMeaningfulAreaDrag,
  isBoardPlacementSurface,
  shouldPreservePresetPicking,
  resolveAreaDragPoint,
  getBoardPlacementRect,
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

test("selection minimum geometry clips at its active board without moving the anchor", () => {
  assert.deepEqual(
    getMinimumAreaRect(
      { x: 198, y: 98 },
      { x: 198, y: 98 },
      40,
      { minX: 0, minY: 0, maxX: 200, maxY: 100 },
    ),
    { x: 198, y: 98, w: 2, h: 2 },
  );
});

test('grid projection preserves all four drag directions beside a fixed anchor',()=>{
  const start={x:400,y:320};
  const snapPoint=(point:{x:number;y:number})=>({x:Math.round(point.x/40)*40,y:Math.round(point.y/40)*40});
  for(const dx of [-8,8])for(const dy of [-8,8]){
    const resolved=resolveAreaDragPoint(start,{x:start.x+dx,y:start.y+dy},40,snapPoint);
    assert.equal(Math.sign(resolved.x-start.x),Math.sign(dx));assert.equal(Math.sign(resolved.y-start.y),Math.sign(dy));
    const rect=getMinimumAreaRect(start,resolved,40);
    assert.equal(dx<0?rect.x+rect.w:rect.x,start.x);assert.equal(dy<0?rect.y+rect.h:rect.y,start.y);
  }
});

test('proportional preview remains square on either anchor axis and uses identical endpoint geometry',()=>{
  const start={x:400,y:320};
  for(const current of [{x:320,y:320},{x:400,y:240},{x:480,y:320},{x:400,y:400}]){
    const point=resolveAreaDragPoint(start,current,40,undefined,true);
    const rect=getMinimumAreaRect(start,point,40);assert.equal(rect.w,80);assert.equal(rect.h,80);
  }
});

test('small New Board previews keep the default dimensions on every side of their anchor', () => {
  const start = { x: 400, y: 320 };
  for (const dx of [-8, 8]) for (const dy of [-8, 8]) {
    const rect = getBoardPlacementRect(start, { x: start.x + dx, y: start.y + dy }, 40);
    assert.equal(rect.w, 360);
    assert.equal(rect.h, 220);
    assert.equal(dx < 0 ? rect.x + rect.w : rect.x, start.x);
    assert.equal(dy < 0 ? rect.y + rect.h : rect.y, start.y);
  }
  assert.deepEqual(getBoardPlacementRect(start, start, 40), { x: 400, y: 320, w: 360, h: 220 });
});

test('New Board preserves drawn dimensions once both axes exceed its minimum', () => {
  assert.deepEqual(
    getBoardPlacementRect({ x: 400, y: 320 }, { x: 120, y: 100 }, 40),
    { x: 120, y: 100, w: 280, h: 220 },
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
