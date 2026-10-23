import type { BoardElement, Position } from "../../types";
import { elementPolygon } from "./section-clipping";

export interface GuideSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export interface SmartGuide extends GuideSegment {
  kind: "alignment" | "distance";
  label?: string;
  extensions?: GuideSegment[];
  equalSpacing?: boolean;
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
  zoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const threshold = 6 / zoom,
    initial = bounds({ ...moving, position });
  const candidates = others
    .filter(
      (element) =>
        element.id !== moving.id &&
        element.type !== "layer" &&
        !element.isEraser,
    )
    .map((element) => ({...bounds(element), measure: element.type !== "board"}));
  const separation = (a1: number, a2: number, b1: number, b2: number) =>
    Math.max(0, b1 - a2, a1 - b2);
  const proximity = (target: Bounds) => Math.hypot(
    separation(initial.left,initial.right,target.left,target.right),
    separation(initial.top,initial.bottom,target.top,target.bottom),
  );
  let bestX: { offset: number; at: number; target: Bounds; proximity: number } | undefined,
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
          (!bestX || Math.abs(offset) < Math.abs(bestX.offset) ||
            Math.abs(offset) === Math.abs(bestX.offset) && proximity(target) < bestX.proximity)
        )
          bestX = { offset, at: to, target, proximity: proximity(target) };
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
          (!bestY || Math.abs(offset) < Math.abs(bestY.offset) ||
            Math.abs(offset) === Math.abs(bestY.offset) && proximity(target) < bestY.proximity)
        )
          bestY = { offset, at: to, target, proximity: proximity(target) };
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
  const nearest = new Map<string, { distance: number; score: number; guide: SmartGuide }>();
  const offer = (side: string, distance: number, perpendicular: number, guide: SmartGuide) => {
    const score = Math.hypot(distance, perpendicular);
    if (
      distance > 0 &&
      score < (nearest.get(side)?.score ?? Infinity)
    )
      nearest.set(side, {
        distance,
        score,
        guide: { ...guide, label: `${Math.round(distance * 10) / 10} px` },
      });
  };
  for (const target of candidates) {
    if (!target.measure) continue;
    {
      const overlap = intersects(box.top, box.bottom, target.top, target.bottom);
      const y = overlap ?
        (Math.max(box.top, target.top) + Math.min(box.bottom, target.bottom)) /
        2 : (box.top + box.bottom) / 2;
      const targetY = Math.max(target.top, Math.min(target.bottom, y));
      const perpendicular = separation(box.top, box.bottom, target.top, target.bottom);
      offer("left", box.left - target.right, perpendicular, {
        kind: "distance",
        x1: target.right,
        x2: box.left,
        y1: y,
        y2: y,
        extensions: overlap ? [] : [{x1:target.right,y1:targetY,x2:target.right,y2:y}],
      });
      offer("right", target.left - box.right, perpendicular, {
        kind: "distance",
        x1: box.right,
        x2: target.left,
        y1: y,
        y2: y,
        extensions: overlap ? [] : [{x1:target.left,y1:targetY,x2:target.left,y2:y}],
      });
    }
    {
      const overlap = intersects(box.left, box.right, target.left, target.right);
      const x = overlap ?
        (Math.max(box.left, target.left) + Math.min(box.right, target.right)) /
        2 : (box.left + box.right) / 2;
      const targetX = Math.max(target.left, Math.min(target.right, x));
      const perpendicular = separation(box.left, box.right, target.left, target.right);
      offer("top", box.top - target.bottom, perpendicular, {
        kind: "distance",
        x1: x,
        x2: x,
        y1: target.bottom,
        y2: box.top,
        extensions: overlap ? [] : [{x1:targetX,y1:target.bottom,x2:x,y2:target.bottom}],
      });
      offer("bottom", target.top - box.bottom, perpendicular, {
        kind: "distance",
        x1: x,
        x2: x,
        y1: box.bottom,
        y2: target.top,
        extensions: overlap ? [] : [{x1:targetX,y1:target.top,x2:x,y2:target.top}],
      });
    }
  }
  for (const [a,b] of [["left","right"],["top","bottom"]]) {
    const first = nearest.get(a), second = nearest.get(b);
    if (first && second && Math.abs(first.distance - second.distance) < 0.05 &&
      !first.guide.extensions?.length && !second.guide.extensions?.length) {
      first.guide.equalSpacing = second.guide.equalSpacing = true;
    }
  }
  return {
    position: next,
    guides: [...guides, ...[...nearest.values()].map((value) => value.guide)],
  };
}
