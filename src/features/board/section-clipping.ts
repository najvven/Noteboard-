import type { BoardElement, Position } from '../../types';
import { createElementHierarchy, type ElementHierarchy } from './element-hierarchy';

type Polygon = Position[];
const cross = (a: Position, b: Position, p: Position) => (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);

export function elementPolygon(element: Pick<BoardElement, 'position' | 'size' | 'rotation'>): Polygon {
  const w = element.size?.width ?? 100;
  const h = element.size?.height ?? 40;
  const angle = (element.rotation ?? 0) * Math.PI / 180;
  return [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }].map(p => ({
    x: element.position.x + w / 2 + (p.x - w / 2) * Math.cos(angle) - (p.y - h / 2) * Math.sin(angle),
    y: element.position.y + h / 2 + (p.x - w / 2) * Math.sin(angle) + (p.y - h / 2) * Math.cos(angle),
  }));
}

export const pointInPolygon = (point: Position, polygon: Polygon) => polygon.length > 2 && polygon.every((a, i) => cross(a, polygon[(i + 1) % polygon.length], point) >= -0.00001);

function halfPlane(polygon: Polygon, a: Position, b: Position, inside: boolean): Polygon {
  const result: Polygon = [];
  for (let i = 0; i < polygon.length; i++) {
    const p = polygon[i], q = polygon[(i + 1) % polygon.length];
    const dp = cross(a, b, p), dq = cross(a, b, q);
    const pin = inside ? dp >= 0 : dp <= 0;
    const qin = inside ? dq >= 0 : dq <= 0;
    if (pin) result.push(p);
    if (pin !== qin) {
      const t = dp / (dp - dq);
      result.push({ x: p.x + t * (q.x - p.x), y: p.y + t * (q.y - p.y) });
    }
  }
  return result;
}

function intersect(subject: Polygon, clip: Polygon) {
  return clip.reduce((result, a, i) => halfPlane(result, a, clip[(i + 1) % clip.length], true), subject);
}

function subtract(subject: Polygon, clip: Polygon): Polygon[] {
  let remaining = subject;
  const pieces: Polygon[] = [];
  for (let i = 0; i < clip.length && remaining.length; i++) {
    const a = clip[i], b = clip[(i + 1) % clip.length];
    const outside = halfPlane(remaining, a, b, false);
    if (outside.length > 2) pieces.push(outside);
    remaining = halfPlane(remaining, a, b, true);
  }
  return pieces;
}

export function getPlacementSection(point: Position, elements: readonly BoardElement[]): BoardElement | undefined {
  const hierarchy = createElementHierarchy(elements);
  return elements.filter(e => e.type === 'section' && hierarchy.isVisible(e.id, true) && pointInPolygon(point, elementPolygon(e)))
    .sort((a, b) => hierarchy.compare(b, a))[0];
}

/** Persisted parentage determines the inside/outside rule, never the moving center. */
export function getSectionVisiblePolygons(element: BoardElement, elements: readonly BoardElement[], base = elementPolygon(element), sceneHierarchy?: ElementHierarchy): Polygon[] {
  if (element.type === 'board' || element.type === 'layer') return [base];
  if (!elements.some(candidate => candidate.type === 'section')) return [base];
  const hierarchy = sceneHierarchy ?? createElementHierarchy([...elements.filter(e => e.id !== element.id), element]);
  const byId = hierarchy.byId;
  const parents = new Set<string>();
  let parentId = element.parentId;
  while (parentId && !parents.has(parentId)) {
    parents.add(parentId);
    parentId = byId.get(parentId)?.parentId;
  }
  let polygons = [base];
  for (const section of elements) {
    if (section.type !== 'section' || section.id === element.id || !hierarchy.isVisible(section.id, true)) continue;
    // A child section belongs to its parent's contents; it must not cut a hole
    // in the parent's own visible geometry.
    if (hierarchy.isDescendantOf(section.id, element.id)) continue;
    const boundary = elementPolygon(section);
    if (parents.has(section.id)) {
      polygons = polygons.map(p => intersect(p, boundary)).filter(p => p.length > 2);
    } else if (hierarchy.compare(section, element) < 0) {
      polygons = polygons.flatMap(p => subtract(p, boundary));
    }
  }
  return polygons;
}

export function isPointInVisibleElementArea(
  element: BoardElement,
  elements: readonly BoardElement[],
  point: Position,
  base = elementPolygon(element),
  sceneHierarchy?: ElementHierarchy,
) {
  return getSectionVisiblePolygons(element, elements, base, sceneHierarchy)
    .some(polygon => pointInPolygon(point, polygon));
}

export function getSectionClipPath(element: BoardElement, elements: readonly BoardElement[], base?: Polygon, sceneHierarchy?: ElementHierarchy): string {
  const polygons = getSectionVisiblePolygons(element, elements, base, sceneHierarchy);
  const width = element.size?.width ?? 100, height = element.size?.height ?? 40;
  const angle = -(element.rotation ?? 0) * Math.PI / 180;
  const local = (p: Position) => {
    const x = p.x - element.position.x - width / 2, y = p.y - element.position.y - height / 2;
    const localX = width / 2 + x * Math.cos(angle) - y * Math.sin(angle);
    const localY = height / 2 + x * Math.sin(angle) + y * Math.cos(angle);
    return `${(element.flipX ? width - localX : localX).toFixed(3)} ${(element.flipY ? height - localY : localY).toFixed(3)}`;
  };
  return `path("${polygons.map(p => `M ${p.map(local).join(' L ')} Z`).join(' ') || 'M 0 0 Z'}")`;
}
