import type { BoardElement } from "../../types";
import type { SectionSheet } from "../spreadsheet/types";
import type { MainBoardGeometry } from './board-resize';

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
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].every(key => equalDocumentValue(a[key], b[key]));
}

export const pushBoardDocumentHistory = (
  history: BoardDocumentHistory,
  snapshot: BoardDocumentSnapshot,
  limit = 50,
): BoardDocumentHistory => {
  if (equalDocumentValue(history.entries[history.index], snapshot)) return history;
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
