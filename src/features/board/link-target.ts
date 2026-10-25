export interface BoardLinkTargetValidation {
  value?: string;
  error?: string;
}

import { isSafeBoardWebLink } from "../../../shared/board-data.js";

export const isHttpBoardLink = isSafeBoardWebLink;

export const validateBoardLinkTargetDraft = (
  draft: string,
  validElementIds: ReadonlySet<string>,
): BoardLinkTargetValidation => {
  const value = draft.trim();
  if (!value) return { value: undefined };
  if (validElementIds.has(value) || isHttpBoardLink(value)) return { value };
  return {
    error: 'Choose an existing object or enter a complete http(s) web address.',
  };
};
