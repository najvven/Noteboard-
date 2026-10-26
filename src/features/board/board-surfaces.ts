import type { BoardElement, Position, Size } from '../../types';
import { createElementHierarchy, type ElementHierarchy } from './element-hierarchy';
import { elementPolygon, pointInPolygon } from './section-clipping';

export function createBoardSurface(id: string, position: Position, size: Size, color = '#ffffff', zIndex = -1): BoardElement {
  return { id, type: 'board', position: { ...position }, size: { ...size }, color, content: '', zIndex };
}

export function boardSurfaceBounds(board: BoardElement) {
  return { minX: board.position.x, minY: board.position.y, maxX: board.position.x + (board.size?.width ?? 0), maxY: board.position.y + (board.size?.height ?? 0) };
}

/** Main and additional boards are equal placement surfaces, in stacking order. */
export function findBoardSurface(point: Position, boards: readonly BoardElement[]): BoardElement | undefined {
  return boards.filter(board => board.type === 'board' && !board.isHidden)
    .sort((a, b) => b.zIndex - a.zIndex)
    .find(board => pointInPolygon(point, elementPolygon(board)));
}

/** Resolve implicit ownership from the placement origin; explicit board ancestry wins. */
export function resolveElementBoardOwner(
  element: Pick<BoardElement, 'parentId' | 'position' | 'size' | 'isPixelFill' | 'pixelFillBoardId'>,
  boards: readonly BoardElement[],
  mainSize: Size,
  hierarchy: ElementHierarchy = createElementHierarchy(boards),
) {
  if (element.isPixelFill && element.pixelFillBoardId) {
    const fillCenter = element.size
      ? {
          x: element.position.x + element.size.width / 2,
          y: element.position.y + element.size.height / 2,
        }
      : element.position;
    const explicitOwner = boards.find(board => board.type === 'board' && board.id === element.pixelFillBoardId);
    if (explicitOwner && pointInPolygon(fillCenter, elementPolygon(explicitOwner))) return explicitOwner;
    if (element.pixelFillBoardId === 'main-board') {
      const main = boards.find(board => board.type === 'board' && board.id === 'main-board') ??
        createBoardSurface('main-board', { x: 0, y: 0 }, mainSize);
      if (pointInPolygon(fillCenter, elementPolygon(main))) return main;
    }
  }
  const visited = new Set<string>();
  let parentId = element.parentId;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = hierarchy.byId.get(parentId);
    if (!parent) break;
    if (parent.type === 'board') return parent;
    parentId = parent.parentId;
  }
  // Fill rasters are cropped to the visible region. Capture pixel rounding can
  // put their top-left just outside a surface, so resolve their owner from the
  // raster's interior instead of treating that rounded crop origin as intent.
  const ownerPoint = element.isPixelFill && element.size
    ? {
        x: element.position.x + element.size.width / 2,
        y: element.position.y + element.size.height / 2,
      }
    : element.position;
  const owner = findBoardSurface(ownerPoint, boards);
  if (owner) return owner;
  const point = element.position;
  if (point.x >= 0 && point.y >= 0 && point.x <= mainSize.width && point.y <= mainSize.height)
    return boards.find(board => board.type === 'board' && board.id === 'main-board') ??
      createBoardSurface('main-board', { x: 0, y: 0 }, mainSize);
  return undefined;
}

/** Keep raster fills attached to a board that still contains them; otherwise resolve their new surface. */
export function reconcilePixelFillBoardOwners(
  elements: BoardElement[],
  mainSize: Size,
): BoardElement[] {
  if (!elements.some(element => element.isPixelFill)) return elements;
  const storedMain = elements.find(element => element.type === 'board' && element.id === 'main-board');
  const main = storedMain ?? createBoardSurface('main-board', { x: 0, y: 0 }, mainSize);
  const boards = [main, ...elements.filter(element => element.type === 'board' && element.id !== 'main-board')];
  const hierarchy = createElementHierarchy(elements);

  return elements.map(element => {
    if (!element.isPixelFill) return element;
    const width = element.size?.width ?? 0;
    const height = element.size?.height ?? 0;
    const center = { x: element.position.x + width / 2, y: element.position.y + height / 2 };
    const currentOwner = element.pixelFillBoardId
      ? boards.find(board => board.id === element.pixelFillBoardId)
      : undefined;
    if (currentOwner && pointInPolygon(center, elementPolygon(currentOwner))) return element;

    const { pixelFillBoardId: _staleOwner, ...withoutExplicitOwner } = element;
    const nextOwner = resolveElementBoardOwner(withoutExplicitOwner, elements, mainSize, hierarchy);
    if (nextOwner?.id === element.pixelFillBoardId) return element;
    return { ...element, pixelFillBoardId: nextOwner?.id };
  });
}

/** Preview and placed objects use the same owner and polygon clipping boundary. */
export function elementBoardBoundary(
  element: Pick<BoardElement, 'parentId' | 'position' | 'size' | 'isPixelFill' | 'pixelFillBoardId'>,
  boards: readonly BoardElement[],
  mainSize: Size,
  hierarchy?: ElementHierarchy,
) {
  const owner = resolveElementBoardOwner(element, boards, mainSize, hierarchy);
  return elementPolygon(owner ?? createBoardSurface('main-board', { x: 0, y: 0 }, mainSize));
}

export function boardSurfaceStyle(board: BoardElement, grid: { showGrid?: boolean; gridColor?: string; gridSize?: number; gridThickness?: number }) {
  const { showGrid = false, gridColor = '#e2e8f0', gridSize = 24, gridThickness = 1 } = grid;
  return {
    backgroundColor: board.color || '#ffffff',
    backgroundImage: showGrid ? `linear-gradient(to right, ${gridColor} ${gridThickness}px, transparent ${gridThickness}px), linear-gradient(to bottom, ${gridColor} ${gridThickness}px, transparent ${gridThickness}px)` : 'none',
    backgroundSize: `${gridSize}px ${gridSize}px`,
    backgroundPosition: '0 0',
    boxShadow: '0 0 0 1px rgba(0,0,0,0.5)',
  };
}
