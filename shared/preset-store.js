import path from 'node:path';
import { readJsonWithBackup, atomicWriteJson } from './persistence.js';
import { withBoardStoreLock } from './store-lock.js';
import { assertValidBoard } from './board-data.js';

const presetPath = directory => path.join(directory, 'presets.json');
const validatePresetArray = value => {
  if (!Array.isArray(value)) throw new Error('Presets must be an array.');
};
const validatePreset = preset => {
  if (!preset || typeof preset !== 'object' || Array.isArray(preset) ||
      typeof preset.id !== 'string' || !preset.id || preset.id.length > 200 ||
      typeof preset.name !== 'string' || preset.name.length > 500 ||
      !Array.isArray(preset.elements)) throw new Error('The template is invalid.');
  if (preset.description !== undefined && (typeof preset.description !== 'string' || preset.description.length > 10_000))
    throw new Error('The template description is invalid.');
  if (preset.icon !== undefined && (typeof preset.icon !== 'string' || preset.icon.length > 200))
    throw new Error('The template icon is invalid.');
  assertValidBoard({
    id: 'preset-validation',
    title: preset.name,
    elements: preset.elements,
    sectionSheets: preset.sectionSheets,
    width: preset.width,
    height: preset.height,
    workspaceWidth: preset.workspaceWidth,
    workspaceHeight: preset.workspaceHeight,
    editorSettings: preset.editorSettings,
    showGrid: preset.showGrid,
    snapToGrid: preset.snapToGrid,
    showWorkspaceGrid: preset.showWorkspaceGrid,
    brightness: preset.brightness,
    gridColor: preset.gridColor,
    boardColor: preset.boardColor,
    gridThickness: preset.gridThickness,
    gridSize: preset.gridSize,
    workspaceGridColor: preset.workspaceGridColor,
    workspaceGridThickness: preset.workspaceGridThickness,
    workspaceGridSize: preset.workspaceGridSize,
  });
};
const validatePresets = value => {
  validatePresetArray(value);
  for (const preset of value) validatePreset(preset);
};
const stableValue = value => {
  if (value === undefined) return 'undefined';
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
};
const samePresetAdd = (existing, requested) => {
  // Name is the only field changed by the rename operation. The stable ID and
  // every other field identify an idempotent retry of the original add.
  const { name: _existingName, ...existingPayload } = existing;
  const { name: _requestedName, ...requestedPayload } = requested;
  return stableValue(existingPayload) === stableValue(requestedPayload);
};

export function loadStoredPresets(directory) {
  return withBoardStoreLock(directory, async () =>
    // Keep legacy records visible and recoverable. Mutating operations validate
    // the complete current set before writing so a bad old template is never
    // silently discarded during an unrelated save.
    readJsonWithBackup(presetPath(directory), [], { validate: validatePresetArray }));
}

export function updateStoredPreset(directory, operation) {
  return withBoardStoreLock(directory, async () => {
    const current = await readJsonWithBackup(presetPath(directory), [], { validate: validatePresetArray });
    for (const preset of current) validatePreset(preset);
    let next = current;
    if (operation?.type === 'add') {
      const preset = operation.preset;
      validatePreset(preset);
      const existing = current.find(item => item?.id === preset.id);
      if (existing) {
        if (!samePresetAdd(existing, preset))
          throw new Error('A different template already uses this ID.');
        return current;
      }
      next = [...current, JSON.parse(JSON.stringify(preset))];
    } else if (operation?.type === 'delete') {
      if (typeof operation.id !== 'string' || !operation.id) throw new Error('The template ID is invalid.');
      next = current.filter(preset => preset?.id !== operation.id);
      if (next.length === current.length) return current;
    } else if (operation?.type === 'rename') {
      if (typeof operation.id !== 'string' || !operation.id || typeof operation.name !== 'string' || operation.name.length > 500)
        throw new Error('The template rename is invalid.');
      const index = current.findIndex(preset => preset?.id === operation.id);
      // Another process may have deleted this template after the client read
      // it. Treat that stale rename as resolved by the deletion so it cannot
      // permanently block later queued template operations.
      if (index < 0) return current;
      if (current[index].name === operation.name) return current;
      next = current.map((preset, itemIndex) => itemIndex === index
        ? { ...preset, name: operation.name }
        : preset);
    } else throw new Error('The template operation is invalid.');

    await atomicWriteJson(presetPath(directory), next, { validate: validatePresets });
    return next;
  });
}
