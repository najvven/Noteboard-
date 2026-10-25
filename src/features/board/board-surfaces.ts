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
  element: Pick<BoardElement, 'parentId' | 'position'>,
  boards: readonly BoardElement[],
  mainSize: Size,
  hierarchy: ElementHierarchy = createElementHierarchy(boards),
) {
  const visited = new Set<string>();
  let parentId = element.parentId;
  while (parentId && !visited.has(parentId)) {
    visited.add(parentId);
    const parent = hierarchy.byId.get(parentId);
    if (!parent) break;
    if (parent.type === 'board') return parent;
    parentId = parent.parentId;
  }
  const owner = findBoardSurface(element.position, boards);
  if (owner) return owner;
  const point = element.position;
  if (point.x >= 0 && point.y >= 0 && point.x <= mainSize.width && point.y <= mainSize.height)
    return boards.find(board => board.type === 'board' && board.id === 'main-board') ??
      createBoardSurface('main-board', { x: 0, y: 0 }, mainSize);
  return undefined;
}

/** Preview and placed objects use the same owner and polygon clipping boundary. */
export function elementBoardBoundary(
  element: Pick<BoardElement, 'parentId' | 'position' | 'size'>,
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
