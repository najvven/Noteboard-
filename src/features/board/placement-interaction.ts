export interface PlacementPoint {
  x: number;
  y: number;
}

const AREA_TOOLS = new Set([
  "select", "rectangle", "ellipse", "triangle", "diamond", "hexagon", "line", "arrow",
  "text", "h1", "h2", "h3", "bullet-list", "numbered-list", "quote", "code", "checklist", "sticky", "blank",
  "image", "media", "embed", "board", "section", "table",
]);

/** Area tools share Lock in time. Freehand drawing, filling and erasing do not. */
export const usesAreaPlacement = (tool: string) => AREA_TOOLS.has(tool);

export interface PlacementBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface PlacementRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface BoardSurfacePointerTarget {
  hasBoardSurfaceMarker: boolean;
  isElementTarget: boolean;
  isSecondaryBoardSurface: boolean;
}

/**
 * A secondary board is both an element and a valid placement surface. Other
 * elements must keep blocking background placement so tools do not draw
 * through existing content.
 */
export const isBoardPlacementSurface = ({
  hasBoardSurfaceMarker,
  isElementTarget,
  isSecondaryBoardSurface,
}: BoardSurfacePointerTarget): boolean =>
  hasBoardSurfaceMarker && (!isElementTarget || isSecondaryBoardSurface);

export const shouldPreservePresetPicking = ({
  hasActivePreset,
  isPrimaryPointer,
  isElementTarget,
}: {
  hasActivePreset: boolean;
  isPrimaryPointer: boolean;
  isElementTarget: boolean;
}): boolean => hasActivePreset && isPrimaryPointer && isElementTarget;

/**
 * Returns whether pointer movement is large enough to count as an area drag.
 *
 * A zero-distance click is never an area drag, even when callers configure a
 * zero threshold. Invalid thresholds and non-finite coordinates are rejected
 * so placement code cannot accidentally create an element from bad geometry.
 */
export const hasMeaningfulAreaDrag = (
  start: PlacementPoint | null | undefined,
  current: PlacementPoint | null | undefined,
  minimumDistance = 4,
): boolean => {
  if (
    !start ||
    !current ||
    !Number.isFinite(start.x) ||
    !Number.isFinite(start.y) ||
    !Number.isFinite(current.x) ||
    !Number.isFinite(current.y) ||
    !Number.isFinite(minimumDistance) ||
    minimumDistance < 0
  ) {
    return false;
  }

  const distance = Math.hypot(current.x - start.x, current.y - start.y);
  return Number.isFinite(distance) && distance > 0 && distance >= minimumDistance;
};

/**
 * Builds a direction-aware rectangle that never renders smaller than one
 * logical board cell. Keeping this geometry outside React makes the delayed
 * Select preview and its committed region use the same rule.
 */
export const getMinimumAreaRect = (
  start: PlacementPoint,
  current: PlacementPoint,
  minimumSize: number,
  bounds?: PlacementBounds,
): PlacementRect => {
  const safeMinimum = Number.isFinite(minimumSize)
    ? Math.max(1, minimumSize)
    : 1;
  const rawWidth = Math.abs(current.x - start.x);
  const rawHeight = Math.abs(current.y - start.y);
  let w = Math.max(safeMinimum, rawWidth);
  let h = Math.max(safeMinimum, rawHeight);
  let x = current.x < start.x ? start.x - w : start.x;
  let y = current.y < start.y ? start.y - h : start.y;

  if (bounds) {
    const availableWidth = Math.max(0, bounds.maxX - bounds.minX);
    const availableHeight = Math.max(0, bounds.maxY - bounds.minY);
    w = Math.min(w, availableWidth);
    h = Math.min(h, availableHeight);
    x = Math.min(Math.max(x, bounds.minX), Math.max(bounds.minX, bounds.maxX - w));
    y = Math.min(Math.max(y, bounds.minY), Math.max(bounds.minY, bounds.maxY - h));
  }

  return { x, y, w, h };
};
