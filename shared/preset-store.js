import path from 'node:path';
import { readJsonWithBackup, atomicWriteJson } from './persistence.js';
import { withBoardStoreLock } from './store-lock.js';

const presetPath = directory => path.join(directory, 'presets.json');
const validatePresets = value => {
  if (!Array.isArray(value)) throw new Error('Presets must be an array.');
};

export function loadStoredPresets(directory) {
  return withBoardStoreLock(directory, async () =>
    readJsonWithBackup(presetPath(directory), [], { validate: validatePresets }));
}

export function updateStoredPreset(directory, operation) {
  return withBoardStoreLock(directory, async () => {
    const current = await readJsonWithBackup(presetPath(directory), [], { validate: validatePresets });
    let next = current;
    if (operation?.type === 'add') {
      const preset = operation.preset;
      if (!preset || typeof preset.id !== 'string' || !preset.id || typeof preset.name !== 'string')
        throw new Error('The template is invalid.');
      const existing = current.find(item => item?.id === preset.id);
      if (existing) {
        if (JSON.stringify(existing) !== JSON.stringify(preset))
          throw new Error('A different template already uses this ID.');
        return current;
      }
      next = [...current, JSON.parse(JSON.stringify(preset))];
    } else if (operation?.type === 'delete') {
      if (typeof operation.id !== 'string' || !operation.id) throw new Error('The template ID is invalid.');
      next = current.filter(preset => preset?.id !== operation.id);
      if (next.length === current.length) return current;
    } else if (operation?.type === 'rename') {
      if (typeof operation.id !== 'string' || !operation.id || typeof operation.name !== 'string')
        throw new Error('The template rename is invalid.');
      const index = current.findIndex(preset => preset?.id === operation.id);
      if (index < 0) throw new Error('This template was removed in another window. Refresh the template list and try again.');
      if (current[index].name === operation.name) return current;
      next = current.map((preset, itemIndex) => itemIndex === index
        ? { ...preset, name: operation.name }
        : preset);
    } else throw new Error('The template operation is invalid.');

    await atomicWriteJson(presetPath(directory), next, { validate: validatePresets });
    return next;
  });
}
