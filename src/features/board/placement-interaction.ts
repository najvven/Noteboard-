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

/** Snapping cannot reverse a drag or erase a small movement across its anchor. */
export function resolveAreaDragPoint(
  start: PlacementPoint,
  current: PlacementPoint,
  minimumSize: number,
  snapPoint: (point: PlacementPoint) => PlacementPoint = point => point,
  proportional = false,
): PlacementPoint {
  const minimum = Number.isFinite(minimumSize) ? Math.max(1, minimumSize) : 1;
  const snapped = snapPoint(current);
  const dx = current.x - start.x, dy = current.y - start.y;
  let x = snapped.x, y = snapped.y;
  if (dx < 0 && x >= start.x) x = start.x - minimum;
  if (dx > 0 && x <= start.x) x = start.x + minimum;
  if (dy < 0 && y >= start.y) y = start.y - minimum;
  if (dy > 0 && y <= start.y) y = start.y + minimum;
  if (proportional) {
    const extent = Math.max(minimum, Math.abs(x - start.x), Math.abs(y - start.y));
    x = start.x + (dx < 0 ? -1 : 1) * extent;
    y = start.y + (dy < 0 ? -1 : 1) * extent;
  }
  return { x, y };
}

/** New Board retains its default size, growing outwards from the fixed anchor. */
export const getBoardPlacementRect = (
  start: PlacementPoint,
  current: PlacementPoint,
  minimumSize: number,
): PlacementRect => {
  const width = Math.abs(current.x - start.x);
  const height = Math.abs(current.y - start.y);
  const useDefault = width < minimumSize || height < minimumSize;
  const w = useDefault ? 360 : width;
  const h = useDefault ? 220 : height;
  return {
    x: current.x < start.x ? start.x - w : start.x,
    y: current.y < start.y ? start.y - h : start.y,
    w,
    h,
  };
};

/**
 * Builds a direction-aware rectangle with a one-cell minimum, clipped only
 * at the board boundary. Preview and committed Select regions share this rule.
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
    // Clip the outer edges instead of translating the rectangle's anchor.
    const right = Math.min(bounds.maxX, x + w);
    const bottom = Math.min(bounds.maxY, y + h);
    x = Math.max(bounds.minX, x); y = Math.max(bounds.minY, y);
    w = Math.max(0, right - x); h = Math.max(0, bottom - y);
  }

  return { x, y, w, h };
};
