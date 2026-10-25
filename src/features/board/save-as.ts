import type { Page, Preset } from '../../types';
import { generateId } from '../../lib/utils';
import { cloneBoardDocument } from './clone-board-document';

export type SaveAsKind = 'template' | 'board' | 'file';

export function createSavedBoard(source: Page, name: string, idFactory = generateId): Page {
  const snapshot = structuredClone(source);
  const document = cloneBoardDocument(snapshot.elements, snapshot.sectionSheets ?? [], idFactory);
  return {
    ...snapshot,
    id: `page-${idFactory()}`,
    title: name.trim() || source.title || 'Untitled board',
    elements: document.elements,
    sectionSheets: document.sheets,
    updatedAt: Date.now(),
    isPinned: false,
  };
}

export function createSavedTemplate(source: Page, name: string, idFactory = generateId): Preset {
  return {
    id: `preset-${idFactory()}`,
    name: name.trim() || source.title || 'Untitled template',
    description: '',
    icon: 'LayoutGrid',
    isBuiltIn: false,
    elements: structuredClone(source.elements),
    sectionSheets: structuredClone(source.sectionSheets ?? []),
    width: source.width,
    height: source.height,
    workspaceWidth: source.workspaceWidth,
    workspaceHeight: source.workspaceHeight,
    showGrid: source.showGrid,
    snapToGrid: source.snapToGrid,
    showWorkspaceGrid: source.showWorkspaceGrid,
    brightness: source.brightness,
    gridColor: source.gridColor,
    boardColor: source.boardColor,
    gridThickness: source.gridThickness,
    gridSize: source.gridSize,
    workspaceGridColor: source.workspaceGridColor,
    workspaceGridThickness: source.workspaceGridThickness,
    workspaceGridSize: source.workspaceGridSize,
    editorSettings: source.editorSettings ? structuredClone(source.editorSettings) : undefined,
  };
}
