import { BOARD_WRITE_ERROR_STATUS } from '../../shared/board-errors.js';
export type BoardConflictCode = 'STALE_BOARD_REVISION' | 'BOARD_ID_PATH_COLLISION';
export type BoardValidationCode = 'INVALID_BOARD_DATA' | 'BOARD_PRECONDITION_REQUIRED';

export class BoardConflictError extends Error {
  constructor(message?: string, readonly code: BoardConflictCode = 'STALE_BOARD_REVISION') { super(message); }
}

export class BoardValidationError extends Error {
  constructor(message?: string, readonly code: BoardValidationCode = 'INVALID_BOARD_DATA') { super(message); }
}

/** These failures confirm the attempted payload was not written. */
export function isDefinitiveBoardWriteError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  return Object.hasOwn(BOARD_WRITE_ERROR_STATUS, String(error.code));
}
