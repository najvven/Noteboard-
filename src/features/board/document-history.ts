import type { BoardElement } from "../../types";
import type { SectionSheet } from "../spreadsheet/types";
import type { MainBoardGeometry } from './board-resize';
import {parseWorkbookDocument} from '../spreadsheet/workbook';

export interface BoardDocumentSnapshot {
  elements: BoardElement[];
  sectionSheets: SectionSheet[];
  boardGeometry?: MainBoardGeometry;
  presentation?: BoardDocumentPresentation;
}

export interface BoardDocumentPresentation {
  title: string;
  boardColor: string;
  gridColor: string;
  gridSize: number;
  gridThickness: number;
  showGrid: boolean;
  snapToGrid: boolean;
}

export interface BoardDocumentHistory {
  entries: BoardDocumentSnapshot[];
  index: number;
}

export const createBoardDocumentHistory = (
  initial: BoardDocumentSnapshot,
): BoardDocumentHistory => ({ entries: [initial], index: 0 });

// Unchanged updates (selection, focus, an identical property value) must not
// consume the next Undo. Shared references make ordinary comparisons cheap.
export function equalDocumentValue(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.length === right.length &&
      left.every((value, index) => equalDocumentValue(value, right[index]));
  }
  const a = left as Record<string, unknown>, b = right as Record<string, unknown>;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].every(key => {
    if(key==='content' && a.type==='table' && b.type==='table' && typeof a[key]==='string' && typeof b[key]==='string' && a[key]!==b[key]){
      const leftBook=parseWorkbookDocument(a[key]),rightBook=parseWorkbookDocument(b[key]);
      if(leftBook&&rightBook){delete leftBook.preview;delete rightBook.preview;return equalDocumentValue(leftBook,rightBook);}
    }
    return equalDocumentValue(a[key], b[key]);
  });
}

export const pushBoardDocumentHistory = (
  history: BoardDocumentHistory,
  snapshot: BoardDocumentSnapshot,
  limit = 50,
): BoardDocumentHistory => {
  if (equalDocumentValue(history.entries[history.index], snapshot)) {
    // Refresh derived thumbnails without adding an Undo step.
    if(history.entries[history.index].elements.some((element,index)=>element.type==='table' && element.content!==snapshot.elements[index]?.content)) {
      const entries=[...history.entries];entries[history.index]=snapshot;
      return {...history,entries};
    }
    return history;
  }
  const safeLimit = Math.max(1, Math.floor(limit));
  const branch = [...history.entries.slice(0, history.index + 1), snapshot];
  const entries =
    branch.length > safeLimit ? branch.slice(branch.length - safeLimit) : branch;
  return { entries, index: entries.length - 1 };
};

export const undoBoardDocumentHistory = (
  history: BoardDocumentHistory,
): BoardDocumentHistory =>
  history.index > 0 ? { ...history, index: history.index - 1 } : history;

export const redoBoardDocumentHistory = (
  history: BoardDocumentHistory,
): BoardDocumentHistory =>
  history.index < history.entries.length - 1
    ? { ...history, index: history.index + 1 }
    : history;
