import { updateStoredPreset } from '../../shared/preset-store.js';

const directory = process.argv[2];
process.on('message', async operation => {
  try {
    const presets = await updateStoredPreset(directory, operation);
    process.send({ ok: true, presets });
  } catch (error) {
    process.send({ ok: false, message: error instanceof Error ? error.message : String(error) });
  }
});
process.send({ ready: true });
