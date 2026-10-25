import assert from 'node:assert/strict';
import test from 'node:test';
import { boardWriteFailure, boardWriteError } from '../shared/board-errors.js';
import { BoardConflictError, BoardValidationError, isDefinitiveBoardWriteError } from '../src/lib/storage-errors';
test('HTTP and IPC preserve path conflicts as definitive rejected writes',()=>{
  for(const code of ['STALE_BOARD_REVISION','BOARD_ID_PATH_COLLISION','INVALID_BOARD_DATA','BOARD_PRECONDITION_REQUIRED']) {
    const failure=boardWriteFailure(boardWriteError(code,'Rejected'));
    assert.equal(failure?.code,code);assert.equal(failure?.ok,false);assert.ok(isDefinitiveBoardWriteError(failure));
  }
  assert.equal(boardWriteFailure(new Error('Uncertain I/O')),null);
  assert.equal(isDefinitiveBoardWriteError({code:'EIO'}),false);
  assert.equal(isDefinitiveBoardWriteError(null),false);
  assert.equal(new BoardConflictError('Collision','BOARD_ID_PATH_COLLISION').code,'BOARD_ID_PATH_COLLISION');
  assert.equal(new BoardValidationError('Missing base','BOARD_PRECONDITION_REQUIRED').code,'BOARD_PRECONDITION_REQUIRED');
});
