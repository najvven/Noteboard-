import type { BoardElement, Position } from "../../types";
import { createElementHierarchy } from "./element-hierarchy";
import { elementPolygon, getSectionVisiblePolygons } from "./section-clipping";

const cross = (a: Position, b: Position, p: Position) =>
  (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
const onSegment = (a: Position, b: Position, p: Position) =>
  Math.abs(cross(a, b, p)) < 1e-7 &&
  p.x >= Math.min(a.x, b.x) - 1e-7 &&
  p.x <= Math.max(a.x, b.x) + 1e-7 &&
  p.y >= Math.min(a.y, b.y) - 1e-7 &&
  p.y <= Math.max(a.y, b.y) + 1e-7;

/** Even-odd containment also handles concave and self-crossing lasso outlines. */
export function insideSelection(point: Position, polygon: readonly Position[]) {
  if (polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j],
      b = polygon[i];
    if (onSegment(a, b, point)) return true;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}

function intersects(a: Position, b: Position, c: Position, d: Position) {
  if (
    onSegment(a, b, c) ||
    onSegment(a, b, d) ||
    onSegment(c, d, a) ||
    onSegment(c, d, b)
  )
    return true;
  return (
    cross(a, b, c) * cross(a, b, d) < 0 && cross(c, d, a) * cross(c, d, b) < 0
  );
}

export function outlinesIntersect(
  a: readonly Position[],
  b: readonly Position[],
) {
  if (a.length < 3 || b.length < 3) return false;
  if (
    a.some((point) => insideSelection(point, b)) ||
    b.some((point) => insideSelection(point, a))
  )
    return true;
  return a.some((p, i) =>
    b.some((q, j) =>
      intersects(p, a[(i + 1) % a.length], q, b[(j + 1) % b.length]),
    ),
  );
}

export function selectElementsInOutline(
  elements: readonly BoardElement[],
  outline: readonly Position[],
  respectVisibility = true,
) {
  if (outline.length < 3) return [];
  const hierarchy = createElementHierarchy(elements);
  return elements
    .filter(
      (element) =>
        element.type !== "board" &&
        element.type !== "layer" &&
        !element.isEraser &&
        !hierarchy.isLocked(element.id) &&
        hierarchy.isVisible(element.id, respectVisibility),
    )
    .filter((element) =>
      getSectionVisiblePolygons(
        element,
        elements,
        elementPolygon(element),
        hierarchy,
      ).some((polygon) => outlinesIntersect(outline, polygon)),
    )
    .map((element) => element.id);
}

export type SelectionOperation = "replace" | "add" | "subtract";
export function combineSelection(
  previous: readonly string[],
  found: readonly string[],
  operation: SelectionOperation,
) {
  if (operation === "replace") return [...found];
  const hits = new Set(found);
  return operation === "subtract"
    ? previous.filter((id) => !hits.has(id))
    : [...new Set([...previous, ...found])];
}

export function selectedBounds(
  elements: readonly BoardElement[],
  ids: readonly string[],
) {
  const selected = new Set(ids);
  let x = Infinity,
    y = Infinity,
    right = -Infinity,
    bottom = -Infinity;
  for (const element of elements) {
    if (!selected.has(element.id)) continue;
    for (const point of elementPolygon(element)) {
      x = Math.min(x, point.x);
      y = Math.min(y, point.y);
      right = Math.max(right, point.x);
      bottom = Math.max(bottom, point.y);
    }
  }
  return Number.isFinite(x)
    ? { x, y, width: right - x, height: bottom - y }
    : null;
}
