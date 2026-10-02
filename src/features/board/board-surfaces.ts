import type { BoardElement, Position, Size } from '../../types';
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

/** Preview and placed objects use the same board boundary. */
export function elementBoardBoundary(element: Pick<BoardElement,'position'|'size'>, boards: readonly BoardElement[], mainSize: Size) {
  const center={x:element.position.x+(element.size?.width??100)/2,y:element.position.y+(element.size?.height??40)/2};
  const board=boards.filter(item=>item.type==='board').sort((a,b)=>b.zIndex-a.zIndex).find(item=>
    center.x>=item.position.x&&center.x<=item.position.x+(item.size?.width??0)&&
    center.y>=item.position.y&&center.y<=item.position.y+(item.size?.height??0));
  return elementPolygon(board??{position:{x:0,y:0},size:mainSize});
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
