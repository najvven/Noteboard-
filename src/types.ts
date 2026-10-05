import type {
  SectionSheet,
  SectionSheetCellMeta,
} from "./features/spreadsheet/types";
import type { ToolMenuSettingsOverrides } from "./features/tool-settings/model";

export type {
  SectionSheet,
  SectionSheetAutomation,
  SectionSheetAutomationId,
  SectionSheetCellMeta,
  SectionSheetColumn,
  SectionSheetRow,
  SectionSheetShortcuts,
} from "./features/spreadsheet/types";

export type {
  ToolMenuSettingKey,
  ToolMenuSettings,
  ToolMenuSettingsOverride,
  ToolMenuSettingsOverrides,
} from "./features/tool-settings/model";

export type ElementType = 
  | 'text' 
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bullet-list'
  | 'numbered-list'
  | 'quote'
  | 'code'
  | 'checklist' 
  | 'section'
  | 'rectangle'
  | 'ellipse'
  | 'triangle'
  | 'diamond'
  | 'hexagon'
  | 'board'
  | 'sticky' 
  | 'image' 
  | 'media'
  | 'embed' 
  | 'table' 
  | 'draw' 
  | 'fill'
  | 'line'
  | 'blank'
  | 'layer'
  | 'group'
  | 'arrow';

export interface Position {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface BoardElement {
  id: string;
  type: ElementType;
  position: Position;
  size?: Size;
  content: string; // Generic content string (can hold text, URLs, JSON for complex structures)
  color?: string; // Background color for sticky notes/sections
  borderColor?: string;
  borderWidth?: number;
  textColor?: string;
  isBold?: boolean;
  isItalic?: boolean;
  textAlign?: 'left' | 'center' | 'right';
  lineHeight?: number;
  fontSize?: number;
  textScaling?: boolean;
  textScale?: number;
  fontWeight?: number;
  textSnapToGrid?: boolean;
  textLinesMode?: 'everywhere' | 'text-only';
  keepRatio?: boolean;
  previewMode?: 'box' | 'realistic';
  crop?: { left: number; top: number; right: number; bottom: number };
  mediaKind?: 'media' | 'web';
  mediaMime?: string;
  mediaControlsHidden?: boolean;
  mediaLoop?: boolean;
  mediaPlaybackRate?: number;
  mediaVolume?: number;
  webSessionId?: string;
  webRememberSession?: boolean;
  webDeviceMode?: 'desktop' | 'tablet' | 'phone';
  webAdBlock?: boolean;
  webCookieBlocker?: 'off' | 'third-party' | 'all';
  webPopupBlocker?: boolean;
  opacity?: number;
  rotation?: number;
  flipX?: boolean;
  flipY?: boolean;
  borderRadius?: number;
  strokeLinejoin?: 'miter' | 'round';
  points?: { x: number, y: number }[];
  isSmooth?: boolean;
  drawingAssistSmooth?: boolean;
  drawingAssistSmoothStrength?: number;
  drawingAssistGuess?: boolean;
  drawingAssistStrength?: number;
  turnSnap?: boolean;
  turnSnapDegrees?: number;
  sectionCollision?: 'none' | 'block' | 'clip';
  zIndex: number;
  parentId?: string;
  /** Previous layer/section parent of a merged group's direct member. */
  groupOriginalParentId?: string;
  isHidden?: boolean;
  isLocked?: boolean;
  isEraser?: boolean;
  eraserShape?: 'round' | 'square';
  name?: string;
  isLinkTarget?: boolean;
  linkTargetName?: string;
  linkToId?: string;
  sheetCell?: SectionSheetCellMeta;
}

export interface BoardEditorSettings {
  activeTool?: string;
  selectMode?: import('./features/board/select-mode').SelectMode;
  spreadsheetCellWidth?: number;
  spreadsheetCellHeight?: number;
  spreadsheetMode?: 'advanced' | 'simple';
  customColors?: Record<string, string[]>;
  pendingProps?: Partial<BoardElement>;
  alwaysOnTop?: boolean;
  keepToolActive?: boolean;
  keepToolActiveFallback?: 'select' | 'pan';
  toolModeShortcut?: string;
  gridToggleShortcut?: string;
  overlapShortcut?: string;
  cropShortcut?: string;
  scrollZoomShortcut?: string;
  zoomToCursor?: boolean;
  keepBoardContentPosition?: boolean;
  cutShortcut?: string;
  proportionalScale?: boolean;
  altResizeCrops?: boolean;
  previewMode?: 'box' | 'realistic';
  toolMenuSettingsOverrides?: ToolMenuSettingsOverrides;
  isSelectionLockEnabled?: boolean;
  selectionLockTime?: number;
  enableObjectSnapping?: boolean;
  smartGuidesEnabled?: boolean;
  autoSelectOnPlace?: boolean;
  autoToolOnSelect?: boolean;
  spinSnapEnabled?: boolean;
  spinSnapDegrees?: number;
  allowEditing?: boolean;
  allowMovingElementsInPan?: boolean;
  fillToolColor?: string;
  eraserMode?: 'element' | 'partial';
  eraserSize?: number;
  eraserShape?: 'round' | 'square';
  scrollZoomSensitivity?: number;
  clickZoomSensitivity?: number;
  overlapMode?: 'none' | 'partial' | 'full';
  toolbarLayout?: {
    order: string[];
    more: string[];
    general?: string[];
    slots?: Record<string, number>;
  };
  objectPresets?: Array<{
    id: string;
    name: string;
    element?: BoardElement;
    elements?: BoardElement[];
    shortcut?: string;
  }>;
  objectDefaults?: Partial<Record<ElementType, Partial<BoardElement>>>;
}

export interface Preset {
  id: string;
  name: string;
  description: string;
  icon: string;
  elements: BoardElement[];
  sectionSheets?: SectionSheet[];
  width?: number;
  height?: number;
  workspaceWidth?: number;
  workspaceHeight?: number;
  showGrid?: boolean;
  snapToGrid?: boolean;
  showWorkspaceGrid?: boolean;
  brightness?: number;
  gridColor?: string;
  boardColor?: string;
  gridThickness?: number;
  gridSize?: number;
  workspaceGridColor?: string;
  workspaceGridThickness?: number;
  workspaceGridSize?: number;
  editorSettings?: BoardEditorSettings;
  isBuiltIn: boolean;
}

export interface Page {
  version?: number;
  id: string;
  title: string;
  width: number;
  height: number;
  workspaceWidth?: number;
  workspaceHeight?: number;
  boardX?: number;
  boardY?: number;
  snapToGrid?: boolean;
  showGrid?: boolean;
  showWorkspaceGrid?: boolean;
  brightness?: number;
  gridColor?: string;
  boardColor?: string;
  gridThickness?: number;
  gridSize?: number;
  workspaceGridColor?: string;
  workspaceGridThickness?: number;
  workspaceGridSize?: number;
  zoom?: number;
  scrollX?: number;
  scrollY?: number;
  viewportCenterX?: number;
  viewportCenterY?: number;
  editorSettings?: BoardEditorSettings;
  updatedAt: number;
  isPinned: boolean;
  elements: BoardElement[];
  sectionSheets?: SectionSheet[];
}
