export const BOARD_WRITE_ERROR_STATUS = Object.freeze({
  STALE_BOARD_REVISION: 409,
  BOARD_ID_PATH_COLLISION: 409,
  INVALID_BOARD_DATA: 400,
  BOARD_PRECONDITION_REQUIRED: 428,
});

export function boardWriteError(code, message) {
  return Object.assign(new Error(message), { code });
}

// Only known failures guarantee that the requested write was rejected.
// Other I/O/IPC failures remain uncertain and retain the recovery draft.
export function boardWriteFailure(error) {
  const status = Object.hasOwn(BOARD_WRITE_ERROR_STATUS, error?.code)
    ? BOARD_WRITE_ERROR_STATUS[error.code] : undefined;
  return status ? { ok: false, code: error.code, message: error.message, status } : null;
}
