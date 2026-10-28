import type { BoardElement, Position } from "../../types";
import { elementPolygon } from "./section-clipping";

export interface GuideSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}
export interface SmartGuide extends GuideSegment {
  kind: "alignment" | "distance" | "ratio" | "angle";
  label?: string;
  color?: string;
  extensions?: GuideSegment[];
  equalSpacing?: boolean;
}
export interface SmartGuideOptions {
  density?: "low" | "mid" | "high";
  alignment?: boolean;
  distances?: boolean;
  ratios?: boolean;
  angles?: boolean;
}
type Bounds = { left: number; top: number; right: number; bottom: number };
type GuideTarget = Bounds & { id: string; measure: boolean; color: string };
const GUIDE_COLORS = ["#2563eb", "#d946b5", "#16a34a", "#f97316", "#0891b2", "#7c3aed", "#ca8a04", "#e11d48"];
const guideColor = (id: string) => {
  let hash = 0;
  for (let index = 0; index < id.length; index += 1)
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0;
  return GUIDE_COLORS[hash % GUIDE_COLORS.length];
};
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
  options: SmartGuideOptions = {},
) {
  zoom = Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  const density = options.density ?? "mid";
  const threshold = ({ low: 4, mid: 6, high: 10 }[density]) / zoom;
  const alignmentLimit = ({ low: 1, mid: 4, high: 10 }[density]);
  const distanceLimit = ({ low: 1, mid: 3, high: 8 }[density]);
  const ratioLimit = ({ low: 1, mid: 3, high: 8 }[density]);
  const initial = bounds({ ...moving, position });
  const candidates = others
    .filter(
      (element) =>
        element.id !== moving.id &&
        element.type !== "layer" &&
        !element.isEraser,
    )
    .map((element) => ({
      ...bounds(element),
      id: element.id,
      measure: element.type !== "board",
      color: guideColor(element.id),
    }));
  const separation = (a1: number, a2: number, b1: number, b2: number) =>
    Math.max(0, b1 - a2, a1 - b2);
  const proximity = (target: Bounds) => Math.hypot(
    separation(initial.left,initial.right,target.left,target.right),
    separation(initial.top,initial.bottom,target.top,target.bottom),
  );
  type AlignmentMatch = { offset: number; at: number; target: GuideTarget; proximity: number };
  let bestX: AlignmentMatch | undefined, bestY: AlignmentMatch | undefined;
  const alignmentMatchesX: AlignmentMatch[] = [];
  const alignmentMatchesY: AlignmentMatch[] = [];
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
        if (Math.abs(offset) <= threshold) {
          const match = { offset, at: to, target, proximity: proximity(target) };
          alignmentMatchesX.push(match);
          if (!bestX || Math.abs(offset) < Math.abs(bestX.offset) ||
            Math.abs(offset) === Math.abs(bestX.offset) && match.proximity < bestX.proximity)
            bestX = match;
        }
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
        if (Math.abs(offset) <= threshold) {
          const match = { offset, at: to, target, proximity: proximity(target) };
          alignmentMatchesY.push(match);
          if (!bestY || Math.abs(offset) < Math.abs(bestY.offset) ||
            Math.abs(offset) === Math.abs(bestY.offset) && match.proximity < bestY.proximity)
            bestY = match;
        }
      }
  }
  const next = {
      x: position.x + (snap ? (bestX?.offset ?? 0) : 0),
      y: position.y + (snap ? (bestY?.offset ?? 0) : 0),
    },
    box = bounds({ ...moving, position: next }),
    guides: SmartGuide[] = [];
  const chooseAlignmentGuides = (matches: AlignmentMatch[]) => matches
    .sort((left, right) => Math.abs(left.offset) - Math.abs(right.offset) || left.proximity - right.proximity)
    .filter((match, index, all) => all.findIndex(candidate =>
      candidate.target.id === match.target.id && Math.abs(candidate.at - match.at) < 0.05) === index)
    .slice(0, alignmentLimit);
  if (options.alignment !== false) {
    for (const match of chooseAlignmentGuides(alignmentMatchesX))
      guides.push({
        kind: "alignment",
        color: match.target.color,
        x1: match.at,
        x2: match.at,
        y1: Math.min(box.top, match.target.top) - 12 / zoom,
        y2: Math.max(box.bottom, match.target.bottom) + 12 / zoom,
      });
    for (const match of chooseAlignmentGuides(alignmentMatchesY))
      guides.push({
        kind: "alignment",
        color: match.target.color,
        y1: match.at,
        y2: match.at,
        x1: Math.min(box.left, match.target.left) - 12 / zoom,
        x2: Math.max(box.right, match.target.right) + 12 / zoom,
      });
  }
  type DistanceMatch = { distance: number; score: number; targetId: string; guide: SmartGuide };
  const nearest = new Map<string, DistanceMatch>();
  const distanceMatches = new Map<string, DistanceMatch[]>();
  const offer = (side: string, target: GuideTarget, distance: number, perpendicular: number, guide: SmartGuide) => {
    const score = Math.hypot(distance, perpendicular);
    const roundedDistance = Math.round(distance * 10) / 10;
    if (roundedDistance <= 0) return;
    const match: DistanceMatch = {
      distance,
      score,
      targetId: target.id,
      guide: { ...guide, color: target.color, label: `${roundedDistance} px` },
    };
    const matches = distanceMatches.get(side) ?? [];
    matches.push(match);
    distanceMatches.set(side, matches);
    if (score < (nearest.get(side)?.score ?? Infinity)) nearest.set(side, match);
  };
  if (options.distances !== false) for (const target of candidates) {
    if (!target.measure) continue;
    {
      const overlap = intersects(box.top, box.bottom, target.top, target.bottom);
      const y = overlap ?
        (Math.max(box.top, target.top) + Math.min(box.bottom, target.bottom)) /
        2 : (box.top + box.bottom) / 2;
      const targetY = Math.max(target.top, Math.min(target.bottom, y));
      const perpendicular = separation(box.top, box.bottom, target.top, target.bottom);
      offer("left", target, box.left - target.right, perpendicular, {
        kind: "distance",
        x1: target.right,
        x2: box.left,
        y1: y,
        y2: y,
        extensions: overlap ? [] : [{x1:target.right,y1:targetY,x2:target.right,y2:y}],
      });
      offer("right", target, target.left - box.right, perpendicular, {
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
      offer("top", target, box.top - target.bottom, perpendicular, {
        kind: "distance",
        x1: x,
        x2: x,
        y1: target.bottom,
        y2: box.top,
        extensions: overlap ? [] : [{x1:targetX,y1:target.bottom,x2:x,y2:target.bottom}],
      });
      offer("bottom", target, target.top - box.bottom, perpendicular, {
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
      const relationshipColor = guideColor([moving.id, first.targetId, second.targetId].sort().join(":"));
      first.guide.color = second.guide.color = relationshipColor;
    }
  }
  const visibleDistanceGuides = [...distanceMatches.values()].flatMap((matches) =>
    matches
      .sort((left, right) => left.score - right.score)
      .slice(0, distanceLimit)
      .map((match) => match.guide),
  );
  if (options.ratios) {
    const nearbyRatioTargets = candidates
      .filter((candidate) => candidate.measure)
      .map((candidate) => ({ candidate, score: proximity(candidate) }))
      .filter(({ score }) => score <= 72 / zoom)
      .sort((left, right) => left.score - right.score)
      .slice(0, ratioLimit);
    for (const [index, { candidate }] of nearbyRatioTargets.entries()) {
      const widthRatio = (box.right - box.left) / Math.max(0.001, candidate.right - candidate.left);
      const heightRatio = (box.bottom - box.top) / Math.max(0.001, candidate.bottom - candidate.top);
      const formatRatio = (ratio: number) => `${Math.round(ratio * 100) / 100}×`;
      const y = box.top - (14 + index * 12) / zoom;
      guides.push({
        kind: "ratio",
        color: candidate.color,
        x1: box.left,
        x2: box.right,
        y1: y,
        y2: y,
        label: `W ${formatRatio(widthRatio)} · H ${formatRatio(heightRatio)}`,
      });
    }
  }
  if (options.angles) {
    const movingCenter = { x: (box.left + box.right) / 2, y: (box.top + box.bottom) / 2 };
    const nearby = candidates
      .filter((candidate) => candidate.measure)
      .map((candidate) => ({
        candidate,
        center: { x: (candidate.left + candidate.right) / 2, y: (candidate.top + candidate.bottom) / 2 },
      }))
      .map((item) => ({ ...item, distance: Math.hypot(item.center.x - movingCenter.x, item.center.y - movingCenter.y) }))
      .filter(({ distance }) => distance > 0 && distance <= ({ low: 60, mid: 100, high: 150 }[options.density ?? "mid"]) / zoom)
      .sort((left, right) => left.distance - right.distance)
      .slice(0, ratioLimit);
    for (const nearbyTarget of nearby) {
      const nearby = nearbyTarget;
      const angle = (Math.round((Math.atan2(nearby.center.y - movingCenter.y, nearby.center.x - movingCenter.x) * 180 / Math.PI) + 360) % 360);
      guides.push({
        kind: "angle",
        color: nearby.candidate.color,
        x1: movingCenter.x,
        y1: movingCenter.y,
        x2: nearby.center.x,
        y2: nearby.center.y,
        label: `${angle}°`,
      });
    }
  }
  return {
    position: next,
    guides: [...guides, ...visibleDistanceGuides],
  };
}
