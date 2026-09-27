import type { BoardElement, Position } from "../../types";
import { elementPolygon } from "./section-clipping";

export interface SmartGuide {
  kind: "alignment" | "distance";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label?: string;
}
type Bounds = { left: number; top: number; right: number; bottom: number };
const bounds = (
  element: Pick<BoardElement, "position" | "size" | "rotation">,
): Bounds => {
  const points = elementPolygon(element);
  return {
    left: Math.min(...points.map((p) => p.x)),
    top: Math.min(...points.map((p) => p.y)),
    right: Math.max(...points.map((p) => p.x)),
    bottom: Math.max(...points.map((p) => p.y)),
  };
};
const intersects = (a1: number, a2: number, b1: number, b2: number) =>
  Math.min(a2, b2) >= Math.max(a1, b1);

export function smartGuides(
  moving: BoardElement,
  position: Position,
  others: readonly BoardElement[],
  zoom: number,
  snap: boolean,
) {
  const threshold = 6 / zoom,
    initial = bounds({ ...moving, position });
  const candidates = others
    .filter(
      (element) =>
        element.id !== moving.id &&
        element.type !== "layer" &&
        !element.isEraser,
    )
    .map((element) => bounds(element));
  let bestX: { offset: number; at: number; target: Bounds } | undefined,
    bestY: typeof bestX;
  for (const target of candidates) {
    for (const from of [
      initial.left,
      (initial.left + initial.right) / 2,
      initial.right,
    ])
      for (const to of [
        target.left,
        (target.left + target.right) / 2,
        target.right,
      ]) {
        const offset = to - from;
        if (
          Math.abs(offset) <= threshold &&
          (!bestX || Math.abs(offset) < Math.abs(bestX.offset))
        )
          bestX = { offset, at: to, target };
      }
    for (const from of [
      initial.top,
      (initial.top + initial.bottom) / 2,
      initial.bottom,
    ])
      for (const to of [
        target.top,
        (target.top + target.bottom) / 2,
        target.bottom,
      ]) {
        const offset = to - from;
        if (
          Math.abs(offset) <= threshold &&
          (!bestY || Math.abs(offset) < Math.abs(bestY.offset))
        )
          bestY = { offset, at: to, target };
      }
  }
  const next = {
      x: position.x + (snap ? (bestX?.offset ?? 0) : 0),
      y: position.y + (snap ? (bestY?.offset ?? 0) : 0),
    },
    box = bounds({ ...moving, position: next }),
    guides: SmartGuide[] = [];
  if (bestX)
    guides.push({
      kind: "alignment",
      x1: bestX.at,
      x2: bestX.at,
      y1: Math.min(box.top, bestX.target.top) - 12 / zoom,
      y2: Math.max(box.bottom, bestX.target.bottom) + 12 / zoom,
    });
  if (bestY)
    guides.push({
      kind: "alignment",
      y1: bestY.at,
      y2: bestY.at,
      x1: Math.min(box.left, bestY.target.left) - 12 / zoom,
      x2: Math.max(box.right, bestY.target.right) + 12 / zoom,
    });
  const nearest = new Map<string, { distance: number; guide: SmartGuide }>();
  const offer = (side: string, distance: number, guide: SmartGuide) => {
    if (
      distance > 0 &&
      distance * zoom < 320 &&
      distance < (nearest.get(side)?.distance ?? Infinity)
    )
      nearest.set(side, {
        distance,
        guide: { ...guide, label: `${Math.round(distance * 10) / 10} px` },
      });
  };
  for (const target of candidates) {
    if (intersects(box.top, box.bottom, target.top, target.bottom)) {
      const y =
        (Math.max(box.top, target.top) + Math.min(box.bottom, target.bottom)) /
        2;
      offer("left", box.left - target.right, {
        kind: "distance",
        x1: target.right,
        x2: box.left,
        y1: y,
        y2: y,
      });
      offer("right", target.left - box.right, {
        kind: "distance",
        x1: box.right,
        x2: target.left,
        y1: y,
        y2: y,
      });
    }
    if (intersects(box.left, box.right, target.left, target.right)) {
      const x =
        (Math.max(box.left, target.left) + Math.min(box.right, target.right)) /
        2;
      offer("top", box.top - target.bottom, {
        kind: "distance",
        x1: x,
        x2: x,
        y1: target.bottom,
        y2: box.top,
      });
      offer("bottom", target.top - box.bottom, {
        kind: "distance",
        x1: x,
        x2: x,
        y1: box.bottom,
        y2: target.top,
      });
    }
  }
  return {
    position: next,
    guides: [...guides, ...[...nearest.values()].map((value) => value.guide)],
  };
}
