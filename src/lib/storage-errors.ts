export class BoardConflictError extends Error {
  readonly code = 'STALE_BOARD_REVISION';
}

export class BoardValidationError extends Error {
  readonly code = 'INVALID_BOARD_DATA';
}

/** These failures confirm the attempted payload was not written. */
export function isDefinitiveBoardWriteError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) return false;
  return error.code === 'STALE_BOARD_REVISION' || error.code === 'INVALID_BOARD_DATA';
}
