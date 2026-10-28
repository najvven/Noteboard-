export type DrawingPoint = { x: number; y: number };

export type GuessedDrawingShape = {
  type: "diamond" | "ellipse" | "hexagon" | "rectangle" | "triangle";
  square?: boolean;
};

const distance = (a: DrawingPoint, b: DrawingPoint) =>
  Math.hypot(a.x - b.x, a.y - b.y);

function pointSegmentDistance(point: DrawingPoint, start: DrawingPoint, end: DrawingPoint) {
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return distance(point, start);
  const progress = Math.max(0, Math.min(1,
    ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared,
  ));
  return distance(point, { x: start.x + progress * dx, y: start.y + progress * dy });
}

function getClosedVertices(outline: readonly DrawingPoint[], minimumGap: number) {
  const vertices: DrawingPoint[] = [];
  for (const point of outline) {
    const previous = vertices.at(-1);
    if (!previous || distance(previous, point) > minimumGap) vertices.push(point);
  }
  if (vertices.length > 2 && distance(vertices[0], vertices.at(-1)!) <= minimumGap * 2)
    vertices.pop();

  // Simplification can leave extra points on a straight edge. Remove those
  // before counting vertices so an ordinary rectangle does not look like a
  // higher-sided polygon just because the stroke was sampled densely.
  let removedPoint = true;
  while (removedPoint && vertices.length > 3) {
    removedPoint = false;
    for (let index = 0; index < vertices.length; index++) {
      const previous = vertices[(index + vertices.length - 1) % vertices.length];
      const current = vertices[index];
      const next = vertices[(index + 1) % vertices.length];
      if (pointSegmentDistance(current, previous, next) <= minimumGap) {
        vertices.splice(index, 1);
        removedPoint = true;
        break;
      }
    }
  }
  return vertices;
}

function isConvexPolygon(vertices: readonly DrawingPoint[]) {
  if (vertices.length < 3) return false;
  let direction = 0;
  for (let index = 0; index < vertices.length; index++) {
    const a = vertices[index];
    const b = vertices[(index + 1) % vertices.length];
    const c = vertices[(index + 2) % vertices.length];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cross) < 1e-4) continue;
    const nextDirection = Math.sign(cross);
    if (direction && nextDirection !== direction) return false;
    direction = nextDirection;
  }
  return direction !== 0;
}

function polygonArea(vertices: readonly DrawingPoint[]) {
  let area = 0;
  for (let index = 0; index < vertices.length; index++) {
    const current = vertices[index];
    const next = vertices[(index + 1) % vertices.length];
    area += current.x * next.y - next.x * current.y;
  }
  return Math.abs(area) / 2;
}

function polygonFitError(points: readonly DrawingPoint[], vertices: readonly DrawingPoint[], scale: number) {
  let maximumError = 0;
  for (const point of points) {
    let nearestEdge = Infinity;
    for (let index = 0; index < vertices.length; index++) {
      nearestEdge = Math.min(
        nearestEdge,
        pointSegmentDistance(point, vertices[index], vertices[(index + 1) % vertices.length]),
      );
    }
    maximumError = Math.max(maximumError, nearestEdge);
  }
  return maximumError / Math.max(1, scale);
}

function interiorAngles(vertices: readonly DrawingPoint[]) {
  return vertices.map((point, index) => {
    const previous = vertices[(index + vertices.length - 1) % vertices.length];
    const next = vertices[(index + 1) % vertices.length];
    const ax = previous.x - point.x;
    const ay = previous.y - point.y;
    const bx = next.x - point.x;
    const by = next.y - point.y;
    const cosine = Math.max(-1, Math.min(1,
      (ax * bx + ay * by) / Math.max(1e-8, Math.hypot(ax, ay) * Math.hypot(bx, by)),
    ));
    return Math.acos(cosine) * 180 / Math.PI;
  });
}

function edgeLengths(vertices: readonly DrawingPoint[]) {
  return vertices.map((point, index) => distance(point, vertices[(index + 1) % vertices.length]));
}

function axisDeviationDegrees(start: DrawingPoint, end: DrawingPoint) {
  const angle = Math.atan2(end.y - start.y, end.x - start.x);
  const quarterTurn = Math.PI / 2;
  const nearestAxis = Math.round(angle / quarterTurn) * quarterTurn;
  return Math.abs(angle - nearestAxis) * 180 / Math.PI;
}

/**
 * Recognize only outlines that fit a familiar shape. Strength relaxes the fit
 * thresholds and simplifies the supplied outline, while unrecognized shapes
 * remain freeform instead of being forced into a fixed shortlist.
 */
export function guessClosedDrawingShape(
  points: readonly DrawingPoint[],
  simplifiedOutline: readonly DrawingPoint[],
  strength: number,
): GuessedDrawingShape | null {
  if (points.length < 8 || simplifiedOutline.length < 3) return null;

  const clampedStrength = Math.max(1, Math.min(10, strength));
  const strengthProgress = (clampedStrength - 1) / 9;
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  const width = maxX - minX;
  const height = maxY - minY;
  const scale = Math.max(width, height);
  if (width < 2 || height < 2 || scale < 4) return null;

  const closureTolerance = scale * (0.14 + strengthProgress * 0.11);
  if (distance(points[0], points[points.length - 1]) > closureTolerance) return null;

  const vertices = getClosedVertices(simplifiedOutline, scale * 0.012);
  if (!isConvexPolygon(vertices))
    return isClosedCircleCandidate(points, clampedStrength) ? { type: "ellipse" } : null;
  const fitTolerance = 0.045 + strengthProgress * 0.105;
  if (polygonFitError(points, vertices, scale) > fitTolerance) return null;
  const polygonShapeFitTolerance = 0.035 + strengthProgress * 0.025;
  const shapeFitError = polygonFitError(points, vertices, scale);

  const angles = interiorAngles(vertices);
  const angleTolerance = 11 + strengthProgress * 18;
  const lengths = edgeLengths(vertices);
  const shortestSide = Math.min(...lengths);
  const longestSide = Math.max(...lengths);
  if (shortestSide < scale * 0.06) return null;

  if (vertices.length === 3) {
    const areaRatio = polygonArea(vertices) / Math.max(1, width * height);
    if (areaRatio < 0.15 || angles.some(angle => angle < 18 || angle > 162)) return null;
    const uprightTriangle = [
      { x: (minX + maxX) / 2, y: minY },
      { x: maxX, y: maxY },
      { x: minX, y: maxY },
    ];
    const triangleFit = Math.max(
      polygonFitError(vertices, uprightTriangle, scale),
      polygonFitError(uprightTriangle, vertices, scale),
    );
    if (triangleFit > polygonShapeFitTolerance) return null;
    return { type: "triangle" };
  }

  if (vertices.length === 4) {
    const axisTolerance = 8 + strengthProgress * 12;
    const axisAligned = vertices.every((point, index) =>
      axisDeviationDegrees(point, vertices[(index + 1) % vertices.length]) <= axisTolerance,
    );
    const rightAngled = angles.every(angle => Math.abs(angle - 90) <= angleTolerance);
    const areaRatio = polygonArea(vertices) / Math.max(1, width * height);
    if (axisAligned && rightAngled && areaRatio >= 0.65 && shapeFitError <= polygonShapeFitTolerance) {
      const squareTolerance = 0.04 + strengthProgress * 0.08;
      return {
        type: "rectangle",
        square: Math.abs(width - height) / scale <= squareTolerance,
      };
    }

    const equalSideTolerance = 0.12 + strengthProgress * 0.18;
    const diamondArea = areaRatio >= 0.3 && areaRatio <= 0.72;
    if (diamondArea && longestSide / shortestSide <= 1 + equalSideTolerance && shapeFitError <= polygonShapeFitTolerance) {
      const uprightDiamondTemplate = [
        { x: minX + width / 2, y: minY },
        { x: maxX, y: minY + height / 2 },
        { x: minX + width / 2, y: maxY },
        { x: minX, y: minY + height / 2 },
      ];
      const diamondOrientationError = Math.max(
        polygonFitError(vertices, uprightDiamondTemplate, scale),
        polygonFitError(uprightDiamondTemplate, vertices, scale),
      );
      if (diamondOrientationError <= polygonShapeFitTolerance) return { type: "diamond" };
    }
  }

  if (vertices.length === 6) {
    const equalSideTolerance = 0.12 + strengthProgress * 0.18;
    const regularAngles = angles.every(angle => Math.abs(angle - 120) <= angleTolerance);
    if (regularAngles && longestSide / shortestSide <= 1 + equalSideTolerance && shapeFitError <= polygonShapeFitTolerance) {
      const flatTopHexagonTemplate = [
        { x: minX + width * 0.25, y: minY },
        { x: minX + width * 0.75, y: minY },
        { x: maxX, y: minY + height / 2 },
        { x: minX + width * 0.75, y: maxY },
        { x: minX + width * 0.25, y: maxY },
        { x: minX, y: minY + height / 2 },
      ];
      const hexagonOrientationError = Math.max(
        polygonFitError(vertices, flatTopHexagonTemplate, scale),
        polygonFitError(flatTopHexagonTemplate, vertices, scale),
      );
      if (hexagonOrientationError <= polygonShapeFitTolerance) return { type: "hexagon" };
    }
  }

  // Prefer a well-fitted regular hexagon before the looser circle heuristic.
  // Otherwise sampled points along a hexagon's edges can make it look circular.
  if (isClosedCircleCandidate(points, clampedStrength)) return { type: "ellipse" };

  return null;
}

/**
 * Return true only for a closed, near-circular stroke. Shape Guessing uses a
 * deliberately stricter circle test so square loops and irregular outlines
 * stay editable freeform paths instead of unexpectedly becoming ellipses.
 */
export function isClosedCircleCandidate(
  points: readonly DrawingPoint[],
  strength: number,
): boolean {
  if (points.length <= 10) return false;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    minY = Math.min(minY, point.y);
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }

  const width = maxX - minX;
  const height = maxY - minY;
  const maxDimension = Math.max(width, height);
  if (width <= 0 || height <= 0 || maxDimension <= 0) return false;

  const start = points[0];
  const end = points[points.length - 1];
  if (Math.hypot(start.x - end.x, start.y - end.y) > maxDimension * 0.14)
    return false;

  const aspectRatio = Math.min(width, height) / Math.max(width, height);
  if (aspectRatio < 0.82) return false;

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const averageRadius = (width + height) / 4;
  let radialDeviation = 0;
  for (const point of points) {
    radialDeviation += Math.abs(
      Math.hypot(point.x - centerX, point.y - centerY) - averageRadius,
    );
  }
  radialDeviation /= points.length;

  const clampedStrength = Math.max(1, Math.min(10, strength));
  const relativeTolerance = 0.035 + ((clampedStrength - 1) / 9) * 0.1;
  return radialDeviation < averageRadius * relativeTolerance;
}
