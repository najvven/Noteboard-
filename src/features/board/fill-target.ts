import type { BoardElement, Position } from "../../types";

const distanceToSegment = (point: Position, start: Position, end: Position) => {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared
    ? Math.max(0, Math.min(1, ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared))
    : 0;
  return Math.hypot(point.x - (start.x + t * dx), point.y - (start.y + t * dy));
};

const pointInPolygon = (point: Position, polygon: Position[]) => {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i];
    const b = polygon[j];
    if (
      (a.y > point.y) !== (b.y > point.y) &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
};

/** Hit-test the visible fillable area of one shape in board coordinates. */
export function elementContainsFillTargetPoint(element: BoardElement, point: Position) {
  const width = element.size?.width ?? 100;
  const height = element.size?.height ?? 40;
  if (width <= 0 || height <= 0) return false;

  const centerX = element.position.x + width / 2;
  const centerY = element.position.y + height / 2;
  const angle = (-(element.rotation ?? 0) * Math.PI) / 180;
  const dx = point.x - centerX;
  const dy = point.y - centerY;
  const local = {
    x: width / 2 + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: height / 2 + dx * Math.sin(angle) + dy * Math.cos(angle),
  };

  if (element.type === "line" || element.type === "arrow") {
    const radius = Math.max(4, (element.borderWidth ?? 4) / 2);
    const shaft = distanceToSegment(local, { x: 0, y: height / 2 }, { x: width, y: height / 2 });
    if (shaft <= radius) return true;
    if (element.type === "arrow") {
      const head = Math.min(width * 0.4, height / 2);
      const startX = width - head * 1.5;
      return (
        distanceToSegment(local, { x: startX, y: height / 2 - head }, { x: width, y: height / 2 }) <= radius ||
        distanceToSegment(local, { x: startX, y: height / 2 + head }, { x: width, y: height / 2 }) <= radius
      );
    }
    return false;
  }

  if (element.type === "draw" && element.points?.length) {
    const radius = Math.max(4, (element.borderWidth ?? 4) / 2);
    const points = element.points;
    if (points.length === 1) return Math.hypot(local.x - points[0].x, local.y - points[0].y) <= radius;
    for (let index = 1; index < points.length; index++)
      if (distanceToSegment(local, points[index - 1], points[index]) <= radius) return true;
    return false;
  }

  if (local.x < 0 || local.y < 0 || local.x > width || local.y > height) return false;
  if (element.type === "ellipse") {
    const x = (local.x - width / 2) / (width / 2);
    const y = (local.y - height / 2) / (height / 2);
    return x * x + y * y <= 1;
  }

  const normalized = (points: Position[]) =>
    points.map(({ x, y }) => ({ x: (x / 100) * width, y: (y / 100) * height }));
  if (element.type === "triangle")
    return pointInPolygon(local, normalized([{ x: 50, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }]));
  if (element.type === "diamond")
    return pointInPolygon(local, normalized([{ x: 50, y: 0 }, { x: 100, y: 50 }, { x: 50, y: 100 }, { x: 0, y: 50 }]));
  if (element.type === "hexagon")
    return pointInPolygon(local, normalized([{ x: 25, y: 0 }, { x: 75, y: 0 }, { x: 100, y: 50 }, { x: 75, y: 100 }, { x: 25, y: 100 }, { x: 0, y: 50 }]));

  return true;
}
