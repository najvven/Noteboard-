import { saveStoredBoard } from '../../shared/board-store.js';
import { withBoardStoreLock } from '../../shared/store-lock.js';
const directory = process.argv[2];
process.on('message', async message => {
  if (message.type === 'hold') {
    await withBoardStoreLock(directory, async () => {
      process.send({ locked: true });
      await new Promise(() => {});
    });
    return;
  }
  try {
    await saveStoredBoard(directory, message.board, { baseRevision: message.baseRevision });
    process.send({ ok: true, title: message.board.title });
  } catch (error) { process.send({ ok: false, code: error.code, message: error.message }); }
});
process.send({ ready: true });
