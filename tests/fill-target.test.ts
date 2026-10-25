import test from "node:test";
import assert from "node:assert/strict";
import { elementContainsFillTargetPoint } from "../src/features/board/fill-target";
import type { BoardElement } from "../src/types";

const shape = (type: BoardElement["type"], extra: Partial<BoardElement> = {}): BoardElement => ({
  id: "shape",
  type,
  position: { x: 100, y: 80 },
  size: { width: 100, height: 100 },
  content: "",
  zIndex: 1,
  ...extra,
});

test("fill targeting uses the rotated object box", () => {
  const rectangle = shape("rectangle", { rotation: 45 });
  assert.equal(elementContainsFillTargetPoint(rectangle, { x: 150, y: 130 }), true);
  assert.equal(elementContainsFillTargetPoint(rectangle, { x: 100, y: 80 }), false);
});

test("ellipse and polygon fill targets exclude points outside their visible shapes", () => {
  const ellipse = shape("ellipse");
  assert.equal(elementContainsFillTargetPoint(ellipse, { x: 150, y: 130 }), true);
  assert.equal(elementContainsFillTargetPoint(ellipse, { x: 101, y: 81 }), false);

  const triangle = shape("triangle");
  assert.equal(elementContainsFillTargetPoint(triangle, { x: 150, y: 155 }), true);
  assert.equal(elementContainsFillTargetPoint(triangle, { x: 101, y: 81 }), false);
});

test("line and freehand targets select only their visible stroke", () => {
  const line = shape("line", { size: { width: 120, height: 20 }, borderWidth: 8 });
  assert.equal(elementContainsFillTargetPoint(line, { x: 150, y: 90 }), true);
  assert.equal(elementContainsFillTargetPoint(line, { x: 150, y: 100 }), false);

  const draw = shape("draw", {
    points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }],
    borderWidth: 8,
  });
  assert.equal(elementContainsFillTargetPoint(draw, { x: 150, y: 80 }), true);
  assert.equal(elementContainsFillTargetPoint(draw, { x: 150, y: 130 }), false);
});
