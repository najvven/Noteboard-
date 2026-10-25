// One ordering contract for saves, recovery replay and deletion of each board.
const pending = new Map<string, Promise<unknown>>();
let documentFlush: (() => Promise<unknown>) | undefined;
const revisions = new Map<string, number>();

export function nextBoardRevision(id: string, previous = 0) {
  if (!Number.isSafeInteger(previous) || previous < 0 || previous >= Number.MAX_SAFE_INTEGER)
    throw new Error("Board revision is invalid.");
  const revision = Math.max(Date.now(), previous + 1, (revisions.get(id) ?? 0) + 1);
  revisions.set(id, revision);
  return revision;
}

export function enqueueBoardOperation<T>(id: string, operation: () => Promise<T>): Promise<T> {
  const result = (pending.get(id) ?? Promise.resolve()).catch(() => undefined).then(operation);
  pending.set(id, result);
  const cleanup = () => { if (pending.get(id) === result) pending.delete(id); };
  void result.then(cleanup, cleanup);
  return result;
}

export function registerDocumentFlush(flush: () => Promise<unknown>) {
  documentFlush = flush;
  return () => { if (documentFlush === flush) documentFlush = undefined; };
}

export async function flushBoardOperations() {
  if (await documentFlush?.() === false) throw new Error("The current board could not be saved.");
  while (pending.size) await Promise.all([...pending.values()]);
}
