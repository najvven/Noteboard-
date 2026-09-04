import type { BoardElement } from "../../types";
import type { SectionSheet } from "../spreadsheet/types";

export interface BoardDocumentSnapshot {
  elements: BoardElement[];
  sectionSheets: SectionSheet[];
}

export interface BoardDocumentHistory {
  entries: BoardDocumentSnapshot[];
  index: number;
}

export const createBoardDocumentHistory = (
  initial: BoardDocumentSnapshot,
): BoardDocumentHistory => ({ entries: [initial], index: 0 });

export const pushBoardDocumentHistory = (
  history: BoardDocumentHistory,
  snapshot: BoardDocumentSnapshot,
  limit = 50,
): BoardDocumentHistory => {
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
