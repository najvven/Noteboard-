import fs from 'node:fs/promises';
import path from 'node:path';
import lockfile from 'proper-lockfile';
import { enqueueWrite } from './persistence.js';

// All processes use the same lease settings, including readers that migrate
// legacy files. The in-process queue avoids competing leases in one process.
export function withBoardStoreLock(directory, operation, { create = true } = {}) {
  return enqueueWrite(path.resolve(directory), async () => {
    if (create) await fs.mkdir(directory, { recursive: true });
    let canonicalDirectory;
    try { canonicalDirectory = await fs.realpath(directory); }
    catch (error) {
      // Deleting an absent store is already complete at this observation.
      // Do not run an unlocked read/delete: a concurrent creator could make
      // the directory appear between those two operations.
      if (!create && error.code === 'ENOENT') return true;
      throw error;
    }
    let compromised;
    const release = await lockfile.lock(canonicalDirectory, {
      // A sibling lease must not trigger the boards-directory change watcher.
      lockfilePath: `${canonicalDirectory}.lock`,
      stale: 30_000,
      update: 2_000,
      retries: { retries: 150, factor: 1, minTimeout: 250, maxTimeout: 250 },
      onCompromised: error => { compromised = error; },
    });
    const assertHeld = () => { if (compromised) throw compromised; };
    try {
      const result = await operation(assertHeld);
      assertHeld();
      return result;
    } finally {
      try { await release(); }
      catch (error) { if (!compromised) throw error; }
    }
  });
}
