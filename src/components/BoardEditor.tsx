import React, { useState, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { webWheelClientPoint } from '../features/web/wheel-point';
import {useOutlineSelection} from '../features/board/use-outline-selection';
import {selectedBounds, selectElementsInOutline} from '../features/board/selection';
import {mergeAreaElements,ungroupAreaElements,updateMergedGroup,isMergedGroupMember,localGroupElement} from '../features/board/grouping';
import {smartGuides,type SmartGuide} from '../features/board/smart-guides';
import SmartGuidesOverlay,{type SmartGuidesHandle} from './SmartGuidesOverlay';
import {
  Page,
  BoardElement,
  BoardEditorSettings,
  ElementType,
  Preset,
  SectionSheet,
} from "../types";
import { generateId, cn } from "../lib/utils";
import { sanitizeRichText } from "../lib/sanitize-rich-text";
import { BoardSettingsIcon } from "./icons/BoardSettingsIcon";
import {
  BUILT_IN_MORE_TOOL_IDS,
  canMoveToolbarItemToMore,
  evaluateToolbarReorderPreview,
  getGeneralSettingsSections,
  isGeneralSettingsSection,
  type ToolbarItemId,
  type ToolbarLayout,
  type GeneralSettingsSectionId,
  normalizeToolbarLayout,
} from "../features/toolbar/model";
import { getBrowserWebSource, normalizeWebUrl } from "../features/web/model";
import { createToolbarDragPreview, TOOLBAR_EDITING_CLASSES } from "../features/toolbar/drag-preview";
import { mergeLiveWebviewUrls, readLiveWebviewUrl } from "../features/web/webview-state";
import { colorTextRange, replaceTextEditorHtml } from "../features/board/rich-text-formatting";
import { createBoardSurface, boardSurfaceBounds, findBoardSurface, boardSurfaceStyle } from "../features/board/board-surfaces";
import { elementPolygon, getPlacementSection, getSectionClipPath } from "../features/board/section-clipping";
import { getElementPermissions } from "../features/board/interaction-permissions";
import ToolPropertiesBar from "./ToolPropertiesBar";
import WebBlockingBadge from "./WebBlockingBadge";
import NativeWebView from "./NativeWebView";
import { WEB_DEVICE_PROFILES, normalizeWebDeviceMode } from "../../shared/web-device.js";
import SegmentedControl from "./SegmentedControl";
import { readBoardClipboard, writeBoardClipboard, isClipboardTextTarget, readCurrentClipboard, copyBoardToSystem, placeClipboardElements, type ClipboardContents, type ClipboardRegion } from "../features/board/clipboard";
import { boardMemberIds, resizeMainBoard, type MainBoardGeometry } from "../features/board/board-resize";
import { anchoredZoomScroll, clampZoom } from "../features/board/zoom";
import { elementColors, defaultFillColor } from "../features/board/element-colors";
import SaveAsDialog from "./SaveAsDialog";
import SpreadsheetElement from "./SpreadsheetElement";
import { createWorkbookDocument, readLiveWorkbookSnapshots } from "../features/spreadsheet/workbook";
import { createSavedBoard, createSavedTemplate, type SaveAsKind } from "../features/board/save-as";
import MenuSettingsBlock, { type PreviewMode } from "./MenuSettingsBlock";
import {
  resolveToolMenuSettingsForId,
  updateToolMenuSettingOverride,
  type ToolMenuSettingKey,
  type ToolMenuSettings,
  type ToolMenuSettingsOverrides,
} from "../features/tool-settings/model";
import { downloadBoardArchive, readBoardPackageFile } from "../features/board/board-package";
import { placeBoardPackage } from "../features/board/board-package-placement";
import { createElementHierarchy, type ElementHierarchy } from "../features/board/element-hierarchy";
import { constrainProportionalSize, resizeHandleSize } from "../features/board/resize-geometry";
import { getTextScale, isScalableText, isTextScaling, displayedTextFontSize, resizedTextScale } from "../features/board/text-scaling";
import {
  getMinimumAreaRect,
  hasMeaningfulAreaDrag,
  isBoardPlacementSurface,
  shouldPreservePresetPicking,
  usesAreaPlacement,
} from "../features/board/placement-interaction";
import { cloneBoardDocument } from "../features/board/clone-board-document";
import {
  resolveObjectPlacementProps,
  type PendingPropsBaseline,
} from "../features/board/object-defaults";
import { removeElementTreeAndReferences } from "../features/board/element-removal";
import { LinkTargetInput } from "../features/board/LinkTargetInput";
import {
  createBoardDocumentHistory,
  pushBoardDocumentHistory,
  redoBoardDocumentHistory,
  undoBoardDocumentHistory,
  equalDocumentValue,
  type BoardDocumentPresentation,
} from "../features/board/document-history";
import {
  clearWebSession as clearDesktopWebSession,
  configureWebSession as configureDesktopWebSession,
} from "../lib/storage";
import {
  Move,
  Table2,
  Lasso,
  LassoSelect,
  Crop,
  Pipette,
  ArrowLeft,
  Undo2,
  Redo2,
  Plus,
  Type,
  Heading1,
  CheckSquare,
  Square,
  SquareDashed,
  StickyNote,
  Image as ImageIcon,
  Link2,
  Globe2,
  Music,
  Film,
  Play,
  Pause,
  Repeat2,
  PenTool,
  ArrowUpRight,
  Palette,
  Copy,
  ClipboardPaste,
  Save,
  Trash2,
  Settings2,
  Download,
  MousePointer2,
  ChevronDown,
  ChevronRight,
  Lock,
  Unlock,
  Hand,
  Equal,
  Circle,
  Triangle,
  Minus,
  LayoutTemplate,
  Bold,
  Italic,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Eye,
  EyeOff,
  Layers,
  FlipHorizontal,
  FlipVertical,
  Eraser,
  List,
  ListOrdered,
  LayoutGrid,
  Maximize,
  X,
  Check,
  PaintBucket,
  Volume2,
  ZoomIn,
  Keyboard,
  RotateCw,
  Monitor,
  Smartphone,
  Tablet,
  Shield,
  ShieldOff,
  Cookie,
  RotateCcw,
  Ellipsis,
  Wrench,
} from "lucide-react";
import { motion, AnimatePresence, useDragControls } from "motion/react";

import {
  assertFileSize,
  MAX_MEDIA_FILE_BYTES,
} from "../../shared/board-data.js";

// Simplify and smooth points for drawing
function douglasPeucker(
  points: { x: number; y: number }[],
  epsilon: number,
): { x: number; y: number }[] {
  if (points.length <= 2) return points;
  let maxDist = 0;
  let index = 0;
  const end = points.length - 1;
  for (let i = 1; i < end; i++) {
    const num = Math.abs(
      (points[end].y - points[0].y) * points[i].x -
        (points[end].x - points[0].x) * points[i].y +
        points[end].x * points[0].y -
        points[end].y * points[0].x,
    );
    const den = Math.hypot(
      points[end].y - points[0].y,
      points[end].x - points[0].x,
    );
    const dist =
      den === 0
        ? Math.hypot(points[i].x - points[0].x, points[i].y - points[0].y)
        : num / den;
    if (dist > maxDist) {
      maxDist = dist;
      index = i;
    }
  }
  if (maxDist > epsilon) {
    const left = douglasPeucker(points.slice(0, index + 1), epsilon);
    const right = douglasPeucker(points.slice(index), epsilon);
    return left.slice(0, -1).concat(right);
  }
  return [points[0], points[end]];
}

function simplifyPoints(
  points: { x: number; y: number }[],
  strength: number = 5,
): { x: number; y: number }[] {
  if (points.length <= 3) return points;

  const windowSize = Math.max(2, Math.floor(strength * 1.6));
  const tolerance = Math.max(1, strength * 1.0);

  const smoothPass = (pts: { x: number; y: number }[]) => {
    const smoothed = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      let sumX = 0,
        sumY = 0,
        count = 0;
      for (
        let j = Math.max(0, i - windowSize);
        j <= Math.min(pts.length - 1, i + windowSize);
        j++
      ) {
        sumX += pts[j].x;
        sumY += pts[j].y;
        count++;
      }
      smoothed.push({ x: sumX / count, y: sumY / count });
    }
    smoothed.push(pts[pts.length - 1]);
    return smoothed;
  };

  // 1. Double Strong Moving Average Smoothing
  let smoothed = smoothPass(points);
  smoothed = smoothPass(smoothed);

  // 2. Distance-based step filtering (removes jittery microscopic movements)
  const filtered = [smoothed[0]];
  let lastPoint = smoothed[0];
  for (let i = 1; i < smoothed.length - 1; i++) {
    const p = smoothed[i];
    const dist = Math.hypot(p.x - lastPoint.x, p.y - lastPoint.y);
    if (dist > tolerance) {
      filtered.push(p);
      lastPoint = p;
    }
  }
  filtered.push(smoothed[smoothed.length - 1]);
  return filtered;
}

// Get SVG path from points (constant thickness, optional smoothing)
function getSvgPathFromPoints(
  points: { x: number; y: number }[],
  smooth: boolean = false,
  strength: number = 5,
) {
  if (!points || points.length === 0) return "";
  if (points.length === 1)
    return `M ${points[0].x} ${points[0].y} L ${points[0].x} ${points[0].y}`;
  if (!smooth) return `M ${points.map((p) => `${p.x},${p.y}`).join(" L ")}`;

  const pts = simplifyPoints(points, strength);

  if (pts.length <= 2)
    return `M ${pts.map((p) => `${p.x},${p.y}`).join(" L ")}`;

  let d = `M ${pts[0].x},${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const xc = (pts[i].x + pts[i + 1].x) / 2;
    const yc = (pts[i].y + pts[i + 1].y) / 2;
    d += ` Q ${pts[i].x},${pts[i].y} ${xc},${yc}`;
  }
  d += ` L ${pts[pts.length - 1].x},${pts[pts.length - 1].y}`;
  return d;
}

const TEXT_TYPES = ["text", "h1", "h2", "h3", "bullet-list", "numbered-list"];
const isTextToolActive = (tool?: string) =>
  TEXT_TYPES.includes(tool ?? "") || tool === "sticky";
const SHAPE_TYPES = [
  "section",
  "ellipse",
  "triangle",
  "diamond",
  "hexagon",
  "rectangle",
  "arrow",
  "line",
];

interface Props {
  page: Page;
  onBack: () => void;
  onSave: (page: Page, options?: { keepalive?: boolean }) => void;
  /** Persist a duplicate board without replacing the currently open board. */
  onSaveAs?: (page: Page) => void | Promise<boolean>;
  onSavePreset: (preset: Preset) => void | Promise<boolean>;
}

const QUICK_ADD_TOOLS: {
  type: ElementType;
  icon: React.ElementType;
  label: string;
}[] = [
  { type: "text", icon: Type, label: "Text" },
  { type: "sticky", icon: StickyNote, label: "Sticky" },
  { type: "section", icon: Square, label: "Rectangle" },
  { type: "line", icon: Minus, label: "Line" },
  { type: "arrow", icon: ArrowUpRight, label: "Arrow" },
  { type: "media", icon: ImageIcon, label: "Media" },
  { type: "embed", icon: Globe2, label: "Web" },
  { type: "board", icon: LayoutGrid, label: "Board" },
  { type: "blank", icon: SquareDashed, label: "Blank" },
];

type ObjectPreset = {
  id: string;
  name: string;
  element?: BoardElement;
  elements?: BoardElement[];
  shortcut?: string;
};

type ObjectDefaults = Partial<Record<ElementType, Partial<BoardElement>>>;

type WebDeviceMode = "desktop" | "tablet" | "phone";
type WebCookieBlockerMode = "off" | "third-party" | "all";

const WEB_COOKIE_BLOCKER_LABELS: Record<WebCookieBlockerMode, string> = {
  off: "Off",
  "third-party": "Third-party",
  all: "All",
};

const getWebSettings = (element: Partial<BoardElement>) => ({
  rememberSession: element.webRememberSession !== false,
  deviceMode: normalizeWebDeviceMode(element.webDeviceMode) as WebDeviceMode,
  adBlock: element.webAdBlock !== false,
  cookieBlocker: (element.webCookieBlocker || "off") as WebCookieBlockerMode,
  popupBlocker: element.webPopupBlocker === true,
});

const getWebSessionId = (element: Partial<BoardElement>) =>
  element.webSessionId || element.id || "default";

const getWebPartition = (element: Partial<BoardElement>) => {
  const settings = getWebSettings(element);
  const id = String(getWebSessionId(element)).replace(/[^a-zA-Z0-9_-]/g, "");
  return settings.rememberSession
    ? `persist:noteboard-web-${id || "default"}`
    : `noteboard-web-${id || "temporary"}`;
};

const getWebElementDefaults = (
  source: Partial<BoardElement> = {},
): Partial<BoardElement> => {
  const settings = getWebSettings(source);
  return {
    mediaKind: "web",
    webSessionId: generateId(),
    webRememberSession: settings.rememberSession,
    webDeviceMode: settings.deviceMode,
    webAdBlock: settings.adBlock,
    webCookieBlocker: settings.cookieBlocker,
    webPopupBlocker: settings.popupBlocker,
  };
};

const configureElectronWebSession = (
  element: Partial<BoardElement>,
  topLevelUrl?: string,
) => {
  const settings = getWebSettings(element);
  return configureDesktopWebSession({
    partition: getWebPartition(element),
    settings: {
      topLevelUrl: normalizeWebUrl(topLevelUrl || element.content),
      adBlock: settings.adBlock,
      cookieBlocker: settings.cookieBlocker,
      popupBlocker: settings.popupBlocker,
    },
  }).catch(() => false);
};

const clearElectronWebSession = (element: Partial<BoardElement>) =>
  clearDesktopWebSession(getWebPartition(element)).catch(() => false);

const hasDesktopWebRuntime = () =>
  typeof window !== "undefined" &&
  typeof (window as any).noteboardAPI?.configureWebSession === "function";

const TOOLBAR_ITEMS: {
  id: ToolbarItemId;
  label: string;
  icon: React.ElementType;
  slots?: number;
}[] = [
  { id: "generalSettings", label: "General", icon: Settings2 },
  { id: "toolDefaults", label: "Global Tool Settings", icon: Wrench },
  { id: "presetSettings", label: "Presets", icon: ClipboardPaste },
  { id: "behaviorSettings", label: "Behavior", icon: Shield },
  { id: "shortcutSettings", label: "Shortcuts", icon: Keyboard },
  { id: "zoom", label: "Zoom", icon: ZoomIn },
  { id: "select", label: "Select", icon: MousePointer2, slots: 2 },
  { id: "pan", label: "Hand", icon: Hand, slots: 2 },
  { id: "text", label: "Text", icon: Type, slots: 2 },
  { id: "shapes", label: "Shapes", icon: Square, slots: 2 },
  { id: "media", label: "Media", icon: ImageIcon, slots: 2 },
  { id: "draw", label: "Draw", icon: PenTool, slots: 2 },
  { id: "fill", label: "Fill", icon: PaintBucket, slots: 2 },
  { id: "eraser", label: "Eraser", icon: Eraser, slots: 2 },
  { id: "embed", label: "Web", icon: Globe2, slots: 2 },
  { id: "board", label: "New Board", icon: BoardSettingsIcon, slots: 2 },
  { id: "link", label: "Object Links", icon: Link2, slots: 2 },
  { id: "table", label: "Spreadsheet", icon: Table2, slots: 2 },
  { id: "polygon-select", label: "Polygon selection", icon: LassoSelect, slots: 2 },
  { id: "lasso", label: "Lasso", icon: Lasso, slots: 2 },
  { id: "crop", label: "Crop", icon: Crop, slots: 2 },
  { id: "eyedropper", label: "Eyedropper", icon: Pipette, slots: 2 },
  {
    id: "object-presets",
    label: "Object Presets",
    icon: ClipboardPaste,
    slots: 2,
  },
  { id: "more", label: "More", icon: Ellipsis },
  { id: "grid", label: "Board Settings", icon: BoardSettingsIcon },
  { id: "layers", label: "Layers", icon: Layers, slots: 3 },
  { id: "save", label: "Save", icon: Download, slots: 2 },
];

const SETTINGS_SECTIONS: {
  id: GeneralSettingsSectionId;
  label: string;
  icon: React.ElementType;
}[] = [
  {
    id: "grid",
    label: "Board Settings",
    icon: BoardSettingsIcon,
  },
  {
    id: "toolDefaults",
    label: "Global Tool Settings",
    icon: Wrench,
  },
  {
    id: "presetSettings",
    label: "Presets",
    icon: ClipboardPaste,
  },
  {
    id: "behaviorSettings",
    label: "Physics & Behavior",
    icon: Shield,
  },
  {
    id: "shortcutSettings",
    label: "Shortcuts & Zoom",
    icon: Keyboard,
  },
];

const SETTINGS_SECTION_BY_ID = new Map(
  SETTINGS_SECTIONS.map((section) => [section.id, section]),
);

type GeneralSettingsAccordionId =
  | "toolbarCustomization"
  | GeneralSettingsSectionId;

const TOOLBAR_SLOT_WIDTH = 36;
const TOOLBAR_SLOT_HEIGHT = 34;
const DEFAULT_TOOLBAR_START_SLOT = 2;

const BASE_COLORS = ["#ffffff", "#000000"];
const GRID_BASE_COLORS = ["#ffffff", "#000000", "#808080"];
const MEDIA_DEFAULT_SIZE = { width: 320, height: 200 };
const WEB_DEFAULT_SIZE = { width: 360, height: 220 };
const AUDIO_DEFAULT_SIZE = { width: 320, height: 86 };
const MIN_MEDIA_SIZE = { width: 180, height: 96 };
const MIN_WEB_SIZE = { width: 240, height: 140 };
const VIDEO_PLAYBACK_RATES = [0.5, 1, 1.25, 1.5, 2];

const normalizeAngle = (angle: number) => ((angle % 360) + 360) % 360;
const normalizeAngleDelta = (angle: number) =>
  ((((angle + 180) % 360) + 360) % 360) - 180;
const getNextVideoPlaybackRate = (current?: number) => {
  const active = current || 1;
  const index = VIDEO_PLAYBACK_RATES.findIndex((rate) => rate >= active);
  if (index === -1) return VIDEO_PLAYBACK_RATES[0];
  const normalizedIndex =
    Math.abs(VIDEO_PLAYBACK_RATES[index] - active) < 0.01 ? index : index - 1;
  return VIDEO_PLAYBACK_RATES[
    (Math.max(0, normalizedIndex) + 1) % VIDEO_PLAYBACK_RATES.length
  ];
};

const getElementMinSize = (element: Pick<BoardElement, "type" | "mediaMime">) => {
  if (element.type === "table") return { width: 280, height: 180 };
  if (element.type === "embed") return MIN_WEB_SIZE;
  if (element.type === "media") {
    if (element.mediaMime?.startsWith("audio/")) return AUDIO_DEFAULT_SIZE;
    return MIN_MEDIA_SIZE;
  }
  if (element.type === "image") return { width: 80, height: 60 };
  if (
    [
      "rectangle",
      "ellipse",
      "triangle",
      "diamond",
      "hexagon",
      "section",
      "board",
    ].includes(element.type)
  ) {
    // These visuals have a 5 px rendering floor. Applying the same floor to
    // the resize model lets proportional resizing raise the paired dimension
    // as well instead of letting CSS distort the result at tiny sizes.
    return { width: 5, height: 5 };
  }
  return { width: 1, height: 1 };
};

const getScaledMediaSize = (
  width: number,
  height: number,
  maxWidth = 480,
  maxHeight = 320,
) => {
  const safeWidth = Math.max(1, width || MEDIA_DEFAULT_SIZE.width);
  const safeHeight = Math.max(1, height || MEDIA_DEFAULT_SIZE.height);
  // Preserve the source aspect ratio. The previous independent min-width and
  // min-height clamps stretched small or very wide images into a different
  // shape. We may scale a small image up to a usable size, but never beyond
  // the normal media bounds.
  const maxScale = Math.min(maxWidth / safeWidth, maxHeight / safeHeight);
  const minScale = Math.max(
    MIN_MEDIA_SIZE.width / safeWidth,
    MIN_MEDIA_SIZE.height / safeHeight,
    1,
  );
  const scale = Math.min(maxScale, minScale);
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
};

const inferMediaMime = (content?: string, fallback?: string) => {
  if (fallback) return fallback;
  if (!content) return "";
  if (content.startsWith("data:")) {
    return content.slice(5, content.indexOf(";") === -1 ? undefined : content.indexOf(";"));
  }
  if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(content)) return "image/url";
  if (/\.(mp4|webm|ogg|mov)(\?|#|$)/i.test(content)) return "video/url";
  if (/\.(mp3|wav|ogg|m4a|aac)(\?|#|$)/i.test(content)) return "audio/url";
  return "";
};

const inferFileMime = (file: File) =>
  file.type || inferMediaMime(file.name) || "";

const isSupportedMediaMime = (mime: string) =>
  mime.startsWith("image/") ||
  mime === "image/url" ||
  mime.startsWith("video/") ||
  mime === "video/url" ||
  mime.startsWith("audio/") ||
  mime === "audio/url";

const isBoardPackageFile = (file: File) => /\.(json|zip)$/i.test(file.name);

const clampCrop = (value: number) => Math.max(0, Math.min(95, value));

const normalizeCrop = (crop: BoardElement["crop"]) => {
  const next = {
    left: clampCrop(crop?.left || 0),
    top: clampCrop(crop?.top || 0),
    right: clampCrop(crop?.right || 0),
    bottom: clampCrop(crop?.bottom || 0),
  };

  if (next.left + next.right > 95) {
    if (next.left >= next.right) next.left = 95 - next.right;
    else next.right = 95 - next.left;
  }
  if (next.top + next.bottom > 95) {
    if (next.top >= next.bottom) next.top = 95 - next.bottom;
    else next.bottom = 95 - next.top;
  }

  return next;
};

const hasCrop = (crop?: BoardElement["crop"]) =>
  !!crop &&
  [crop.left, crop.top, crop.right, crop.bottom].some(
    (value) => (value || 0) > 0,
  );

const getCropRenderMetrics = (
  size?: BoardElement["size"],
  crop?: BoardElement["crop"],
) => {
  if (!size || !hasCrop(crop)) return null;
  const { left, top, right, bottom } = normalizeCrop(crop);
  const visibleWidth = Math.max(1, 100 - left - right);
  const visibleHeight = Math.max(1, 100 - top - bottom);
  const contentWidth = size.width / (visibleWidth / 100);
  const contentHeight = size.height / (visibleHeight / 100);
  return {
    contentWidth,
    contentHeight,
    offsetX: -(left / 100) * contentWidth,
    offsetY: -(top / 100) * contentHeight,
  };
};

const toTitleCase = (value: string) =>
  value
    .replace(/-/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());

const isElementDescendantOf = (
  element: BoardElement,
  ancestorId: string,
  elements: BoardElement[],
) => {
  const visited = new Set<string>();
  let currentParentId = element.parentId;
  while (currentParentId && !visited.has(currentParentId)) {
    visited.add(currentParentId);
    if (currentParentId === ancestorId) return true;
    currentParentId = elements.find((el) => el.id === currentParentId)?.parentId;
  }
  return false;
};

const getElementStackPath = (
  element: BoardElement,
  elements: BoardElement[],
) => {
  const ancestors: number[] = [];
  const visited = new Set<string>();
  let currentParentId = element.parentId;
  while (currentParentId && !visited.has(currentParentId)) {
    visited.add(currentParentId);
    const parent = elements.find((el) => el.id === currentParentId);
    if (!parent) break;
    ancestors.unshift(parent.zIndex);
    currentParentId = parent.parentId;
  }
  return [...ancestors, element.zIndex];
};

const compareElementStack = (
  a: BoardElement,
  b: BoardElement,
  elements: BoardElement[],
) => {
  const aPath = getElementStackPath(a, elements);
  const bPath = getElementStackPath(b, elements);
  const length = Math.max(aPath.length, bPath.length);
  for (let i = 0; i < length; i++) {
    const aValue = aPath[i] ?? aPath[i - 1] ?? 0;
    const bValue = bPath[i] ?? bPath[i - 1] ?? 0;
    if (aValue !== bValue) return aValue - bValue;
  }
  return a.id.localeCompare(b.id);
};

function ColorPicker({
  value,
  onChange,
  customColors,
  onAddCustomColor,
  allowTransparent = false,
  transparentTitle = "No Color",
  baseColors = BASE_COLORS,
  customSlots = 4,
}: {
  value?: string;
  onChange: (color: string) => void;
  customColors: string[];
  onAddCustomColor: (color: string, index: number) => void;
  allowTransparent?: boolean;
  transparentTitle?: string;
  baseColors?: string[];
  customSlots?: number;
}) {
  const [activeSlot, setActiveSlot] = useState<number | null>(null);

  return (
    <div className="color-palette flex shrink-0 items-center gap-1.5">
      {baseColors.map((c) => (
        <button
          key={`base-${c}`}
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onChange(c);
            setActiveSlot(null);
          }}
          className={cn(
            "w-4 h-4 rounded-full border-2 border-blue-500 flex items-center justify-center transition-transform hover:scale-110",
            value === c && "ring-2 ring-blue-600 border-blue-600 z-10",
          )}
          style={{ backgroundColor: c }}
        />
      ))}
      {Array.from({ length: customSlots }).map((_, i) => {
        const c = (customColors || ["", "", "", ""])[i];
        if (c) {
          return (
            <button
              key={`custom-${c}-${i}`}
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onChange(c);
                setActiveSlot(i);
              }}
              className={cn(
                "w-4 h-4 rounded-full border-2 border-blue-500 flex items-center justify-center transition-transform hover:scale-110",
                value === c && !baseColors.includes(c) && customColors.indexOf(c) === i && "ring-2 ring-blue-600 border-blue-600 z-10",
              )}
              style={{ backgroundColor: c }}
            />
          );
        }
        return (
          <button
            key={`empty-${i}`}
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              setActiveSlot(i);
            }}
            className={cn(
              "w-4 h-4 rounded-full border-[1.5px] border-blue-500 cursor-pointer transition-transform hover:scale-110",
              activeSlot === i && "outline outline-1 outline-gray-400",
            )}
            style={{
              backgroundColor: "#f9fafb",
              backgroundImage:
                "repeating-linear-gradient(0deg, transparent, transparent 1px, #ccc 1px, #ccc 2px), repeating-linear-gradient(90deg, transparent, transparent 1px, #ccc 1px, #ccc 2px)",
            }}
          />
        );
      })}
      {allowTransparent && (
        <button
          onPointerDown={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onChange("transparent");
            setActiveSlot(null);
          }}
          className={cn(
            "w-4 h-4 rounded-full border-[1.5px] border-blue-500 flex items-center justify-center bg-white transition-transform hover:scale-110",
            value === "transparent" &&
              "ring-2 ring-blue-600 border-blue-600 z-10",
          )}
          title={transparentTitle}
        >
          <div className="w-full h-full rounded-full border border-red-500 overflow-hidden relative">
            <div className="absolute top-1/2 left-[-20%] w-[140%] h-[1px] bg-red-500 -rotate-45" />
          </div>
        </button>
      )}
      <label className="w-4 h-4 rounded-full border-[1.5px] border-blue-500 flex items-center justify-center cursor-pointer hover:scale-110 overflow-hidden relative group bg-white">
        <Plus className="w-3 h-3 text-black absolute pointer-events-none group-hover:text-gray-700" />
        <input
          type="color"
          className="opacity-0 w-[200%] h-[200%] absolute cursor-pointer"
          value={value && /^#[0-9a-f]{6}$/i.test(value) ? value : "#000000"}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => {
            const col = e.target.value;
            // If a slot is active, update that one. Otherwise, find the first empty slot.
            let targetIndex = activeSlot;
            if (targetIndex === null) {
              const firstEmpty = (customColors || []).findIndex(
                (color) => !color,
              );
              targetIndex = firstEmpty !== -1 ? firstEmpty : 3;
            }
            onChange(col);
            onAddCustomColor(col, targetIndex);
            setActiveSlot(targetIndex);
          }}
        />
      </label>
    </div>
  );
}

const getClippedRect = (
  overlapMode: "none" | "partial" | "full",
  activeTool: string,
  dragStart: { x: number; y: number },
  dragCurrent: { x: number; y: number },
  elements: BoardElement[],
  gridSize: number,
  pageDimensions: { width: number; height: number },
  bounds?: { minX: number; minY: number; maxX: number; maxY: number },
) => {
  let cx = dragCurrent.x;
  let cy = dragCurrent.y;
  let sx = dragStart.x;
  let sy = dragStart.y;
  const clipBounds = bounds ?? {
    minX: 0,
    minY: 0,
    maxX: pageDimensions.width,
    maxY: pageDimensions.height,
  };

  // Cage mode removed to allow placing elements on secondary boards or workspace, but restored conditionally
  if (
    activeTool !== "select" &&
    activeTool !== "pan" &&
    activeTool !== "board"
  ) {
    if (cx < clipBounds.minX) cx = clipBounds.minX;
    if (cy < clipBounds.minY) cy = clipBounds.minY;
    if (cx > clipBounds.maxX) cx = clipBounds.maxX;
    if (cy > clipBounds.maxY) cy = clipBounds.maxY;
    if (sx < clipBounds.minX) sx = clipBounds.minX;
    if (sy < clipBounds.minY) sy = clipBounds.minY;
    if (sx > clipBounds.maxX) sx = clipBounds.maxX;
    if (sy > clipBounds.maxY) sy = clipBounds.maxY;
  }

  if (
    overlapMode !== "none" &&
    activeTool !== "select" &&
    activeTool !== "pan" &&
    activeTool !== "section" &&
    activeTool !== "board"
  ) {
    const isInside = (el: BoardElement, x: number, y: number) => {
      const ew = el.size?.width || 100;
      const eh = el.size?.height || 40;
      return (
        x > el.position.x &&
        x < el.position.x + ew &&
        y > el.position.y &&
        y < el.position.y + eh
      );
    };

    const obstacles = elements.filter(
      (el) =>
        el.type !== "section" && el.type !== "board" && !isInside(el, sx, sy),
    );

    if (overlapMode === "partial") {
      let currentCx = cx;
      let currentCy = cy;

      const resolve = () => {
        let changed = false;
        obstacles.forEach((el) => {
          const ex1 = el.position.x;
          const ey1 = el.position.y;
          const ex2 = ex1 + (el.size?.width || 100);
          const ey2 = ey1 + (el.size?.height || 40);

          const minX = Math.min(sx, currentCx);
          const maxX = Math.max(sx, currentCx);
          const minY = Math.min(sy, currentCy);
          const maxY = Math.max(sy, currentCy);

          if (maxX > ex1 && minX < ex2 && maxY > ey1 && minY < ey2) {
            let penRight = currentCx > sx ? currentCx - ex1 : 0;
            let penLeft = currentCx < sx ? ex2 - currentCx : 0;
            let penBottom = currentCy > sy ? currentCy - ey1 : 0;
            let penTop = currentCy < sy ? ey2 - currentCy : 0;

            let penX = Math.max(penRight, penLeft);
            let penY = Math.max(penBottom, penTop);

            if (sx >= ex1 && sx <= ex2) penX = Infinity;
            if (sy >= ey1 && sy <= ey2) penY = Infinity;

            if (penX < penY) {
              if (currentCx > sx) currentCx = ex1;
              else currentCx = ex2;
            } else {
              if (currentCy > sy) currentCy = ey1;
              else currentCy = ey2;
            }
            changed = true;
          }
        });
        return changed;
      };

      for (let i = 0; i < 3; i++) {
        if (!resolve()) break;
      }
      cx = currentCx;
      cy = currentCy;
    } else if (overlapMode === "full") {
      // Just check if the current rect intersects any obstacle
      const minX = Math.min(sx, cx);
      const minY = Math.min(sy, cy);
      const w = Math.abs(cx - sx);
      const h = Math.abs(cy - sy);

      const isColliding = obstacles.some((el) => {
        const ew = el.size?.width || 100;
        const eh = el.size?.height || 40;
        return (
          minX < el.position.x + ew &&
          minX + w > el.position.x &&
          minY < el.position.y + eh &&
          minY + h > el.position.y
        );
      });

      if (isColliding) return null;
    }
  }

  let minX = Math.min(sx, cx);
  let minY = Math.min(sy, cy);
  let w = Math.abs(cx - sx);
  let h = Math.abs(cy - sy);

  if (
    activeTool !== "select" &&
    activeTool !== "pan" &&
    activeTool !== "board"
  ) {
    if (w < gridSize) {
      w = gridSize;
      minX = cx < sx ? sx - gridSize : sx;
    }
    if (h < gridSize) {
      h = gridSize;
      minY = cy < sy ? sy - gridSize : sy;
    }

    // Final clamp to ensure we didn't push borders out of bounds due to minimum grid size
    if (minX < clipBounds.minX) minX = clipBounds.minX;
    if (minY < clipBounds.minY) minY = clipBounds.minY;
    if (minX + w > clipBounds.maxX) w = clipBounds.maxX - minX;
    if (minY + h > clipBounds.maxY) h = clipBounds.maxY - minY;
  }

  return { x: minX, y: minY, w, h };
};

export const handleImageUpload = (
  file: File,
  callback: (dataUrl: string, width: number, height: number) => void,
  onError?: (error: Error) => void,
) => {
  const fail=(error:Error)=>onError?onError(error):alert(error.message);
  try {
    assertFileSize(file.size, MAX_MEDIA_FILE_BYTES, "Media file");
  } catch (error) {
    fail(error instanceof Error ? error : new Error("Media file is too large."));
    return;
  }
  const reader = new FileReader();
  reader.onerror=()=>fail(new Error('Could not read the image file.'));
  reader.onabort=()=>fail(new Error('Image import was interrupted.'));
  reader.onload = (e) => {
    const img = new Image();
    img.onerror=()=>fail(new Error('The image could not be opened. Check its file format.'));
    img.onload = () => {
      let w = img.width;
      let h = img.height;
      if (file.type === "image/gif" || /\.gif$/i.test(file.name)) {
        callback(e.target?.result as string, img.width, img.height);
        return;
      }
      if (w > 1200 || h > 1200) {
        if (w > h) {
          h = h * (1200 / w);
          w = 1200;
        } else {
          w = w * (1200 / h);
          h = 1200;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.drawImage(img, 0, 0, w, h);
        callback(
          canvas.toDataURL(
            file.type === "image/png" ? "image/png" : "image/webp",
            0.85,
          ),
          img.width,
          img.height,
        );
      } else {
        callback(e.target?.result as string, img.width, img.height);
      }
    };
    img.src = e.target?.result as string;
  };
  reader.readAsDataURL(file);
};

export default function BoardEditor({
  page,
  onBack,
  onSave,
  onSaveAs,
  onSavePreset,
}: Props) {
  const initialEditorSettings = page.editorSettings ?? {};
  const [pageDimensions, setPageDimensions] = useState({
    width: page.width || 1024,
    height: page.height || 1024,
  });
  const [boardPosition, setBoardPosition] = useState({
    x:
      page.boardX ??
      (page.workspaceWidth || 100000) / 2 - (page.width || 1024) / 2,
    y:
      page.boardY ??
      (page.workspaceHeight || 100000) / 2 - (page.height || 1024) / 2,
  });
  const [keepBoardContentPosition,setKeepBoardContentPosition]=useState(initialEditorSettings.keepBoardContentPosition ?? true);
  const boardGeometryRef=useRef<MainBoardGeometry>({size:pageDimensions,position:boardPosition});
  boardGeometryRef.current={size:pageDimensions,position:boardPosition};
  const applyMainBoardGeometry=(geometry:MainBoardGeometry)=>{boardGeometryRef.current=geometry;setPageDimensions(geometry.size);setBoardPosition(geometry.position);};
  const secondaryResizeRef=useRef<{id:string;origin:{x:number;y:number};elements:BoardElement[];members:Set<string>;keepContent:boolean}|null>(null);
  const beginSecondaryBoardResize=(id:string)=>{const board=elementsRef.current.find(element=>element.id===id);if(board)secondaryResizeRef.current={id,origin:{...board.position},elements:elementsRef.current,members:boardMemberIds(elementsRef.current,id,pageDimensions),keepContent:keepBoardContentPosition};};
  const initialSectionSheets = page.sectionSheets ?? [];
  const desktopWebRuntime = hasDesktopWebRuntime();
  const [elements, setElements] = useState<BoardElement[]>(page.elements);
  const elementsRef = useRef<BoardElement[]>(page.elements);
  const elementHierarchy = useMemo(
    () => createElementHierarchy(elements),
    [elements],
  );
  const elementTypeIndexById = useMemo(() => {
    const counts = new Map<ElementType, number>();
    const indexes = new Map<string, number>();
    elements.forEach((element) => {
      const nextIndex = (counts.get(element.type) ?? 0) + 1;
      counts.set(element.type, nextIndex);
      indexes.set(element.id, nextIndex);
    });
    return indexes;
  }, [elements]);
  const [sectionSheets, setSectionSheets] =
    useState<SectionSheet[]>(initialSectionSheets);
  const sectionSheetsRef = useRef<SectionSheet[]>(initialSectionSheets);
  const presentationRef=useRef<BoardDocumentPresentation>({
    title:page.title,boardColor:page.boardColor??'#ffffff',gridColor:page.gridColor??'#e2e8f0',
    gridSize:page.gridSize??24,gridThickness:page.gridThickness??1,showGrid:page.showGrid??false,snapToGrid:page.snapToGrid??false,
  });
  const [documentHistory, setDocumentHistory] = useState(() =>
    createBoardDocumentHistory({
      elements: page.elements,
      sectionSheets: initialSectionSheets,
      boardGeometry: boardGeometryRef.current,
      presentation:presentationRef.current,
    }),
  );
  const documentHistoryRef = useRef(documentHistory);
  const history = documentHistory.entries;
  const historyIndex = documentHistory.index;
  const linkDragControls = useDragControls();

  const pushDocument = (
    newElements: BoardElement[],
    newSectionSheets: SectionSheet[] = sectionSheetsRef.current,
  ) => {
    const nextHistory = pushBoardDocumentHistory(
      documentHistoryRef.current,
      { elements: newElements, sectionSheets: newSectionSheets, boardGeometry: boardGeometryRef.current, presentation:presentationRef.current },
      50,
    );
    documentHistoryRef.current = nextHistory;
    setDocumentHistory(nextHistory);
    elementsRef.current = newElements;
    sectionSheetsRef.current = newSectionSheets;
    setElements(newElements);
    setSectionSheets(newSectionSheets);
  };

  const pushElements = (newElements: BoardElement[]) =>
    pushDocument(newElements, sectionSheetsRef.current);

  useEffect(() => {
    elementsRef.current = elements;
  }, [elements]);

  useEffect(() => {
    sectionSheetsRef.current = sectionSheets;
  }, [sectionSheets]);

  const handleUndo = () => {
    pushDocument(syncLiveEditableState(elementsRef.current));
    const nextHistory = undoBoardDocumentHistory(documentHistoryRef.current);
    if (nextHistory !== documentHistoryRef.current) {
      documentHistoryRef.current = nextHistory;
      setDocumentHistory(nextHistory);
      const snapshot = nextHistory.entries[nextHistory.index];
      elementsRef.current = snapshot.elements;
      sectionSheetsRef.current = snapshot.sectionSheets;
      setElements(snapshot.elements);
      setSectionSheets(snapshot.sectionSheets);
      if(snapshot.boardGeometry) applyMainBoardGeometry(snapshot.boardGeometry);
      if(snapshot.presentation) applyPresentation(snapshot.presentation);
      setSelectedId(null);
    }
  };

  const handleRedo = () => {
    pushDocument(syncLiveEditableState(elementsRef.current));
    const nextHistory = redoBoardDocumentHistory(documentHistoryRef.current);
    if (nextHistory !== documentHistoryRef.current) {
      documentHistoryRef.current = nextHistory;
      setDocumentHistory(nextHistory);
      const snapshot = nextHistory.entries[nextHistory.index];
      elementsRef.current = snapshot.elements;
      sectionSheetsRef.current = snapshot.sectionSheets;
      setElements(snapshot.elements);
      setSectionSheets(snapshot.sectionSheets);
      if(snapshot.boardGeometry) applyMainBoardGeometry(snapshot.boardGeometry);
      if(snapshot.presentation) applyPresentation(snapshot.presentation);
      setSelectedId(null);
    }
  };

  const [title, setTitle] = useState(page.title);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectedId=selectedIds.length===1?selectedIds[0]:null;
  const setSelectedId=(id:string|null)=>setSelectedIds(id?[id]:[]);
  const groupMoveRef=useRef<{pointerId:number;x:number;y:number;elements:BoardElement[];ids:Set<string>;changed:boolean;preview:'box'|'realistic';latest?:BoardElement[]}|null>(null);
  const selectionOutlineRef=useRef<HTMLDivElement>(null);
  const [customColors, setCustomColors] = useState<Record<string, string[]>>({
    bg: initialEditorSettings.customColors?.bg ?? ["", "", "", ""],
    text: initialEditorSettings.customColors?.text ?? ["", "", "", ""],
    border: initialEditorSettings.customColors?.border ?? ["", "", "", ""],
    grid: initialEditorSettings.customColors?.grid ?? ["", "", "", ""],
    fill: initialEditorSettings.customColors?.fill ?? ["", "", "", ""],
  });
  const containerRef = useRef<HTMLDivElement>(null);
  const boardSurfaceRef = useRef<HTMLDivElement>(null);
  const pointerDownTime = useRef<number>(0);
  const activePointerIdRef = useRef<number | null>(null);
  const pointerCaptureTargetRef = useRef<HTMLElement | null>(null);
  const areaGestureRef = useRef<{
    pointerId: number;
    tool: string;
    start: { x: number; y: number };
    current: { x: number; y: number };
    startedAt: number;
    moved: boolean;
    activated: boolean;
  } | null>(null);
  const activeSurfaceBoundsRef = useRef<{
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
  } | null>(null);



  const [workspaceDimensions] = useState({
    width: page.workspaceWidth || 100000,
    height: page.workspaceHeight || 100000,
  });

  useEffect(() => {
    if (containerRef.current) {
      const container = containerRef.current;
      const centerX = page.viewportCenterX ?? (
        page.scrollX !== undefined
          ? page.scrollX + container.clientWidth / 2
          : workspaceDimensions.width / 2
      );
      const centerY = page.viewportCenterY ?? (
        page.scrollY !== undefined
          ? page.scrollY + container.clientHeight / 2
          : workspaceDimensions.height / 2
      );
      containerRef.current.scrollTo({
        left: centerX - container.clientWidth / 2,
        top: centerY - container.clientHeight / 2,
      });
    }
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let previousWidth = container.clientWidth;
    let previousHeight = container.clientHeight;
    const resizeObserver = new ResizeObserver(() => {
      const centerX = container.scrollLeft + previousWidth / 2;
      const centerY = container.scrollTop + previousHeight / 2;
      previousWidth = container.clientWidth;
      previousHeight = container.clientHeight;
      container.scrollTo({
        left: centerX - previousWidth / 2,
        top: centerY - previousHeight / 2,
      });
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, []);

  const [resizeMode, setResizeMode] = useState<
    | "left"
    | "right"
    | "top"
    | "bottom"
    | "both"
    | "top-left"
    | "top-right"
    | "bottom-left"
    | "bottom-right"
    | null
  >(null);
  const boardResizeStartRef = useRef<{
    clientX: number;
    clientY: number;
    width: number;
    height: number;
    boardX: number;
    boardY: number;
    elements: BoardElement[];
    members: Set<string>;
    keepContent: boolean;
    changed: boolean;
  } | null>(null);
  const beginMainBoardResize = (
    event: React.PointerEvent,
    mode: NonNullable<typeof resizeMode>,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    captureSurfacePointer(event);
    boardResizeStartRef.current = {
      clientX: event.clientX,
      clientY: event.clientY,
      width: pageDimensions.width,
      height: pageDimensions.height,
      boardX: boardPosition.x,
      boardY: boardPosition.y,
      elements: elementsRef.current, members: boardMemberIds(elementsRef.current,"main-board",pageDimensions),keepContent:keepBoardContentPosition,changed:false,
    };
    setSelectedId(null);
    setIsMainBoardSelected(true);
    setResizeMode(mode);
  };
  const [boardDragStart, setBoardDragStart] = useState<{
    x: number;
    y: number;
    startBx: number;
    startBy: number;
  } | null>(null);

  // Selection region state
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [dragCurrent, setDragCurrent] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [quickAddRegion, setQuickAddRegion] = useState<{
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);
  const [currentDrawPoints, setCurrentDrawPoints] = useState<
    { x: number; y: number }[] | null
  >(null);
  const [pendingProps, setPendingProps] = useState<Partial<BoardElement>>(
    initialEditorSettings.pendingProps ?? {},
  );

  const [keepToolActive, setKeepToolActive] = useState(
    initialEditorSettings.keepToolActive ?? true,
  );
  const [keepToolActiveFallback, setKeepToolActiveFallback] = useState<
    "select" | "pan"
  >(initialEditorSettings.keepToolActiveFallback ?? "select");
  const [toolModeShortcut, setToolModeShortcut] = useState(
    initialEditorSettings.toolModeShortcut ?? "F",
  );
  const [gridToggleShortcut, setGridToggleShortcut] = useState(
    initialEditorSettings.gridToggleShortcut ?? "B",
  );
  const [overlapShortcut, setOverlapShortcut] = useState(
    initialEditorSettings.overlapShortcut ?? "Ctrl+O",
  );
  const [cropShortcut, setCropShortcut] = useState(
    initialEditorSettings.cropShortcut ?? "Alt",
  );
  const [scrollZoomShortcut, setScrollZoomShortcut] = useState(
    initialEditorSettings.scrollZoomShortcut ?? "Ctrl",
  );
  const [zoomToCursor, setZoomToCursor] = useState(initialEditorSettings.zoomToCursor ?? true);
  const [cutShortcut, setCutShortcut] = useState(
    initialEditorSettings.cutShortcut ?? "Ctrl+X",
  );
  const [recordingShortcut, setRecordingShortcut] = useState<
    | "toolMode"
    | "gridToggle"
    | "overlap"
    | "crop"
    | "scrollZoom"
    | "cut"
    | null
  >(null);
  const [recordingPresetShortcutId, setRecordingPresetShortcutId] =
    useState<string | null>(null);
  const [, setShowToolFallbackDropdown] = useState(false);
  const [proportionalScale, setProportionalScale] = useState(
    initialEditorSettings.proportionalScale ?? false,
  );
  const [altResizeCrops, setAltResizeCrops] = useState(
    initialEditorSettings.altResizeCrops ?? true,
  );
  const [isAltKeyDown, setIsAltKeyDown] = useState(false);
  const [previewMode, setPreviewMode] = useState<"box" | "realistic">(
    initialEditorSettings.previewMode ?? "box",
  );
  const [alwaysOnTop, setAlwaysOnTop] = useState(
    initialEditorSettings.alwaysOnTop ?? false,
  );
  const [toolSettingsOverrides, setToolSettingsOverrides] = useState<ToolMenuSettingsOverrides>(
    initialEditorSettings.toolMenuSettingsOverrides ?? {},
  );
  const [isSelectionLockEnabled, setIsSelectionLockEnabled] = useState(
    initialEditorSettings.isSelectionLockEnabled ?? true,
  );
  const [selectionLockTime, setSelectionLockTime] = useState(
    initialEditorSettings.selectionLockTime ?? 250,
  );
  const [selectionLockTimeInput, setSelectionLockTimeInput] = useState(
    String(initialEditorSettings.selectionLockTime ?? 250),
  );
  const [isHoldingToCreate, setIsHoldingToCreate] = useState(false);
  const holdingTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showGrid, setShowGrid] = useState(page.showGrid ?? false);
  const [snapToGrid, setSnapToGrid] = useState(page.snapToGrid ?? false);
  const [enableObjectSnapping, setEnableObjectSnapping] = useState(
    initialEditorSettings.enableObjectSnapping ?? true,
  );
  const [smartGuidesEnabled,setSmartGuidesEnabled]=useState(initialEditorSettings.smartGuidesEnabled??true);
  const [eyedropperTarget,setEyedropperTarget]=useState<'fill'|'stroke'|'text'>('fill');
  const [sampledColor,setSampledColor]=useState('#000000'),[samplingError,setSamplingError]=useState('');
  const guidesOverlayRef=useRef<SmartGuidesHandle>(null);
  const setVisibleGuides=(guides:SmartGuide[])=>guidesOverlayRef.current?.setGuides(guides);
  const [activeTool, _setActiveTool] = useState<string>(
    initialEditorSettings.activeTool ?? "select",
  );
  const setActiveTool = (tool: string) => {
    if (activeTool !== tool) {
      if (
        [
          "rectangle",
          "ellipse",
          "triangle",
          "line",
          "arrow",
          "image",
          "media",
          "embed",
          "draw",
          "fill",
          "eraser",
        ].includes(tool)
      ) {
        setSelectedId(null);
      }
    }
    _setActiveTool(tool);
  };

  const [showShapeDropdown, setShowShapeDropdown] = useState(false);
  const [, setShowTextDropdown] = useState(false);
  const [showSelectDropdown, setShowSelectDropdown] = useState(false);
  const [autoSelectOnPlace, setAutoSelectOnPlace] = useState(
    initialEditorSettings.autoSelectOnPlace ?? true,
  );
  const [autoToolOnSelect, setAutoToolOnSelect] = useState(
    initialEditorSettings.autoToolOnSelect ?? false,
  );
  const [spinSnapEnabled, setSpinSnapEnabled] = useState(
    initialEditorSettings.spinSnapEnabled ?? false,
  );
  const [spinSnapDegrees, setSpinSnapDegrees] = useState(
    initialEditorSettings.spinSnapDegrees ?? 15,
  );
  const [showPanDropdown, setShowPanDropdown] = useState(false);
  const [showMediaSettingsDropdown, setShowMediaSettingsDropdown] = useState(
    false,
  );
  const [showEraserSettingsDropdown, setShowEraserSettingsDropdown] = useState(
    false,
  );
  const [showTextSettingsDropdown, setShowTextSettingsDropdown] = useState(
    false,
  );
  const [allowEditing, setAllowEditing] = useState(
    initialEditorSettings.allowEditing ?? true,
  );
  const [fillToolColor, setFillToolColor] = useState<string>(
    initialEditorSettings.fillToolColor ?? '#000000',
  );
  const [eraserMode, setEraserMode] = useState<'element' | 'partial'>(
    initialEditorSettings.eraserMode ?? 'element',
  );
  const [eraserSize, setEraserSize] = useState<number>(
    initialEditorSettings.eraserSize ?? 20,
  );
  const [eraserShape, setEraserShape] = useState<'round' | 'square'>(
    initialEditorSettings.eraserShape ?? 'round',
  );
  const [allowMovingElementsInPan, setAllowMovingElementsInPan] =
    useState(initialEditorSettings.allowMovingElementsInPan ?? false);
  const [showMoreToolsDropdown, setShowMoreToolsDropdown] = useState(false);
  const [expandedGeneralSettingsSections, setExpandedGeneralSettingsSections] =
    useState<Set<GeneralSettingsAccordionId>>(() => new Set());
  const [expandedMoreTools, setExpandedMoreTools] = useState<Set<string>>(
    () => new Set(),
  );
  const expandedMoreToolsRef = useRef<Set<string>>(new Set());
  const [showObjectPresetsPanel, setShowObjectPresetsPanel] = useState(false);
  const [pickingObjectPresetId, setPickingObjectPresetId] = useState<
    string | null
  >(null);
  const [objectDefaultsSaved, setObjectDefaultsSaved] = useState(false);
  const [objectDuplicated, setObjectDuplicated] = useState(false);
  const objectDuplicatedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const objectDefaultsSavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const [objectPresets, setObjectPresets] = useState<ObjectPreset[]>(
    initialEditorSettings.objectPresets ?? [],
  );
  const [objectDefaults, setObjectDefaults] = useState<ObjectDefaults>(
    initialEditorSettings.objectDefaults ?? {},
  );
  const objectDefaultsRef = useRef<ObjectDefaults>(
    initialEditorSettings.objectDefaults ?? {},
  );
  const pendingPropsBaselineRef = useRef<PendingPropsBaseline | null>(null);
  useEffect(() => {
    const defaults = objectDefaults[activeTool as ElementType];
    setPendingProps((current) => {
      const next = defaults ? { ...current, ...defaults } : current;
      pendingPropsBaselineRef.current = { tool: activeTool, props: { ...next } };
      return next;
    });
  }, [activeTool, objectDefaults]);
  const [toolbarCustomizeMode, setToolbarCustomizeMode] = useState(false);
  const [heldMoreTool, setHeldMoreTool] = useState<ToolbarItemId | null>(null);
  const [returnDraggingId, setReturnDraggingId] = useState<ToolbarItemId | null>(null);
  const returnDraggingIdRef = useRef<ToolbarItemId | null>(null);
  const returnDragCleanupRef = useRef<(() => void) | null>(null);
  const [moreDropActive, setMoreDropActive] = useState(false);
  const toolbarEditingMode = toolbarCustomizeMode || returnDraggingId !== null;
  useEffect(() => () => returnDragCleanupRef.current?.(), []);
  const [detachedMoreMenuId, setDetachedMoreMenuId] =
    useState<ToolbarItemId | null>(null);
  const [toolbarDragId, setToolbarDragId] = useState<ToolbarItemId | null>(
    null,
  );
  const toolbarDragIdRef = useRef<ToolbarItemId | null>(null);
  const [toolbarPreviewOrder, setToolbarPreviewOrder] = useState<
    ToolbarItemId[] | null
  >(null);
  const toolbarPreviewOrderRef = useRef<ToolbarItemId[] | null>(null);
  const [toolbarPreviewSlots, setToolbarPreviewSlots] = useState<
    Partial<Record<ToolbarItemId, number>> | null
  >(null);
  const toolbarPreviewSlotsRef = useRef<
    Partial<Record<ToolbarItemId, number>> | null
  >(null);
  const toolbarDragOriginSlotsRef = useRef<
    Partial<Record<ToolbarItemId, number>> | null
  >(null);
  const toolbarContainerRef = useRef<HTMLDivElement>(null);
  const [toolbarSlotCount, setToolbarSlotCount] = useState(32);
  const [toolbarContainerWidth, setToolbarContainerWidth] = useState(0);
  const toolbarDropCommittedRef = useRef(false);
  const toolbarReorderPendingRef = useRef<{
    targetSlot: number;
    pendingSince: number;
  } | null>(null);
  const [toolbarDragStatus, setToolbarDragStatus] = useState<{
    x: number;
    y: number;
    inside: boolean;
  } | null>(null);

  const captureSurfacePointer = (event: React.PointerEvent) => {
    try {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    } catch {
      // The browser can revoke a pointer immediately during cancellation.
    }
    activePointerIdRef.current = event.pointerId;
    pointerCaptureTargetRef.current = event.currentTarget as HTMLElement;
  };

  const clearAreaGesture = () => {
    if (holdingTimerRef.current) {
      clearTimeout(holdingTimerRef.current);
      holdingTimerRef.current = null;
    }
    areaGestureRef.current = null;
    setDragStart(null);
    setDragCurrent(null);
    setIsHoldingToCreate(false);
    setIsInteracting(false);
    activeSurfaceBoundsRef.current = null;
  };

  const beginAreaGesture = (
    point: { x: number; y: number },
    pointerId: number,
    tool: string,
  ) => {
    const startedAt = Date.now();
    const waitsForSelectionLock =
      usesAreaPlacement(tool) && isSelectionLockEnabled && selectionLockTime > 0;
    if (holdingTimerRef.current) {
      clearTimeout(holdingTimerRef.current);
      holdingTimerRef.current = null;
    }
    areaGestureRef.current = {
      pointerId,
      tool,
      start: point,
      current: point,
      startedAt,
      moved: false,
      activated: !waitsForSelectionLock,
    };
    setDragStart(point);
    setDragCurrent(point);
    setIsHoldingToCreate(!waitsForSelectionLock);

    if (waitsForSelectionLock) {
      holdingTimerRef.current = setTimeout(() => {
        const gesture = areaGestureRef.current;
        if (
          !gesture ||
          gesture.pointerId !== pointerId ||
          gesture.tool !== tool
        ) {
          return;
        }

        // Lock Time delays the beginning of the marquee. Rebase at the live
        // pointer position so the unlock moment always snaps to one board
        // cell instead of revealing movement accumulated during the delay.
        const activationPoint = { ...gesture.current };
        gesture.start = activationPoint;
        gesture.current = activationPoint;
        gesture.moved = false;
        gesture.activated = true;
        setDragStart(activationPoint);
        setDragCurrent(activationPoint);
        setIsHoldingToCreate(true);
        holdingTimerRef.current = null;
      }, Math.max(0, selectionLockTime));
    }
  };

  const updateAreaGesture = (point: { x: number; y: number }) => {
    const gesture = areaGestureRef.current;
    if (!gesture) return;
    gesture.current = point;
    gesture.moved =
      gesture.moved ||
      Math.hypot(point.x - gesture.start.x, point.y - gesture.start.y) > 3;
    setDragCurrent(point);
  };
  const [toolbarLayout, setToolbarLayout] = useState<ToolbarLayout>(() =>
    normalizeToolbarLayout(
      initialEditorSettings.toolbarLayout,
    ),
  );

  const [showDrawDropdown, setShowDrawDropdown] = useState(false);
  const [showFillDropdown, setShowFillDropdown] = useState(false);
  const toggleExpandedMoreTool = (toolId: string) => {
    setExpandedMoreTools((current) => {
      const next = new Set(current);
      if (next.has(toolId)) next.delete(toolId);
      else next.add(toolId);
      expandedMoreToolsRef.current = next;
      return next;
    });
  };
  const [panStart, setPanStart] = useState<{ x: number; y: number } | null>(
    null,
  );
  const [isInteracting, setIsInteracting] = useState(false);
  const [zoom, setZoom] = useState(clampZoom(page.zoom ?? 1));
  const zoomRef = useRef(zoom);
  useEffect(() => { zoomRef.current = zoom; }, [zoom]);
  const pendingZoomScrollRef = useRef<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (pendingZoomScrollRef.current && containerRef.current) {
      containerRef.current.scrollTo(pendingZoomScrollRef.current);
      pendingZoomScrollRef.current = null;
    }
  }, [zoom]);
  const [showLayersPanel, setShowLayersPanel] = useState(false);
  const [respectLayerVisibility, setRespectLayerVisibility] = useState(true);
  const [mainBoardHidden] = useState(false);
  const [currentLayerView, setCurrentLayerView] = useState<string | null>(null);

  const [dragOverLayerId, setDragOverLayerId] = useState<string | null>(null);
  const [draggingLayerId, setDraggingLayerId] = useState<string | null>(null);
  const [, setLayerDropTarget] = useState<string | null>(null);
  const [layerPreviewOrder, setLayerPreviewOrder] = useState<string[] | null>(
    null,
  );
  // New content belongs to the layer currently opened in the Layers panel.
  // At the root this remains null, preserving main-board placement.
  const targetLayerId = currentLayerView;
  const draggedLayerIdRef = useRef<string | null>(null);
  const layerPreviewOrderRef = useRef<string[] | null>(null);
  const layerReorderPendingRef = useRef<{
    key: string;
    since: number;
  } | null>(null);
  const layerReorderTimerRef = useRef<ReturnType<typeof window.setTimeout> | null>(
    null,
  );
  const [isMainBoardSelected, setIsMainBoardSelected] = useState(false);
  const [boardResizeEnabled, setIsBoardResizeEnabled] = useState(false);
  const [boardMoveEnabled, setIsBoardMoveEnabled] = useState(false);
  const isBoardResizeEnabled = boardResizeEnabled || (activeTool === 'board' && toolSettingsOverrides.grid?.allowEditing === true);
  const isBoardMoveEnabled = boardMoveEnabled || (activeTool === 'board' && toolSettingsOverrides.grid?.allowMoving === true);
  const [highlightAll, setHighlightAll] = useState(false);
  const [, setContextMenuPos] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [savedRange, setSavedRange] = useState<Range | null>(null);
  const pressedKeysRef = useRef<Set<string>>(new Set());
  const [linkSystemMode, setLinkSystemMode] = useState<
    "start" | "whole" | "fragmenting" | "choosing_link_type"
  >("start");
  const [textLinkTarget, setTextLinkTarget] = useState<string | null>(null);
  const [manualLinkSourceId, setManualLinkSourceId] = useState<string | null>(
    null,
  );
  const [localTargetName, setLocalTargetName] = useState<string>("");
  const [, setShowTargetInput] = useState<boolean>(false);
  const [, setShowLinkInput] = useState<boolean>(false);
  const [showTargetDropdown, setShowTargetDropdown] = useState<boolean>(false);

  useEffect(() => {
    const el = elements.find((e) => e.id === selectedId);
    if (el) {
      setLocalTargetName(el.linkTargetName || "");
    }
  }, [selectedId]);

  useEffect(() => {
    if (activeTool === "link") {
      setLinkSystemMode("start");
      setTextLinkTarget(null);
    }
  }, [activeTool, selectedId]);

  useEffect(() => {
    const handleSelChange = () => {
      const sel = window.getSelection();
      if (sel && sel.rangeCount > 0) {
        const node = sel.anchorNode;
        if (node) {
          const el =
            node.nodeType === 3 ? node.parentElement : (node as HTMLElement);
          if (el && el.closest(".content-editable-text")) {
            setSavedRange(sel.getRangeAt(0).cloneRange());
          } else if (!(document.activeElement instanceof HTMLInputElement && document.activeElement.type === "color")) { setSavedRange(null); }
        }
      } else if (!(document.activeElement instanceof HTMLInputElement && document.activeElement.type === "color")) {
        setSavedRange(null);
      }
    };
    document.addEventListener("selectionchange", handleSelChange);
    return () =>
      document.removeEventListener("selectionchange", handleSelChange);
  }, []);

  useEffect(() => {
    if (!TEXT_TYPES.includes(activeTool) && activeTool !== "sticky" && activeTool !== "link") {
      setSavedRange(null); window.getSelection()?.removeAllRanges();
    }
  }, [activeTool, selectedId]);

  useEffect(() => {
    try {
      const styleId = "noteboard-css-highlight-style";
      if (!document.getElementById(styleId)) {
        const style = document.createElement("style");
        style.id = styleId;
        style.textContent =
          "::highlight(text-selection){background-color:rgba(59,130,246,.45);color:#000}";
        document.head.appendChild(style);
      }
      if (
        typeof window !== "undefined" &&
        typeof CSS !== "undefined" &&
        "highlights" in CSS
      ) {
        if (savedRange && !savedRange.collapsed) {
          const HighlightConstructor = (window as any).Highlight;
          if (HighlightConstructor) {
            const highlight = new HighlightConstructor(savedRange);
            (CSS as any).highlights.set("text-selection", highlight);
          }
        } else {
          (CSS as any).highlights.delete("text-selection");
        }
      }
    } catch (e) {
      console.error("Highlight API failed:", e);
    }
  }, [savedRange]);

  const isTextTool = TEXT_TYPES.includes(activeTool) || activeTool === "sticky";
  const [showWorkspaceGrid, setShowWorkspaceGrid] = useState(
    page.showWorkspaceGrid ?? false,
  );
  const [showZoomSettingsDropdown, setShowZoomSettingsDropdown] = useState(false);
  const [scrollZoomSensitivity, setScrollZoomSensitivity] = useState(
    initialEditorSettings.scrollZoomSensitivity ?? 1,
  );
  const [clickZoomSensitivity, setClickZoomSensitivity] = useState(
    initialEditorSettings.clickZoomSensitivity ?? 1,
  );
  const [overlapMode, setOverlapMode] = useState<"none" | "partial" | "full">(
    initialEditorSettings.overlapMode ?? "none",
  );
  const [gridColor, setGridColor] = useState(page.gridColor ?? "#e2e8f0");
  const [boardColor, setBoardColor] = useState(page.boardColor ?? "#ffffff");
  const [gridThickness, setGridThickness] = useState(page.gridThickness ?? 1);
  const [gridSize, setGridSize] = useState(page.gridSize ?? 24);
  const [workspaceGridColor, setWorkspaceGridColor] = useState(page.workspaceGridColor ?? "#333333");
  const [workspaceGridThickness, setWorkspaceGridThickness] = useState(page.workspaceGridThickness ?? 1);
  const [workspaceGridSize, setWorkspaceGridSize] = useState(page.workspaceGridSize ?? 50);
  presentationRef.current={title,boardColor,gridColor,gridSize,gridThickness,showGrid,snapToGrid};
  const applyPresentation=(value:BoardDocumentPresentation)=>{
    presentationRef.current=value;
    setTitle(value.title);setBoardColor(value.boardColor);setGridColor(value.gridColor);
    setGridSize(value.gridSize);setGridThickness(value.gridThickness);setShowGrid(value.showGrid);setSnapToGrid(value.snapToGrid);
  };
  useEffect(()=>{
    if(equalDocumentValue(documentHistoryRef.current.entries[documentHistoryRef.current.index].presentation,presentationRef.current))return;
    const timer=setTimeout(()=>pushDocument(elementsRef.current),250);
    return()=>clearTimeout(timer);
  },[title,boardColor,gridColor,gridSize,gridThickness,showGrid,snapToGrid]);
  const [showBoardSaveModal, setShowBoardSaveModal] = useState(false);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [presetName, setPresetName] = useState(
    `${page.title || "Custom"} Preset`,
  );
  const [presetSettingsChecked, setPresetSettingsChecked] = useState(true);
  const [presetContentChecked, setPresetContentChecked] = useState(true);



  useEffect(() => {
    // Dropdown auto-show removed as per user request
  }, [selectedId, elements]);

  const snap = (v: number) =>
    snapToGrid ? Math.round(v / gridSize) * gridSize : v;

  const elementContainsPoint = (
    element: BoardElement,
    point: { x: number; y: number },
  ) => {
    const width = element.size?.width || 100;
    const height = element.size?.height || 40;
    const rotation = element.rotation || 0;
    const centerX = element.position.x + width / 2;
    const centerY = element.position.y + height / 2;
    const rad = (-rotation * Math.PI) / 180;
    const dx = point.x - centerX;
    const dy = point.y - centerY;
    const localX = width / 2 + dx * Math.cos(rad) - dy * Math.sin(rad);
    const localY = height / 2 + dx * Math.sin(rad) + dy * Math.cos(rad);

    if (element.type === "line" || element.type === "arrow") {
      const stroke = Math.max(8, element.borderWidth || 4);
      return localX >= 0 && localX <= width && Math.abs(localY - height / 2) <= stroke;
    }

    if (element.type === "draw" && element.points && element.points.length > 2) {
      let inside = false;
      for (let i = 0, j = element.points.length - 1; i < element.points.length; j = i++) {
        const xi = element.points[i].x;
        const yi = element.points[i].y;
        const xj = element.points[j].x;
        const yj = element.points[j].y;
        const intersects =
          yi > localY !== yj > localY &&
          localX < ((xj - xi) * (localY - yi)) / (yj - yi) + xi;
        if (intersects) inside = !inside;
      }
      return inside;
    }

    return localX >= 0 && localX <= width && localY >= 0 && localY <= height;
  };

  const mainSurface = createBoardSurface('main-board', { x: 0, y: 0 }, pageDimensions, boardColor, -9999);

  const isPointInsideBounds = (
    point: { x: number; y: number },
    bounds: { minX: number; minY: number; maxX: number; maxY: number },
  ) =>
    point.x >= bounds.minX &&
    point.x <= bounds.maxX &&
    point.y >= bounds.minY &&
    point.y <= bounds.maxY;

  const getBoardElementAtPoint = (point: { x: number; y: number }) => findBoardSurface(point, elementsRef.current.filter(element => elementHierarchy.isVisible(element.id, respectLayerVisibility)));

  const getInteractionBoundsAtPoint = (point: { x: number; y: number }) => {
    const board = getBoardElementAtPoint(point) ?? findBoardSurface(point, [mainSurface]);
    if (!board || (board.id !== 'main-board' && elementHierarchy.isLocked(board.id))) return null;
    return boardSurfaceBounds(board);
  };

  const clampPointToBounds = (
    point: { x: number; y: number },
    bounds: { minX: number; minY: number; maxX: number; maxY: number },
  ) => ({
    x: Math.min(Math.max(point.x, bounds.minX), bounds.maxX),
    y: Math.min(Math.max(point.y, bounds.minY), bounds.maxY),
  });

  const applyFillAtPoint = (point: { x: number; y: number }) => {
    const target = elementsRef.current
      .filter(
        (el) =>
          el.type !== "layer" &&
          el.type !== "board" &&
          !el.isEraser &&
          !isMergedGroupMember(el,elementHierarchy) &&
          elementHierarchy.isVisible(el.id, respectLayerVisibility) &&
          !elementHierarchy.isLocked(el.id) &&
          (!currentLayerView ||
            el.parentId === currentLayerView ||
            elementHierarchy.isDescendantOf(el.id, currentLayerView)),
      )
      .sort((a, b) => compareElementStack(b, a, elementsRef.current))
      .find((el) => elementContainsPoint(el, point));

    if (!target) {
      const boardTarget = getBoardElementAtPoint(point);
      if (boardTarget) {
        updateElement(boardTarget.id, { color: fillToolColor });
      } else {
        setBoardColor(fillToolColor);
      }
      return;
    }

    if(target.type==='group')return;
    if (target.type === "line" || target.type === "arrow" || target.type === "draw") {
      updateElement(target.id, { borderColor: fillToolColor });
    } else {
      updateElement(target.id, { color: fillToolColor });
    }
  };

  const syncLiveWebviewState = (sourceElements = elementsRef.current) => {
    if (typeof document === "undefined") return sourceElements;
    const liveWebUrls = new Map<string, string>();

    document
      .querySelectorAll("webview[data-web-element-id]")
      .forEach((node) => {
        const webview = node as HTMLElement & {
          getURL?: () => string;
          src?: string;
        };
        const elementId = webview.dataset.webElementId;
        const currentUrl = readLiveWebviewUrl(webview);
        const normalizedUrl = normalizeWebUrl(currentUrl);

        if (
          elementId &&
          normalizedUrl &&
          normalizedUrl !== "about:blank" &&
          !normalizedUrl.startsWith("chrome-error://")
        ) {
          liveWebUrls.set(elementId, normalizedUrl);
        }
      });

    return mergeLiveWebviewUrls(sourceElements, liveWebUrls);
  };

  const syncLiveEditableState = (sourceElements = elementsRef.current) => {
    if (typeof document === "undefined") return sourceElements;
    const liveContent = new Map<string, string>();
    document
      .querySelectorAll<HTMLElement>("[data-board-element-editor-id]")
      .forEach((editor) => {
        const elementId = editor.dataset.boardElementEditorId;
        if (elementId) liveContent.set(elementId, sanitizeRichText(editor.innerHTML));
      });
    if (!liveContent.size) return sourceElements;
    let changed = false;
    const merged = sourceElements.map((element) => {
      const content = liveContent.get(element.id);
      if (content === undefined || content === element.content) return element;
      changed = true;
      return { ...element, content };
    });
    return changed ? merged : sourceElements;
  };

  // Auto-save to ensure real-time persistence
  useEffect(() => {
    const timer = setTimeout(() => {
      doSave();
    }, 1000);
    return () => clearTimeout(timer);
  }, [
    elements,
    sectionSheets,
    title,
    pageDimensions,
    workspaceDimensions,
    boardPosition,
    showGrid,
    snapToGrid,
    showWorkspaceGrid,
    gridColor,
    boardColor,
    gridThickness,
    gridSize,
    workspaceGridColor,
    workspaceGridThickness,
    workspaceGridSize,
    activeTool,
    customColors,
    pendingProps,
    keepToolActive,
    alwaysOnTop,
    keepToolActiveFallback,
    toolModeShortcut,
    gridToggleShortcut,
    overlapShortcut,
    cropShortcut,
    scrollZoomShortcut,
    zoomToCursor,
    keepBoardContentPosition,
    cutShortcut,
    proportionalScale,
    altResizeCrops,
    previewMode,
    toolSettingsOverrides,
    isSelectionLockEnabled,
    selectionLockTime,
    enableObjectSnapping,
    smartGuidesEnabled,
    autoSelectOnPlace,
    autoToolOnSelect,
    spinSnapEnabled,
    spinSnapDegrees,
    allowEditing,
    allowMovingElementsInPan,
    fillToolColor,
    eraserMode,
    eraserSize,
    eraserShape,
    scrollZoomSensitivity,
    clickZoomSensitivity,
    overlapMode,
    objectPresets,
    objectDefaults,
    // Toolbar arrangement is intentionally excluded: only explicit Save commits it.
  ]);

  useEffect(() => {
    if (holdingTimerRef.current) {
      clearTimeout(holdingTimerRef.current);
      holdingTimerRef.current = null;
    }
    const capturedPointerId = activePointerIdRef.current;
    const captureTarget = pointerCaptureTargetRef.current;
    try {
      if (
        capturedPointerId !== null &&
        captureTarget?.hasPointerCapture?.(capturedPointerId)
      ) {
        captureTarget.releasePointerCapture(capturedPointerId);
      }
    } catch {
      // A tool switch can race with native pointer cancellation.
    }
    areaGestureRef.current = null;
    activePointerIdRef.current = null;
    pointerCaptureTargetRef.current = null;
    setDragStart(null);
    setDragCurrent(null);
    setQuickAddRegion(null);
    setCurrentDrawPoints(null);
    setIsHoldingToCreate(false);
    setIsInteracting(false);
    if (!["select","crop","eyedropper","polygon-select","lasso"].includes(activeTool)) {
      setSelectedId(null);
    }
  }, [activeTool]);

  const getShortcutFromEvent = (e: KeyboardEvent | React.KeyboardEvent) => {
    const key = e.key === " " ? "Space" : e.key;
    const parts: string[] = [];
    if (e.ctrlKey) parts.push("Ctrl");
    if (e.altKey) parts.push("Alt");
    if (e.shiftKey) parts.push("Shift");
    if (e.metaKey) parts.push("Meta");
    if (["Control", "Shift", "Alt", "Meta"].includes(key)) {
      return parts.join("+");
    }
    parts.push(key.length === 1 ? key.toUpperCase() : toTitleCase(key));
    return parts.join("+");
  };

  const normalizeShortcutKey = (key: string) =>
    key === " " ? "Space" : key.length === 1 ? key.toUpperCase() : toTitleCase(key);

  const isShortcutPressed = (
    shortcut: string,
    e?: { ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; metaKey?: boolean },
  ) => {
    const parts = shortcut
      .split("+")
      .map((part) => part.trim())
      .filter(Boolean);
    if (!parts.length) return false;
    const pressedKeys = pressedKeysRef.current;
    return parts.every((part) => {
      const normalized = normalizeShortcutKey(part);
      if (normalized === "Ctrl") return e?.ctrlKey ?? pressedKeys.has("Ctrl");
      if (normalized === "Alt") return e?.altKey ?? pressedKeys.has("Alt");
      if (normalized === "Shift") return e?.shiftKey ?? pressedKeys.has("Shift");
      if (normalized === "Meta") return e?.metaKey ?? pressedKeys.has("Meta");
      return pressedKeys.has(normalized);
    });
  };

  const shortcutMatches = (
    shortcut: string,
    e: KeyboardEvent | React.KeyboardEvent,
  ) => shortcut.trim() !== "" && getShortcutFromEvent(e) === shortcut;

  const zoomAtPoint = (delta: number, clientX: number, clientY: number) => {
    const container = containerRef.current;
    if (!container) return;
    const previousZoom = zoomRef.current;
    const nextZoom = clampZoom(previousZoom + delta);
    if (nextZoom === previousZoom) return;
    const bounds = container.getBoundingClientRect();
    const anchorX = zoomToCursor ? clientX - bounds.left - container.clientLeft : container.clientWidth / 2;
    const anchorY = zoomToCursor ? clientY - bounds.top - container.clientTop : container.clientHeight / 2;
    const scroll = pendingZoomScrollRef.current ?? { left: container.scrollLeft, top: container.scrollTop };
    pendingZoomScrollRef.current = {
      left: anchoredZoomScroll({ scroll: scroll.left, anchor: anchorX, boardOrigin: boardPosition.x, previousZoom, nextZoom }),
      top: anchoredZoomScroll({ scroll: scroll.top, anchor: anchorY, boardOrigin: boardPosition.y, previousZoom, nextZoom }),
    };
    zoomRef.current = nextZoom;
    setZoom(nextZoom);
  };

  const syncWebZoomState=(active:boolean)=>{void window.noteboardAPI?.setBoardZoomState({shortcut:scrollZoomShortcut,active}).catch(()=>undefined);};
  useEffect(()=>{syncWebZoomState(false);},[scrollZoomShortcut]);

  // Wheel gestures and the Zoom tool share the same anchor calculation.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      const shouldZoom =
        scrollZoomShortcut.trim() === "" ||
        isShortcutPressed(scrollZoomShortcut, e);

      if (shouldZoom) {
        e.preventDefault();
        const pixels = e.deltaY * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? container.clientHeight : 1);
        zoomAtPoint(-pixels * 0.0015 * scrollZoomSensitivity, e.clientX, e.clientY);
      }
    };

    container.addEventListener("wheel", handleWheel, { passive: false });
    const unsubscribe=window.noteboardAPI?.onWebWheel(event=>{const point=webWheelClientPoint(event);if(point)zoomAtPoint(-event.deltaY*0.0015*scrollZoomSensitivity,point.clientX,point.clientY);});
    return () => {container.removeEventListener("wheel", handleWheel);unsubscribe?.();};
  }, [scrollZoomSensitivity, scrollZoomShortcut, zoomToCursor, boardPosition]);

  const cycleOverlapMode = () => {
    setOverlapMode((current) =>
      current === "none" ? "partial" : current === "partial" ? "full" : "none",
    );
  };

  useEffect(() => {
    if (!recordingShortcut) return;
    const cancelRecording = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".shortcut-recorder")) {
        setRecordingShortcut(null);
      }
    };
    document.addEventListener("mousedown", cancelRecording);
    document.addEventListener("touchstart", cancelRecording);
    return () => {
      document.removeEventListener("mousedown", cancelRecording);
      document.removeEventListener("touchstart", cancelRecording);
    };
  }, [recordingShortcut]);

  useEffect(() => {
    if (!recordingPresetShortcutId) return;
    const cancelRecording = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest(".shortcut-recorder")) {
        setRecordingPresetShortcutId(null);
      }
    };
    document.addEventListener("mousedown", cancelRecording);
    document.addEventListener("touchstart", cancelRecording);
    return () => {
      document.removeEventListener("mousedown", cancelRecording);
      document.removeEventListener("touchstart", cancelRecording);
    };
  }, [recordingPresetShortcutId]);

  useEffect(() => {
    if (!toolbarDragId) return;

    const updateDragStatus = (event: DragEvent) => {
      const target = event.target as HTMLElement | null;
      const insideToolbar = Boolean(
        target?.closest("[data-toolbar-drop-zone='true']"),
      );
      setToolbarDragStatus({
        x: event.clientX,
        y: event.clientY,
        inside: insideToolbar,
      });
    };

    const clearDragStatus = () => setToolbarDragStatus(null);

    document.addEventListener("dragover", updateDragStatus);
    document.addEventListener("drop", clearDragStatus);
    document.addEventListener("dragend", clearDragStatus);
    return () => {
      document.removeEventListener("dragover", updateDragStatus);
      document.removeEventListener("drop", clearDragStatus);
      document.removeEventListener("dragend", clearDragStatus);
    };
  }, [toolbarDragId]);

  const renderShortcutRecorder = (
    target:
      | "toolMode"
      | "gridToggle"
      | "overlap"
      | "crop"
      | "scrollZoom"
      | "cut",
    value: string,
    onChange: (value: string) => void,
  ) => (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        e.currentTarget.focus();
        setRecordingShortcut(target);
      }}
      onKeyDown={(e) => {
        if (recordingShortcut !== target) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "Escape") {
          setRecordingShortcut(null);
          return;
        }
        if (e.key === "Backspace" || e.key === "Delete") {
          onChange("");
          setRecordingShortcut(null);
          return;
        }
        const shortcut = getShortcutFromEvent(e);
        if (!shortcut) return;
        onChange(shortcut);
        setRecordingShortcut(null);
      }}
      className={cn(
        "shortcut-recorder min-w-[5.5rem] rounded-md border-2 px-2 py-1 text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1 transition-colors",
        recordingShortcut === target
          ? "border-blue-500 bg-blue-50 text-blue-700"
          : "border-gray-300 bg-gray-50 text-gray-600 hover:bg-gray-100",
      )}
      title="Click and press a shortcut"
    >
      <Keyboard className="w-3.5 h-3.5" />
      <span>{recordingShortcut === target ? "Press..." : value || "None"}</span>
    </button>
  );

  const renderPresetShortcutRecorder = (preset: ObjectPreset) => (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        e.currentTarget.focus();
        setRecordingPresetShortcutId(preset.id);
      }}
      onKeyDown={(e) => {
        if (recordingPresetShortcutId !== preset.id) return;
        e.preventDefault();
        e.stopPropagation();
        if (e.key === "Escape") {
          setRecordingPresetShortcutId(null);
          return;
        }
        if (e.key === "Backspace" || e.key === "Delete") {
          setObjectPresets((prev) =>
            prev.map((item) =>
              item.id === preset.id ? { ...item, shortcut: "" } : item,
            ),
          );
          setRecordingPresetShortcutId(null);
          return;
        }
        const shortcut = getShortcutFromEvent(e);
        if (!shortcut) return;
        setObjectPresets((prev) =>
          prev.map((item) =>
            item.id === preset.id ? { ...item, shortcut } : item,
          ),
        );
        setRecordingPresetShortcutId(null);
      }}
      className={cn(
        "shortcut-recorder min-w-[5.5rem] rounded-md border-2 px-2 py-1 text-[10px] font-bold uppercase tracking-wider flex items-center justify-center gap-1 transition-colors",
        recordingPresetShortcutId === preset.id
          ? "border-blue-500 bg-blue-50 text-blue-700"
          : "border-gray-300 bg-gray-50 text-gray-600 hover:bg-gray-100",
      )}
      title="Click and press a shortcut"
    >
      <Keyboard className="w-3.5 h-3.5" />
      <span>
        {recordingPresetShortcutId === preset.id
          ? "Press..."
          : preset.shortcut || "None"}
      </span>
    </button>
  );

  // Keyboard Shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      pressedKeysRef.current.add(normalizeShortcutKey(e.key));
      setIsAltKeyDown(isShortcutPressed(cropShortcut, e));

      const activeElement = document.activeElement;
      const isTypingTarget =
        activeElement?.tagName === "INPUT" ||
        activeElement?.tagName === "TEXTAREA" ||
        (activeElement instanceof HTMLElement && activeElement.isContentEditable);
      // Other editor shortcuts must not intercept ordinary text entry.
      if (isTypingTarget || document.querySelector("dialog[data-spreadsheet-editor][open]")) return;
      if(e.key==='Escape'&&activePointerIdRef.current!==null){e.preventDefault();handlePointerCancel({pointerId:activePointerIdRef.current} as PointerEvent);return;}
      if(outlineSelection.key(e))return;
      if(e.key==='Escape'&&selectedIds.length){e.preventDefault();setSelectedIds([]);return;}
      syncWebZoomState(isShortcutPressed(scrollZoomShortcut,e));

      if (!e.repeat && shortcutMatches(toolModeShortcut, e)) {
        e.preventDefault();
        setKeepToolActive((value) => !value);
        return;
      }
      if (!e.repeat && shortcutMatches(gridToggleShortcut, e)) {
        e.preventDefault();
        setShowGrid((value) => !value);
        return;
      }
      if (!e.repeat && shortcutMatches(overlapShortcut, e)) {
        e.preventDefault();
        cycleOverlapMode();
        return;
      }
      if (!e.repeat && shortcutMatches(cutShortcut, e) && selectedIds.length) {
        if (getShortcutFromEvent(e) !== "Ctrl+X" && getShortcutFromEvent(e) !== "Meta+X") {
          e.preventDefault(); document.execCommand('cut');
        }
        return;
      }
      const matchedPreset = objectPresets.find(
        (preset) =>
          preset.element &&
          preset.shortcut &&
          shortcutMatches(preset.shortcut, e),
      );
      if (!e.repeat && matchedPreset) {
        e.preventDefault();
        placeObjectPreset(matchedPreset);
        return;
      }

      if (e.ctrlKey || e.metaKey) {
        if (e.key.toLowerCase() === "v" && window.noteboardAPI?.readClipboard) {
          e.preventDefault();
          void pasteSystemClipboard(quickAddRegion ?? undefined);
        } else if (e.key.toLowerCase() === "z") {
          e.preventDefault();
          if (e.shiftKey) {
            handleRedo();
          } else {
            handleUndo();
          }
        } else if (e.key.toLowerCase() === "y") {
          e.preventDefault();
          handleRedo();
        }
      } else {
        if (e.key === "Delete" || e.key === "Backspace") {
          if (selectedIds.length) {
            e.preventDefault();
            removeSelection();
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    const handleKeyUp = (e: KeyboardEvent) => {
      pressedKeysRef.current.delete(normalizeShortcutKey(e.key));
      setIsAltKeyDown(isShortcutPressed(cropShortcut));
      syncWebZoomState(isShortcutPressed(scrollZoomShortcut,e));
    };
    const handleBlur = () => {
      pressedKeysRef.current.clear();
      setIsAltKeyDown(false);
      syncWebZoomState(false);
    };
    window.addEventListener("keyup", handleKeyUp);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
      window.removeEventListener("blur", handleBlur);
    };
  }, [
    elements,
    selectedId,
    selectedIds,
    activeTool,
    history,
    historyIndex,
    quickAddRegion,
    toolModeShortcut,
    gridToggleShortcut,
    overlapShortcut,
    cropShortcut,
    scrollZoomShortcut,
    cutShortcut,
    objectPresets,
  ]);

  const globalToolMenuSettings: ToolMenuSettings = {
    alwaysOnTop,
    keepToolActive,
    previewMode,
  };

  const getEffectiveToolMenuSettings = (menuId: string) =>
    resolveToolMenuSettingsForId(
      globalToolMenuSettings,
      toolSettingsOverrides,
      menuId,
    );

  const getToolMenuId = (tool: string) => {
    if (
      isTextToolActive(tool) ||
      ["quote", "code", "checklist"].includes(tool)
    ) {
      return "text";
    }
    if (SHAPE_TYPES.includes(tool) || tool === "section") return "shapes";
    if (tool === "image" || tool === "media") return "media";
    if (tool === "board") return "grid";
    if (["embed", "link", "object-presets"].includes(tool)) return tool;
    return tool;
  };

  const finishToolUse = (toolId: string) => {
    if (!getEffectiveToolMenuSettings(getToolMenuId(toolId)).keepToolActive) {
      setActiveTool(autoSelectOnPlace ? "select" : keepToolActiveFallback);
    }
  };

  const getActiveToolMenuSettings = () =>
    getEffectiveToolMenuSettings(getToolMenuId(activeTool));

  const updateToolMenuSetting = <K extends ToolMenuSettingKey>(
    menuId: string,
    key: K,
    value: ToolMenuSettings[K],
  ) => {
    setToolSettingsOverrides((current) =>
      updateToolMenuSettingOverride(current, menuId, key, value),
    );
  };

  const closeAllDropdowns = (
    options: { preservePresetPicking?: boolean; force?: boolean } = {},
  ) => {
    const moreChildMenuIds = [
      "embed",
      "link",
      "object-presets",
      "grid",
      ...toolbarLayout.more,
    ];
    const moreIsPinned =
      !options.force &&
      (getEffectiveToolMenuSettings("more").alwaysOnTop ||
        moreChildMenuIds
          .filter(
            (menuId) =>
              !["link", "object-presets"].includes(menuId) ||
              expandedMoreToolsRef.current.has(menuId),
          )
          .some((menuId) => getEffectiveToolMenuSettings(menuId).alwaysOnTop));
    const pinnedMenus = options.force
      ? new Set<string>()
      : new Set(
          [
            "select",
            "pan",
            "text",
            "shapes",
            "media",
            "draw",
            "fill",
            "eraser",
            "generalSettings",
            "toolDefaults",
            "presetSettings",
            "behaviorSettings",
            "shortcutSettings",
            "layers",
            "link",
            "object-presets",
          ].filter((menuId) => getEffectiveToolMenuSettings(menuId).alwaysOnTop),
        );
    if (!pinnedMenus.has("pan")) setShowPanDropdown(false);
    if (!pinnedMenus.has("shapes")) setShowShapeDropdown(false);
    if (!pinnedMenus.has("text")) setShowTextDropdown(false);
    if (!moreIsPinned) setShowMoreToolsDropdown(false);
    if (!pinnedMenus.has("draw")) setShowDrawDropdown(false);
    if (!pinnedMenus.has("fill")) setShowFillDropdown(false);
    if (!pinnedMenus.has("media")) setShowMediaSettingsDropdown(false);
    if (!pinnedMenus.has("eraser")) setShowEraserSettingsDropdown(false);
    if (!pinnedMenus.has("text")) setShowTextSettingsDropdown(false);
    if (!pinnedMenus.has("select")) setShowSelectDropdown(false);
    if (!pinnedMenus.has("generalSettings")) setShowZoomSettingsDropdown(false);
    if (!pinnedMenus.has("layers")) setShowLayersPanel(false);
    if (
      detachedMoreMenuId &&
      (options.force ||
        !getEffectiveToolMenuSettings(getToolMenuId(detachedMoreMenuId))
          .alwaysOnTop)
    ) {
      setDetachedMoreMenuId(null);
    }
    if (!pinnedMenus.has("object-presets")) {
      setShowObjectPresetsPanel(false);
      if (!options.preservePresetPicking) setPickingObjectPresetId(null);
    }
    setShowTargetDropdown(false);
    setShowToolFallbackDropdown(false);
  };

  useEffect(() => {
    if (!toolbarEditingMode) return;
    closeAllDropdowns({ force: true });
    const collapsed = new Set<string>();
    expandedMoreToolsRef.current = collapsed;
    setExpandedMoreTools(collapsed);
  }, [toolbarEditingMode]);

  const renderMenuSettingsBlock = (
    menuId: string,
    compact = false,
    narrow = false,
  ) => (
    (() => {
      const settings = getEffectiveToolMenuSettings(menuId);
      return (
        <MenuSettingsBlock
          compact={compact}
          narrow={narrow}
          alwaysOnTop={settings.alwaysOnTop}
          onAlwaysOnTopChange={(value) =>
            updateToolMenuSetting(menuId, "alwaysOnTop", value)
          }
          keepToolActive={settings.keepToolActive}
          onKeepToolActiveChange={(value) =>
            updateToolMenuSetting(menuId, "keepToolActive", value)
          }
          allowEditing={settings.allowEditing ?? false}
          onAllowEditingChange={["text", "shapes", "media", "embed", "draw", "grid", "section", "fill"].includes(menuId) ? value => updateToolMenuSetting(menuId, "allowEditing", value) : undefined}
          allowMoving={settings.allowMoving ?? false}
          onAllowMovingChange={["text", "shapes", "media", "embed", "draw", "grid", "section", "fill"].includes(menuId) ? value => updateToolMenuSetting(menuId, "allowMoving", value) : undefined}
          previewMode={settings.previewMode}
          onPreviewModeChange={(mode: PreviewMode) =>
            updateToolMenuSetting(menuId, "previewMode", mode)
          }
        />
      );
    })()
  );

  const renderToolMenuTitle = (
    label: string,
    inset = "-mx-3 -mt-3 mb-3",
    compact = false,
  ) => (
    <div
      className={cn(
        "tool-menu-title flex shrink-0 items-center border-b-[3px] border-gray-400 bg-gray-100 px-3",
        compact ? "py-1" : "py-2",
        inset,
      )}
    >
      <span className="text-[10px] font-bold uppercase tracking-wider text-gray-700">
        {label}
      </span>
    </div>
  );

  const renderSwitch = (checked: boolean) => (
    <span
      aria-hidden="true"
      data-menu-toggle="true"
      data-state={checked ? "on" : "off"}
      className={cn(
        "noteboard-toggle flex h-4 w-7 shrink-0 items-center rounded-full border border-black/10 p-0.5 transition-colors duration-200",
        checked ? "bg-blue-500" : "bg-gray-200",
      )}
    >
      <span
        className={cn(
          "h-3 w-3 rounded-full bg-white shadow-sm transition-transform duration-200",
          checked ? "translate-x-3" : "translate-x-0",
        )}
      />
    </span>
  );

  const renderAlwaysOnTopControl = (menuId: string) => {
    const pinned = getEffectiveToolMenuSettings(menuId).alwaysOnTop;
    return (
      <button
        type="button"
        data-menu-always-on-top={menuId}
        aria-pressed={pinned}
        onClick={(event) => {
          event.stopPropagation();
          updateToolMenuSetting(menuId, "alwaysOnTop", !pinned);
        }}
        className="flex w-full items-center justify-between rounded-lg px-1.5 py-1.5 text-left text-xs font-bold text-gray-700 transition-colors hover:bg-white"
      >
        <span>Always on top</span>
        {renderSwitch(pinned)}
      </button>
    );
  };

  type BoardSettingsRenderOptions = {
    showToolbarHint?: boolean;
    includeToolSettings?: boolean;
    showHeading?: boolean;
  };

  const renderBoardSettingsControls = ({
    showToolbarHint = false,
    includeToolSettings = true,
    showHeading = true,
  }: BoardSettingsRenderOptions = {}) => (
    <section className="flex flex-col gap-3 border-b-2 border-gray-200 pb-3 last:border-b-0 last:pb-0">
      {showHeading && (
        <div className="flex items-center gap-2 text-xs font-bold text-gray-700">
          <BoardSettingsIcon className="h-4 w-4" />
          <span>Board Settings</span>
        </div>
      )}
      <div className="flex flex-col gap-2">
        {[
          {
            label: "Resize",
            active: isBoardResizeEnabled,
            toggle: () => setIsBoardResizeEnabled((value) => !value),
          },
          {
            label: "Move",
            active: isBoardMoveEnabled,
            toggle: () => setIsBoardMoveEnabled((value) => !value),
          },
        ].map((option) => (
          <button
            key={option.label}
            type="button"
            aria-pressed={option.active}
            onClick={option.toggle}
            className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-left text-xs font-bold text-gray-700 transition-colors hover:bg-white"
          >
            <span>{option.label}</span>
            {renderSwitch(option.active)}
          </button>
        ))}
      </div>
      <button type="button" aria-pressed={keepBoardContentPosition} onClick={()=>setKeepBoardContentPosition(value=>!value)}
        title="Keep element positions fixed while adding or removing board space"
        className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-left text-xs font-bold text-gray-700 transition-colors hover:bg-white">
        <span>Keep content in place</span>{renderSwitch(keepBoardContentPosition)}
      </button>
      <div className="h-px w-full bg-gray-200" />

      <div className="flex flex-col gap-3">
        <button
          type="button"
          aria-pressed={showGrid}
          onClick={() => setShowGrid((value) => !value)}
          className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-left text-xs font-bold text-gray-700 transition-colors hover:bg-white"
        >
          <span>Board Grid</span>
          {renderSwitch(showGrid)}
        </button>
        <div
          className={cn(
            "flex flex-col gap-3 transition-opacity",
            !showGrid && "pointer-events-none opacity-50",
          )}
        >
          <div className="flex items-center justify-between gap-2 text-xs font-semibold text-gray-500">
            <span>Color</span>
            <ColorPicker
              value={gridColor}
              onChange={(color) => setGridColor(color)}
              customColors={customColors.grid}
              baseColors={GRID_BASE_COLORS}
              onAddCustomColor={(color, index) =>
                handleAddCustomColor(color, index, "grid")
              }
            />
          </div>
          <label className="flex flex-col gap-1 text-xs font-semibold text-gray-500">
            <span className="flex items-center justify-between">
              <span>Thickness</span>
              <span className="rounded bg-white px-1 text-black">
                {gridThickness}px
              </span>
            </span>
            <input
              type="range"
              min="1"
              max="10"
              value={gridThickness}
              onChange={(event) =>
                setGridThickness(parseInt(event.target.value, 10))
              }
              className="w-full accent-blue-500"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-gray-500">
            <span className="flex items-center justify-between">
              <span>Size</span>
              <span className="rounded bg-white px-1 text-black">
                {gridSize}px
              </span>
            </span>
            <input
              type="range"
              min="10"
              max="200"
              step="2"
              value={gridSize}
              onChange={(event) =>
                setGridSize(parseInt(event.target.value, 10))
              }
              className="w-full accent-blue-500"
            />
          </label>
        </div>
      </div>

      <div className="h-px w-full bg-gray-200" />
      <div className="flex flex-col gap-3">
        <button
          type="button"
          aria-pressed={showWorkspaceGrid}
          onClick={() => setShowWorkspaceGrid((value) => !value)}
          className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-left text-xs font-bold text-gray-700 transition-colors hover:bg-white"
        >
          <span>Background Grid</span>
          {renderSwitch(showWorkspaceGrid)}
        </button>
        <div
          className={cn(
            "flex flex-col gap-3 transition-opacity",
            !showWorkspaceGrid && "pointer-events-none opacity-50",
          )}
        >
          <div className="flex items-center justify-between gap-2 text-xs font-semibold text-gray-500">
            <span>Color</span>
            <ColorPicker
              value={workspaceGridColor}
              onChange={(color) => setWorkspaceGridColor(color)}
              customColors={customColors.grid}
              baseColors={GRID_BASE_COLORS}
              onAddCustomColor={(color, index) =>
                handleAddCustomColor(color, index, "grid")
              }
            />
          </div>
          <label className="flex flex-col gap-1 text-xs font-semibold text-gray-500">
            <span className="flex items-center justify-between">
              <span>Thickness</span>
              <span className="rounded bg-white px-1 text-black">
                {workspaceGridThickness}px
              </span>
            </span>
            <input
              type="range"
              min="1"
              max="10"
              value={workspaceGridThickness}
              onChange={(event) =>
                setWorkspaceGridThickness(parseInt(event.target.value, 10))
              }
              className="w-full accent-blue-500"
            />
          </label>
          <label className="flex flex-col gap-1 text-xs font-semibold text-gray-500">
            <span className="flex items-center justify-between">
              <span>Size</span>
              <span className="rounded bg-white px-1 text-black">
                {workspaceGridSize}px
              </span>
            </span>
            <input
              type="range"
              min="10"
              max="200"
              step="2"
              value={workspaceGridSize}
              onChange={(event) =>
                setWorkspaceGridSize(parseInt(event.target.value, 10))
              }
              className="w-full accent-blue-500"
            />
          </label>
        </div>
      </div>

      <div className="h-px w-full bg-gray-200" />
      <div className="flex flex-col gap-2">
        {[
          {
            label: "Snap to Grid",
            active: snapToGrid,
            toggle: () => setSnapToGrid((value) => !value),
          },
          {
            label: "Object Snapping",
            active: enableObjectSnapping,
            toggle: () => setEnableObjectSnapping((value) => !value),
          },
        ].map((option) => (
          <button
            key={option.label}
            type="button"
            aria-pressed={option.active}
            onClick={option.toggle}
            className="flex w-full items-center justify-between rounded-lg px-1 py-1 text-left text-xs font-bold text-gray-700 transition-colors hover:bg-white"
          >
            <span>{option.label}</span>
            {renderSwitch(option.active)}
          </button>
        ))}
      </div>
      {showToolbarHint && (
        <span className="text-[10px] font-semibold leading-snug text-gray-400">
          The Board section can also be positioned on the toolbar or moved into
          More while customizing.
        </span>
      )}
      {includeToolSettings && renderMenuSettingsBlock("grid")}
    </section>
  );

  const renderSettingsSectionHeading = (
    Icon: React.ElementType,
    label: string,
  ) => (
    <div className="flex items-center gap-2 text-[10px] font-extrabold uppercase tracking-wider text-gray-500">
      <Icon className="h-4 w-4 text-gray-600" />
      <span>{label}</span>
    </div>
  );

  const renderToolDefaultsSettings = (showHeading = true) => (
    <section className="flex flex-col gap-3 border-b-2 border-gray-200 pb-3 last:border-b-0 last:pb-0">
      {showHeading && renderSettingsSectionHeading(Wrench, "Global Tool Settings")}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          aria-pressed={alwaysOnTop}
          onClick={() => setAlwaysOnTop((value) => !value)}
          className="flex w-full items-center justify-between gap-3 rounded-lg px-1 py-1 text-left text-xs font-bold text-gray-700 transition-colors hover:bg-white"
        >
          <span>Always on top</span>
          {renderSwitch(alwaysOnTop)}
        </button>
        <div className="flex items-center justify-between gap-3 text-xs font-bold text-gray-700">
          <span>Tool mode</span>
          <SegmentedControl label="Tool mode" value={keepToolActive ? 'fixed' : 'unfixed'} onChange={value => setKeepToolActive(value === 'fixed')} options={[{ value: 'unfixed', label: 'Unfixed' }, { value: 'fixed', label: 'Fixed' }]} />
        </div>
        <div className="flex items-center justify-between gap-3 text-xs font-bold text-gray-700">
          <span>Preview</span>
          <SegmentedControl label="Preview" value={previewMode} onChange={setPreviewMode} options={[{ value: 'box', label: 'Translucent' }, { value: 'realistic', label: 'True' }]} />
        </div>
        <div className="flex flex-col gap-1">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">
            Fallback tool
          </span>
          <div className="flex rounded-lg border border-gray-200 bg-gray-100 p-1 shadow-inner">
            <button
              type="button"
              onClick={() => setKeepToolActiveFallback("pan")}
              className={cn(
                "flex-1 rounded-md px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors",
                keepToolActiveFallback === "pan"
                  ? "bg-white text-blue-600 shadow-sm ring-1 ring-black/5"
                  : "text-gray-500 hover:bg-gray-200/50 hover:text-black",
              )}
            >
              Hand
            </button>
            <button
              type="button"
              onClick={() => setKeepToolActiveFallback("select")}
              className={cn(
                "flex-1 rounded-md px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors",
                keepToolActiveFallback === "select"
                  ? "bg-white text-blue-600 shadow-sm ring-1 ring-black/5"
                  : "text-gray-500 hover:bg-gray-200/50 hover:text-black",
              )}
            >
              Pointer
            </button>
          </div>
        </div>
        <div className="flex items-center justify-between gap-3 text-xs font-bold text-gray-700">
          <span>Tool mode shortcut</span>
          {renderShortcutRecorder("toolMode", toolModeShortcut, setToolModeShortcut)}
        </div>
      </div>
    </section>
  );

  const renderToolbarCustomizationSettings = (showHeading = true) => (
    <section className="flex flex-col gap-2 border-b-2 border-gray-200 pb-3 last:border-b-0 last:pb-0">
      {showHeading && renderSettingsSectionHeading(Settings2, "Edit Toolbar")}
      {toolbarCustomizeMode && (
        <span className="text-[10px] font-semibold leading-snug text-gray-400">
          Drag toolbar items onto the highlighted slots, then use the finish
          control in the workspace to confirm.
        </span>
      )}
    </section>
  );

  const renderPresetSettings = (showHeading = true) => (
    <section className="flex flex-col gap-2 border-b-2 border-gray-200 pb-3 last:border-b-0 last:pb-0">
      {showHeading && renderSettingsSectionHeading(ClipboardPaste, "Presets")}
      <button
        type="button"
        onClick={() =>
          setObjectPresets((prev) => [
            ...prev,
            { id: generateId(), name: `Preset ${prev.length + 1}` },
          ])
        }
        className="flex w-full items-center justify-center gap-1 rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-[11px] font-bold text-gray-600 transition-colors hover:border-blue-300 hover:text-blue-700"
      >
        <Plus className="h-3.5 w-3.5" />
        Add preset
      </button>
      {objectPresets.length === 0 ? (
        <span className="rounded-lg border border-gray-200 bg-white px-2 py-2 text-[10px] font-semibold text-gray-400">
          Create a preset in More &gt; Object Presets.
        </span>
      ) : (
        <div className="flex flex-col gap-1">
          {objectPresets.map((preset) => (
            <div
              key={`general-preset-${preset.id}`}
              className="flex items-center gap-1 rounded-lg border border-gray-200 bg-white px-1.5 py-1"
            >
              <input
                value={preset.name}
                onChange={(event) =>
                  setObjectPresets((current) =>
                    current.map((item) =>
                      item.id === preset.id
                        ? { ...item, name: event.target.value }
                        : item,
                    ),
                  )
                }
                className="min-w-0 flex-1 bg-transparent text-[11px] font-bold text-gray-600 outline-none"
                aria-label={`Rename ${preset.name}`}
              />
              {renderPresetShortcutRecorder(preset)}
              <button
                type="button"
                onClick={() => {
                  setPickingObjectPresetId(preset.id);
                  setActiveTool("select");
                }}
                className={cn(
                  "rounded p-1 hover:bg-blue-50 hover:text-blue-700",
                  pickingObjectPresetId === preset.id
                    ? "bg-blue-50 text-blue-700"
                    : "text-gray-400",
                )}
                title={preset.element ? "Pick another object" : "Pick an object"}
                aria-label={preset.element ? "Pick another object" : "Pick an object"}
              >
                {pickingObjectPresetId === preset.id ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
              </button>
              <button
                type="button"
                onClick={() =>
                  setObjectPresets((current) =>
                    current.filter((item) => item.id !== preset.id),
                  )
                }
                className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                title="Delete preset"
                aria-label="Delete preset"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </section>
  );

  const renderBehaviorSettings = (showHeading = true) => (
    <section className="flex flex-col gap-2 border-b-2 border-gray-200 pb-3 last:border-b-0 last:pb-0">
      {showHeading && renderSettingsSectionHeading(Shield, "Physics & Behavior")}
      <button
        type="button"
        aria-pressed={highlightAll}
        onClick={() => setHighlightAll((value) => !value)}
        className="flex items-center justify-between rounded-lg px-1 py-1 text-left text-xs font-bold text-gray-700 transition-colors hover:bg-white"
      >
        <span>Highlight all</span>
        {renderSwitch(highlightAll)}
      </button>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-bold text-gray-700">Prevent overlap</span>
        <div className="flex rounded-lg border border-gray-200 bg-gray-100 p-1 shadow-inner">
          {[
            { mode: "none", label: "Off" },
            { mode: "partial", label: "Partial" },
            { mode: "full", label: "Full" },
          ].map((option) => (
            <button
              key={option.mode}
              type="button"
              onClick={() =>
                setOverlapMode(option.mode as "none" | "partial" | "full")
              }
              className={cn(
                "flex-1 rounded-md px-2 py-1.5 text-[10px] font-bold uppercase tracking-wider transition-colors",
                overlapMode === option.mode
                  ? "bg-white text-blue-600 shadow-sm ring-1 ring-black/5"
                  : "text-gray-500 hover:bg-gray-200/50 hover:text-black",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="flex items-center justify-between gap-3 text-xs font-bold text-gray-700">
          <span>Overlap shortcut</span>
          {renderShortcutRecorder("overlap", overlapShortcut, setOverlapShortcut)}
        </div>
      </div>
    </section>
  );

  const renderShortcutSettings = (showHeading = true) => (
    <section className="flex flex-col gap-2 border-b-2 border-gray-200 pb-3 last:border-b-0 last:pb-0">
      {showHeading && renderSettingsSectionHeading(Keyboard, "Shortcuts & Zoom")}
      <div className="flex items-center justify-between gap-3 text-xs font-bold text-gray-700">
        <span>Grid on/off</span>
        {renderShortcutRecorder("gridToggle", gridToggleShortcut, setGridToggleShortcut)}
      </div>
      <div className="flex items-center justify-between gap-3 text-xs font-bold text-gray-700">
        <span>Crop</span>
        {renderShortcutRecorder("crop", cropShortcut, setCropShortcut)}
      </div>
      <button
        type="button"
        aria-pressed={altResizeCrops}
        onClick={() => setAltResizeCrops((value) => !value)}
        className="flex items-center justify-between rounded-lg px-1 py-1 text-left text-xs font-bold text-gray-700 transition-colors hover:bg-white"
      >
        <span>Crop while resizing</span>
        {renderSwitch(altResizeCrops)}
      </button>
      <div className="flex items-center justify-between gap-3 text-xs font-bold text-gray-700">
        <span>Cut</span>
        {renderShortcutRecorder("cut", cutShortcut, setCutShortcut)}
      </div>
      <div className="flex items-center justify-between gap-3 text-xs font-bold text-gray-700">
        <span>Scroll zoom</span>
        <div className="flex items-center gap-1">
          {renderShortcutRecorder("scrollZoom", scrollZoomShortcut, setScrollZoomShortcut)}
          <span className="text-[10px] font-bold uppercase text-gray-500">+ Scroll</span>
        </div>
      </div>
      <label className="flex flex-col gap-1 text-xs font-bold text-gray-700">
        <span>Scroll zoom strength</span>
        <input
          type="range"
          min="0.1"
          max="5"
          step="0.1"
          value={scrollZoomSensitivity}
          onChange={(event) => setScrollZoomSensitivity(parseFloat(event.target.value))}
          className="w-full accent-blue-500"
        />
      </label>
      <div className="flex items-center justify-between gap-3 text-xs font-bold text-gray-700">
        <span>Zoom towards</span>
        <SegmentedControl label="Zoom towards" value={zoomToCursor ? 'cursor' : 'center'}
          onChange={value => setZoomToCursor(value === 'cursor')}
          options={[{ value: 'cursor', label: 'Cursor' }, { value: 'center', label: 'Center' }]} />
      </div>
      <label className="flex flex-col gap-1 text-xs font-bold text-gray-700">
        <span>Click zoom strength</span>
        <input
          type="range"
          min="0.1"
          max="5"
          step="0.1"
          value={clickZoomSensitivity}
          onChange={(event) => setClickZoomSensitivity(parseFloat(event.target.value))}
          className="w-full accent-blue-500"
        />
      </label>
    </section>
  );

  const renderSettingsSectionContent = (
    id: ToolbarItemId,
    showHeading = true,
  ) => {
    switch (id) {
      case "grid":
        return renderBoardSettingsControls({
          includeToolSettings: false,
          showHeading,
        });
      case "toolDefaults":
        return renderToolDefaultsSettings(showHeading);
      case "presetSettings":
        return renderPresetSettings(showHeading);
      case "behaviorSettings":
        return renderBehaviorSettings(showHeading);
      case "shortcutSettings":
        return renderShortcutSettings(showHeading);
      default:
        return null;
    }
  };

  const toggleGeneralSettingsAccordion = (id: GeneralSettingsAccordionId) => {
    setExpandedGeneralSettingsSections((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const renderGeneralSettingsAccordion = (
    id: GeneralSettingsAccordionId,
    label: string,
    Icon: React.ElementType,
    content: React.ReactNode,
  ) => {
    const isToolbarEditor = id === "toolbarCustomization";
    const expanded = isToolbarEditor
      ? toolbarCustomizeMode
      : expandedGeneralSettingsSections.has(id);
    const contentId = `general-settings-${id}`;
    const toggleSection = () => {
      if (isToolbarEditor) {
        setToolbarCustomizeMode((value) => !value);
        return;
      }
      toggleGeneralSettingsAccordion(id);
    };
    return (
      <section
        key={id}
        data-general-settings-section={id}
        className="overflow-hidden rounded-lg border-2 border-gray-200 bg-gray-50 transition-colors"
      >
        <div className="flex w-full items-center gap-2 bg-white px-2 py-2 text-left text-xs font-bold text-gray-700">
          <button
            type="button"
            aria-expanded={expanded}
            aria-controls={contentId}
            onClick={toggleSection}
            className="flex min-w-0 flex-1 items-center gap-2 text-left transition-colors hover:text-gray-900"
          >
            <Icon className="h-4 w-4 shrink-0 text-gray-600" />
            <span className="min-w-0 flex-1 truncate">{label}</span>
          </button>
          {isToolbarEditor ? (
            <button
              type="button"
              aria-expanded={expanded}
              aria-pressed={expanded}
              aria-controls={contentId}
              data-toolbar-editor-toggle="true"
              onClick={(event) => {
                event.stopPropagation();
                toggleSection();
              }}
              className={cn(
                "shrink-0 rounded-md px-2 py-1 text-[10px] font-extrabold uppercase tracking-wider transition-colors",
                expanded
                  ? "bg-blue-100 text-blue-700"
                  : "bg-gray-100 text-gray-500 hover:bg-gray-200 hover:text-gray-800",
              )}
            >
              {expanded ? "Done" : "Edit"}
            </button>
          ) : (
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={contentId}
              aria-label={`${label} settings`}
              onClick={toggleSection}
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
            >
              <ChevronDown
                className={cn(
                  "h-3.5 w-3.5 transition-transform",
                  expanded && "rotate-180",
                )}
              />
            </button>
          )}
        </div>
        {expanded && (
          <div id={contentId} className="border-t-2 border-gray-200 p-2">
            {content}
          </div>
        )}
      </section>
    );
  };

  const renderGeneralSettingsContent = () => (
    <div className="flex flex-col gap-1.5">
      {renderGeneralSettingsAccordion(
        "toolbarCustomization",
        "Edit Toolbar",
        Settings2,
        renderToolbarCustomizationSettings(false),
      )}
      {getGeneralSettingsSections(toolbarLayout)
        // Presets are managed by the Object Presets workflow in More; keep
        // legacy placement data readable without rendering a duplicate card.
        .filter((sectionId) => sectionId !== "presetSettings")
        .map((sectionId) => {
        const section = SETTINGS_SECTION_BY_ID.get(sectionId);
        if (!section) return null;
        return renderGeneralSettingsAccordion(
          section.id,
          section.label,
          section.icon,
          renderSettingsSectionContent(section.id, false),
        );
      })}
    </div>
  );

  const renderTextToolSettings = () => {
    const selectedText = elements.find(element => element.id === selectedId && isScalableText(element.type));
    const target = selectedText ?? pendingProps;
    const update = (changes: Partial<BoardElement>) => selectedText
      ? updateElement(selectedText.id, changes)
      : setPendingProps(current => ({ ...current, ...changes }));
    return (
    <div className="mt-0 pt-0">
      <div className="flex items-center justify-between text-xs font-semibold text-gray-500">
        <span>Text Color</span>
        <ColorPicker
          value={elements.find(element => element.id === selectedId)?.textColor || pendingProps.textColor || "#000000"}
          onChange={changeTextColor}
          customColors={customColors.text}
          onAddCustomColor={(color, index) =>
            handleAddCustomColor(color, index, "text")
          }
        />
      </div>
      <div className="mt-3">
        <span className="text-xs font-semibold text-gray-500">Font Size</span>
        <input
          type="number"
          value={displayedTextFontSize(target, selectedText?.type ?? (isScalableText(activeTool) ? activeTool as ElementType : "text"))}
          min={6}
          max={200}
          onChange={event => update({ fontSize: Math.max(6, Math.min(200, Number(event.target.value) || 16)) / getTextScale(target) })}
          className="mt-1 w-full bg-gray-50 border-[2px] border-gray-300 rounded-md px-2 py-1 text-xs font-semibold text-gray-800 outline-none focus:border-blue-500 transition-colors"
        />
      </div>
      <button type="button" aria-pressed={target.textScaling === true}
        onPointerDown={event => event.preventDefault()}
        onClick={() => update({ textScaling: target.textScaling !== true })}
        className="mt-2 flex w-full items-center justify-between text-xs font-semibold text-gray-500">
        <span>Text scaling</span>{renderSwitch(target.textScaling === true)}
      </button>
    </div>
  );
  };

  const renderSelectToolSettings = () => (
    <>
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          data-select-setting-toggle="lock-time"
          className="flex w-full items-center justify-between cursor-pointer group text-left"
          onClick={() => setIsSelectionLockEnabled(!isSelectionLockEnabled)}
        >
          <span className="text-xs font-bold text-gray-800 select-none group-hover:text-black">
            Lock Time (ms)
          </span>
          {renderSwitch(isSelectionLockEnabled)}
        </button>
        <input
          type="number"
          value={isSelectionLockEnabled ? selectionLockTimeInput : ""}
          onChange={(event) => {
            const rawValue = event.target.value;
            setSelectionLockTimeInput(rawValue);
            setSelectionLockTime(
              rawValue.trim() === "" ? 0 : parseInt(rawValue, 10) || 0,
            );
          }}
          disabled={!isSelectionLockEnabled}
          placeholder={isSelectionLockEnabled ? "250" : "Off"}
          min="0"
          step="100"
          className="w-full bg-gray-50 border-[2px] border-gray-300 rounded-md px-2 py-1 text-xs font-semibold text-gray-800 outline-none focus:border-blue-500 disabled:opacity-50 transition-colors"
        />
      </div>
      <div className="w-full h-[2px] bg-gray-300 my-1" />
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          data-select-setting-toggle="spin-snap"
          className="flex w-full items-center justify-between cursor-pointer group text-left"
          onClick={() => setSpinSnapEnabled(!spinSnapEnabled)}
        >
          <span className="text-xs font-bold text-gray-800 select-none group-hover:text-black">
            Spin Snap
          </span>
          {renderSwitch(spinSnapEnabled)}
        </button>
        <div className="flex items-center gap-2">
          <input
            type="number"
            value={spinSnapDegrees}
            onChange={(event) =>
              setSpinSnapDegrees(
                Math.max(
                  1,
                  Math.min(180, parseInt(event.target.value, 10) || 1),
                ),
              )
            }
            disabled={!spinSnapEnabled}
            min="1"
            max="180"
            step="1"
            className="w-full bg-gray-50 border-[2px] border-gray-300 rounded-md px-2 py-1 text-xs font-semibold text-gray-800 outline-none focus:border-blue-500 disabled:opacity-50 transition-colors"
          />
          <span className="text-[10px] font-bold text-gray-500 uppercase">
            deg
          </span>
        </div>
      </div>
      <button
        type="button"
        className="flex w-full items-center justify-between cursor-pointer group mt-1 text-left"
        onClick={() => setProportionalScale(!proportionalScale)}
      >
        <span className="text-xs font-bold text-gray-800 select-none group-hover:text-black">
          Ratio Scaling
        </span>
        {renderSwitch(proportionalScale)}
      </button>
      <button
        type="button"
        className="flex w-full items-center justify-between cursor-pointer group mb-1 text-left"
        onClick={() => setAutoSelectOnPlace(!autoSelectOnPlace)}
      >
        <span className="text-xs font-bold text-gray-800 select-none group-hover:text-black">
          Auto-select After Draw
        </span>
        {renderSwitch(autoSelectOnPlace)}
      </button>
      <button
        type="button"
        className="flex w-full items-center justify-between cursor-pointer group mb-1 text-left"
        onClick={() => setAutoToolOnSelect(!autoToolOnSelect)}
      >
        <span className="text-xs font-bold text-gray-800 select-none group-hover:text-black">
          Select switches to object tool
        </span>
        {renderSwitch(autoToolOnSelect)}
      </button>
    </>
  );

  const setPanEditingEnabled = (value: boolean) => {
    setAllowEditing(value);
    if (value) return;
    setSelectedId(null);
    if (["select", "text", "link"].includes(activeTool)) {
      setActiveTool(autoSelectOnPlace ? "select" : "pan");
    }
  };

  const renderPanToolSettings = () => (
    <>
      <button
        type="button"
        className="flex w-full items-center justify-between cursor-pointer group text-left"
        onClick={() => setPanEditingEnabled(!allowEditing)}
      >
        <span className="text-xs font-bold text-gray-700 select-none">
          Allow Editing Elements
        </span>
        {renderSwitch(allowEditing)}
      </button>
      <button
        type="button"
        className="flex w-full items-center justify-between cursor-pointer group text-left"
        onClick={() =>
          setAllowMovingElementsInPan(!allowMovingElementsInPan)
        }
      >
        <span className="text-xs font-bold text-gray-700 select-none">
          Allow Moving Elements
        </span>
        {renderSwitch(allowMovingElementsInPan)}
      </button>
    </>
  );

  const shapeToolOptions = [
    { type: "rectangle", icon: Square, label: "Rectangle" },
    { type: "section", icon: LayoutTemplate, label: "Section" },
    { type: "ellipse", icon: Circle, label: "Ellipse" },
    { type: "triangle", icon: Triangle, label: "Triangle" },
    { type: "line", icon: Minus, label: "Line" },
    { type: "arrow", icon: ArrowUpRight, label: "Arrow" },
  ] as const;

  const renderShapeToolSettings = (inMore = false) => (
    <div className="flex flex-col gap-1">
      {shapeToolOptions.map((shape) => (
        <button
          key={shape.type}
          type="button"
          onClick={() => {
            setActiveTool(shape.type);
            if (inMore) {
              if (
                !getEffectiveToolMenuSettings("more").alwaysOnTop &&
                !getEffectiveToolMenuSettings("shapes").alwaysOnTop
              ) {
                setShowMoreToolsDropdown(false);
              }
            } else if (
              !getEffectiveToolMenuSettings("shapes").alwaysOnTop
            ) {
              setShowShapeDropdown(false);
            }
          }}
          className="p-2 text-xs font-bold text-gray-600 hover:text-[#1A1A1A] hover:bg-gray-100 rounded-lg transition-all flex items-center gap-2 text-left"
        >
          <shape.icon className="w-4 h-4" />
          <span>{shape.label}</span>
        </button>
      ))}
    </div>
  );

  const updatePendingToolProps = (updates: Partial<BoardElement>) => {
    setPendingProps((current) => ({ ...current, ...updates }));
  };

  const renderDrawToolSettings = () => {
    const selectedDraw = elementsRef.current.find(element => element.id === selectedId && element.type === 'draw');
    const drawingAssistance = pendingProps.isSmooth === true;
    const lineSmoothing = pendingProps.drawingAssistSmooth !== false;
    const shapeGuesser = pendingProps.drawingAssistGuess === true;
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between text-xs font-semibold text-gray-500 mb-1">
          <span>Color</span>
          <ColorPicker
            value={selectedDraw?.borderColor || pendingProps.borderColor || "#000000"}
            onChange={(color) =>
              selectedDraw ? updateElement(selectedDraw.id, { borderColor: color }) : updatePendingToolProps({ borderColor: color })
            }
            customColors={customColors.border}
            onAddCustomColor={(color, index) =>
              handleAddCustomColor(color, index, "border")
            }
            customSlots={2}
          />
        </div>
        <label className="flex flex-col gap-1">
          <span className="flex items-center justify-between text-xs font-semibold text-gray-500">
            <span>Stroke Width</span>
            <span className="text-black bg-gray-100 rounded px-1">
              {pendingProps.borderWidth || 4}px
            </span>
          </span>
          <input
            type="range"
            min="1"
            max="30"
            value={pendingProps.borderWidth || 4}
            onChange={(event) =>
              updatePendingToolProps({
                borderWidth: parseInt(event.target.value, 10),
              })
            }
            className="w-full accent-blue-500"
          />
        </label>
        <div className="border-t border-gray-200 pt-2 mt-1">
          <button
            type="button"
            className="flex w-full items-center justify-between cursor-pointer group mb-2 text-left"
            onClick={() =>
              updatePendingToolProps({ isSmooth: !drawingAssistance })
            }
          >
            <span className="text-xs font-bold text-gray-800 select-none">
              Drawing Assistance
            </span>
            {renderSwitch(drawingAssistance)}
          </button>
          {drawingAssistance && (
            <div className="pl-2 flex flex-col gap-2">
              <button
                type="button"
                className="flex w-full items-center justify-between cursor-pointer group text-left"
                onClick={() =>
                  updatePendingToolProps({
                    drawingAssistSmooth: !lineSmoothing,
                  })
                }
              >
                <span className="text-xs font-medium text-gray-600 select-none">
                  Line Smoothing
                </span>
                {renderSwitch(lineSmoothing)}
              </button>
              {lineSmoothing && (
                <label className="flex flex-col gap-2 my-2">
                  <span className="flex items-center justify-between text-xs font-semibold text-gray-500">
                    <span>Strength</span>
                    <span className="text-gray-500">
                      {pendingProps.drawingAssistSmoothStrength ?? 5}/10
                    </span>
                  </span>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    step="1"
                    value={pendingProps.drawingAssistSmoothStrength ?? 5}
                    onChange={(event) =>
                      updatePendingToolProps({
                        drawingAssistSmoothStrength: parseInt(
                          event.target.value,
                          10,
                        ),
                      })
                    }
                    className="w-full accent-blue-400 h-1"
                  />
                </label>
              )}
              <button
                type="button"
                className="flex w-full items-center justify-between cursor-pointer group text-left"
                onClick={() =>
                  updatePendingToolProps({
                    drawingAssistGuess: !shapeGuesser,
                  })
                }
              >
                <span className="text-xs font-medium text-gray-600 select-none">
                  Shape Guessing
                </span>
                {renderSwitch(shapeGuesser)}
              </button>
              {shapeGuesser && (
                <label className="flex flex-col gap-1 pl-2 border-l-2 border-gray-100 ml-1 mt-1">
                  <span className="flex items-center justify-between text-xs font-semibold text-gray-500">
                    <span>Strength</span>
                    <span className="text-gray-500">
                      {pendingProps.drawingAssistStrength ?? 5}/10
                    </span>
                  </span>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    step="1"
                    value={pendingProps.drawingAssistStrength ?? 5}
                    onChange={(event) =>
                      updatePendingToolProps({
                        drawingAssistStrength: parseInt(
                          event.target.value,
                          10,
                        ),
                      })
                    }
                    className="w-full accent-blue-400 h-1"
                  />
                </label>
              )}
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderFillToolSettings = () => (
    <div className="flex items-center justify-between gap-4 text-xs font-semibold text-gray-500 mb-1">
      <span className="whitespace-nowrap">Color</span>
      <div className="flex items-center gap-2">
        <Palette className="w-4 h-4 text-gray-400" />
        <ColorPicker
          value={fillToolColor}
          onChange={setFillToolColor}
          customColors={customColors.fill}
          onAddCustomColor={(color, index) =>
            handleAddCustomColor(color, index, "fill")
          }
        />
      </div>
    </div>
  );

  const renderObjectPresetsInlineSettings = () => (
    <>
      <button
        type="button"
        onClick={() =>
          setObjectPresets((current) => [
            ...current,
            {
              id: generateId(),
              name: `Preset ${current.length + 1}`,
            },
          ])
        }
        className="flex w-full items-center justify-center gap-1 rounded-md border border-gray-300 bg-white px-2 py-1.5 text-[11px] font-bold text-gray-600 hover:border-blue-300 hover:text-blue-700"
      >
        <Plus className="h-3.5 w-3.5" /> Add preset
      </button>
      {objectPresets.length > 0 && <div className="flex flex-col gap-1">
        {objectPresets.map((preset) => (
            <div
              key={`inline-preset-${preset.id}`}
              className="flex items-center gap-1 rounded-md bg-white px-1.5 py-1"
            >
              <input
                value={preset.name}
                onChange={(event) =>
                  setObjectPresets((current) =>
                    current.map((item) =>
                      item.id === preset.id
                        ? { ...item, name: event.target.value }
                        : item,
                    ),
                  )
                }
                className="min-w-0 flex-1 bg-transparent text-[11px] font-bold text-gray-600 outline-none"
                aria-label={`Rename ${preset.name}`}
              />
              <button
                type="button"
                onClick={() => {
                  setPickingObjectPresetId(preset.id);
                  setActiveTool("select");
                }}
                aria-pressed={pickingObjectPresetId === preset.id}
                className={cn(
                  "rounded p-1 hover:bg-blue-50 hover:text-blue-700",
                  pickingObjectPresetId === preset.id
                    ? "bg-blue-50 text-blue-700"
                    : "text-gray-400",
                )}
                title={preset.element ? "Pick another object" : "Pick an object"}
                aria-label={preset.element ? "Pick another object" : "Pick an object"}
              >
                {pickingObjectPresetId === preset.id ? (
                  <Check className="h-3 w-3" />
                ) : (
                  <ChevronRight className="h-3 w-3" />
                )}
              </button>
              <button
                type="button"
                onClick={() =>
                  setObjectPresets((current) =>
                    current.filter((item) => item.id !== preset.id),
                  )
                }
                className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-600"
                title="Delete preset"
                aria-label="Delete preset"
              >
                <Trash2 className="h-3 w-3" />
              </button>
            </div>
          ))}
      </div>}
      {renderAlwaysOnTopControl("object-presets")}
    </>
  );

  const renderOverflowToolSettings = (id: ToolbarItemId, inMore = false) => {
    const footer = (menuId: string) => renderMenuSettingsBlock(menuId, inMore);
    switch (id) {
      case "select":
        return (
          <div className="flex flex-col gap-3">
            {renderSelectToolSettings()}
            {footer("select")}
          </div>
        );
      case "pan":
        return (
          <div className="flex flex-col gap-3">
            {renderPanToolSettings()}
            {footer("pan")}
          </div>
        );
      case "text":
        return (
          <div className="flex flex-col gap-3">
            {renderTextToolSettings()}
            {footer("text")}
          </div>
        );
      case "shapes":
        return (
          <div className="flex flex-col gap-1">
            {renderShapeToolSettings(true)}
            {footer("shapes")}
          </div>
        );
      case "media":
        return renderMenuSettingsBlock("media", true);
      case "table":
        return renderMenuSettingsBlock("table", true);
      case "polygon-select":
      case "lasso":
      case "crop":
        return renderMenuSettingsBlock(id,true);
      case "eyedropper":
        return <div className="flex flex-col gap-2"><div className="flex items-center justify-between gap-2 text-xs font-semibold text-gray-600"><span>Apply to</span><SegmentedControl label="Apply sampled color to" value={eyedropperTarget} onChange={setEyedropperTarget} options={[{value:'fill',label:'Fill'},{value:'stroke',label:'Stroke'},{value:'text',label:'Text'}]}/></div><div className="flex items-center gap-2 text-xs text-gray-600"><span className="h-5 w-5 rounded border border-gray-300" style={{backgroundColor:sampledColor}}/>{sampledColor.toUpperCase()}</div>{renderMenuSettingsBlock(id,true)}</div>;
      case "draw":
        return (
          <div className="flex flex-col gap-3">
            {renderDrawToolSettings()}
            {footer("draw")}
          </div>
        );
      case "fill":
        return (
          <div className="flex flex-col gap-3">
            {renderFillToolSettings()}
            {footer("fill")}
          </div>
        );
      case "eraser":
        return (
          <div className="flex flex-col gap-3">
            {renderEraserToolSettings()}
            {footer("eraser")}
          </div>
        );
      case "embed":
        return (
          <div className="flex flex-col gap-3">
            {renderWebToolSettings()}
            {footer("embed")}
          </div>
        );
      case "board":
        return renderMenuSettingsBlock("grid", true);
      case "link":
        return (
          <div className="flex flex-col gap-3">
            {renderAlwaysOnTopControl("link")}
          </div>
        );
      case "object-presets":
        return (
          <div className="flex flex-col gap-3">
            {renderObjectPresetsInlineSettings()}
          </div>
        );
      default:
        return null;
    }
  };

  const renderEraserToolSettings = () => (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-3 text-xs font-semibold text-gray-500">
        <span>Mode</span>
        <SegmentedControl label="Eraser mode" value={eraserMode} onChange={setEraserMode} options={[{ value: 'element', label: 'Whole' }, { value: 'partial', label: 'Partial' }]} />
      </div>
      <div className="flex items-center justify-between text-xs font-semibold text-gray-500"><span>Size</span><span className="text-black bg-gray-100 rounded px-1">{eraserSize}px</span></div>
      <input type="range" min={1} max={80} value={eraserSize} onChange={event => setEraserSize(parseInt(event.target.value, 10) || 20)} className="w-full accent-blue-500" />
      <div className="flex items-center justify-between gap-3 text-xs font-semibold text-gray-500">
        <span>Shape</span>
        <SegmentedControl label="Eraser shape" value={eraserShape} onChange={setEraserShape} options={[{ value: 'round', label: 'Round' }, { value: 'square', label: 'Square' }]} />
      </div>
    </div>
  );

  const updatePendingWebSettings = (updates: Partial<BoardElement>) => {
    const selectedWeb = elementsRef.current.find(element => element.id === selectedId && element.type === 'embed');
    if (selectedWeb) { updateElement(selectedWeb.id, updates); return; }
    setPendingProps((current) => ({
      ...current,
      webSessionId: current.webSessionId || generateId(),
      ...updates,
    }));
  };

  const renderWebToolSettings = () => {
    const selectedWeb = elementsRef.current.find(element => element.id === selectedId && element.type === 'embed');
    const settings = getWebSettings(selectedWeb ?? pendingProps);
    return (
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between gap-2 text-[10px] font-bold uppercase tracking-wider text-gray-500">
          <span>Device mode</span>
          <div className="flex gap-1">
            {(Object.keys(WEB_DEVICE_PROFILES) as WebDeviceMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                aria-pressed={settings.deviceMode === mode}
                onClick={() => updatePendingWebSettings({ webDeviceMode: mode, size: { ...WEB_DEVICE_PROFILES[mode].defaultSize } })}
                className={cn(
                  "rounded-md border px-1.5 py-1 text-[9px] font-bold transition-colors",
                  settings.deviceMode === mode
                    ? "border-blue-300 bg-blue-50 text-blue-700"
                    : "border-gray-200 bg-white text-gray-500 hover:bg-gray-100",
                )}
              >
                {WEB_DEVICE_PROFILES[mode].label}
              </button>
            ))}
          </div>
        </div>
        <button type="button" aria-pressed={settings.popupBlocker} onClick={() => updatePendingWebSettings({ webPopupBlocker: !settings.popupBlocker })}
          className="flex items-center justify-between rounded-md px-1 py-1 text-left text-xs font-bold text-gray-600 hover:bg-white">
          <span>Block popups</span>{renderSwitch(settings.popupBlocker)}
        </button>
        <>
        {desktopWebRuntime && (
          <>
            <button
              type="button"
              aria-pressed={settings.rememberSession}
              onClick={() =>
                updatePendingWebSettings({
                  webRememberSession: !settings.rememberSession,
                })
              }
              className="flex items-center justify-between rounded-md px-1 py-1 text-left text-[11px] font-bold text-gray-600 hover:bg-white"
            >
              <span>Remember session</span>
              <span
                className={cn(
                  "rounded-md px-1.5 py-0.5 text-[9px] uppercase tracking-wider",
                  settings.rememberSession
                    ? "bg-blue-50 text-blue-700"
                    : "bg-gray-100 text-gray-500",
                )}
              >
                {settings.rememberSession ? "On" : "Off"}
              </span>
            </button>
            </>
        )}
            <button
              type="button"
              aria-pressed={settings.adBlock}
              disabled={!desktopWebRuntime}
              title={!desktopWebRuntime ? 'Available in the desktop app' : 'Block known ad and tracking requests'}
              onClick={() =>
                updatePendingWebSettings({ webAdBlock: !settings.adBlock })
              }
              className="flex items-center justify-between rounded-md px-1 py-1 text-left text-[11px] font-bold text-gray-600 hover:bg-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <span>Ad blocker</span>
              <span
                className={cn(
                  "rounded-md px-1.5 py-0.5 text-[9px] uppercase tracking-wider",
                  settings.adBlock
                    ? "bg-blue-50 text-blue-700"
                    : "bg-gray-100 text-gray-500",
                )}
              >
                {settings.adBlock && desktopWebRuntime && selectedWeb ? <WebBlockingBadge partition={getWebPartition(selectedWeb)} /> : settings.adBlock ? "On" : "Off"}
              </span>
            </button>
            <div role="group" aria-label="Cookie blocker" title={!desktopWebRuntime ? 'Available in the desktop app' : 'Block cookie transmission and storage'} className="flex items-center justify-between gap-2 text-[11px] font-bold text-gray-600">
              <span>Cookie blocker</span>
              <div className="flex gap-1">
                {(["off", "third-party", "all"] as WebCookieBlockerMode[]).map(
                  (mode) => (
                    <button
                      key={mode}
                      type="button"
                      disabled={!desktopWebRuntime}
                      aria-pressed={settings.cookieBlocker === mode}
                      onClick={() =>
                        updatePendingWebSettings({ webCookieBlocker: mode })
                      }
                      className={cn(
                        "rounded-md border px-1.5 py-1 text-[9px] font-bold transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
                        settings.cookieBlocker === mode
                          ? "border-blue-300 bg-blue-50 text-blue-700"
                          : "border-gray-200 bg-white text-gray-500 hover:bg-gray-100",
                      )}
                    >
                      {WEB_COOKIE_BLOCKER_LABELS[mode]}
                    </button>
                  ),
                )}
              </div>
            </div>
        </>
      </div>
    );
  };

  const activateToolbarTool = (tool: string) => {
    closeAllDropdowns();
    setActiveTool(tool);
  };

  useEffect(() => {
    return () => {
      if (objectDefaultsSavedTimerRef.current) {
        clearTimeout(objectDefaultsSavedTimerRef.current);
      }
      if (objectDuplicatedTimerRef.current) clearTimeout(objectDuplicatedTimerRef.current);
    };
  }, []);

  useEffect(() => {
    const updateSlotCount = () => {
      const width = toolbarContainerRef.current?.clientWidth || 0;
      if (!width) return;
      // Count every detachable tool as potential toolbar capacity so returning
      // an item from More does not suddenly change the scale of the grid.
      const requiredSlots = TOOLBAR_ITEMS.reduce(
        (total, item) =>
          isGeneralSettingsSection(item.id) ||
          (BUILT_IN_MORE_TOOL_IDS.includes(
            item.id as (typeof BUILT_IN_MORE_TOOL_IDS)[number],
          ) && toolbarLayout.more.includes(item.id))
            ? total
            : total + (item.slots || 1),
        DEFAULT_TOOLBAR_START_SLOT,
      );
      setToolbarContainerWidth(width);
      setToolbarSlotCount(
        Math.max(requiredSlots, Math.floor(width / TOOLBAR_SLOT_WIDTH)),
      );
    };
    updateSlotCount();
    const observer = new ResizeObserver(updateSlotCount);
    if (toolbarContainerRef.current) {
      observer.observe(toolbarContainerRef.current);
    }
    window.addEventListener("resize", updateSlotCount);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", updateSlotCount);
    };
  }, [toolbarLayout.general, toolbarLayout.more]);

  const toolbarDisplayOrder = toolbarPreviewOrder || toolbarLayout.order;

  const toolbarItemSlots = (id: ToolbarItemId) =>
    TOOLBAR_ITEMS.find((item) => item.id === id)?.slots || 1;

  const isToolbarItemInMore = (id: ToolbarItemId) =>
    toolbarLayout.more.includes(id);

  const isToolbarItemInGeneral = (id: ToolbarItemId) =>
    isGeneralSettingsSection(id) && toolbarLayout.general.includes(id);

  const isToolbarItemHidden = (id: ToolbarItemId) =>
    (isToolbarItemInMore(id) && returnDraggingIdRef.current !== id) || isToolbarItemInGeneral(id);

  const toolbarVisibleOrder = toolbarDisplayOrder.filter(
    (id) => !isToolbarItemHidden(id),
  );

  const getDefaultToolbarSlots = (
    slotCount: number,
    order: ToolbarItemId[],
  ) => {
    const visible = order.filter((id) => !isToolbarItemHidden(id));
    const occupiedSlots = visible.reduce(
      (total, id) => total + toolbarItemSlots(id),
      0,
    );
    let cursor =
      occupiedSlots + DEFAULT_TOOLBAR_START_SLOT <= slotCount
        ? DEFAULT_TOOLBAR_START_SLOT
        : 0;
    const slots: Partial<Record<ToolbarItemId, number>> = {};
    visible.forEach((id) => {
      slots[id] = cursor;
      cursor += toolbarItemSlots(id);
    });
    return slots;
  };

  const packToolbarSlots = (
    slotCount: number,
    order: ToolbarItemId[],
    desiredSlots: Partial<Record<ToolbarItemId, number>>,
    draggedId?: ToolbarItemId,
  ) => {
    const visible = order.filter((id) => !isToolbarItemHidden(id));
    const defaultSlots = getDefaultToolbarSlots(slotCount, order);
    const arranged = visible
      .map((id, index) => ({
        id,
        index,
        start: desiredSlots[id] ?? defaultSlots[id] ?? 0,
      }))
      .sort((a, b) => {
        if (a.start !== b.start) return a.start - b.start;
        if (a.id === draggedId) return -1;
        if (b.id === draggedId) return 1;
        return a.index - b.index;
      });

    const packed: Partial<Record<ToolbarItemId, number>> = {};
    let cursor = 0;
    arranged.forEach(({ id, start }) => {
      const itemSlots = toolbarItemSlots(id);
      const maxStart = Math.max(0, slotCount - itemSlots);
      const nextStart = Math.max(cursor, Math.min(maxStart, Math.round(start)));
      packed[id] = nextStart;
      cursor = nextStart + itemSlots;
    });

    if (cursor > slotCount) {
      const shift = cursor - slotCount;
      arranged.forEach(({ id }) => {
        packed[id] = Math.max(0, (packed[id] ?? 0) - shift);
      });
      cursor = 0;
      arranged.forEach(({ id }) => {
        const itemSlots = toolbarItemSlots(id);
        const nextStart = Math.max(cursor, packed[id] ?? 0);
        packed[id] = nextStart;
        cursor = nextStart + itemSlots;
      });
    }

    return packed;
  };

  const toolbarSlots =
    toolbarPreviewSlots ||
    packToolbarSlots(
      toolbarSlotCount,
      toolbarVisibleOrder,
      toolbarLayout.slots || getDefaultToolbarSlots(toolbarSlotCount, toolbarVisibleOrder),
    );

  const toolbarItemSlotStart = (id: ToolbarItemId) =>
    toolbarSlots[id] ?? getDefaultToolbarSlots(toolbarSlotCount, toolbarVisibleOrder)[id] ?? 0;

  const toolbarSlotPixelWidth = toolbarContainerWidth > 0
    ? toolbarContainerWidth / toolbarSlotCount
    : TOOLBAR_SLOT_WIDTH;
  const toolbarItemScale = Math.min(
    1,
    toolbarSlotPixelWidth / TOOLBAR_SLOT_WIDTH,
  );

  const getToolbarItemAtSlot = (
    slots: Partial<Record<ToolbarItemId, number>>,
    order: ToolbarItemId[],
    slot: number,
    ignoredId?: ToolbarItemId,
  ) =>
    order.find((id) => {
      if (id === ignoredId || isToolbarItemHidden(id)) return false;
      const start = slots[id] ?? 0;
      const end = start + toolbarItemSlots(id);
      return slot >= start && slot < end;
    });

  const previewToolbarItemAtSlot = (
    dragId: ToolbarItemId,
    targetSlot: number,
  ) => {
    const baseOrder =
      toolbarPreviewOrderRef.current || normalizeToolbarLayout(toolbarLayout).order;
    const baseSlots =
      toolbarPreviewSlotsRef.current ||
      toolbarLayout.slots ||
      getDefaultToolbarSlots(toolbarSlotCount, baseOrder);
    const safeTargetSlot = Math.max(
      0,
      Math.min(toolbarSlotCount - toolbarItemSlots(dragId), targetSlot),
    );
    const targetId = getToolbarItemAtSlot(
      baseSlots,
      baseOrder,
      safeTargetSlot,
      dragId,
    );
    if (targetId === "more" && dragId !== "more") return;
    const dragStart = baseSlots[dragId] ?? 0;
    const desiredSlots = {
      ...baseSlots,
      [dragId]: targetId ? baseSlots[targetId] ?? safeTargetSlot : safeTargetSlot,
      ...(targetId ? { [targetId]: dragStart } : {}),
    };
    const nextSlots = packToolbarSlots(
      toolbarSlotCount,
      baseOrder,
      desiredSlots,
      dragId,
    );
    const visibleOrder = baseOrder
      .filter((id) => !isToolbarItemHidden(id))
      .sort((a, b) => (nextSlots[a] ?? 0) - (nextSlots[b] ?? 0));
    const hiddenOrder = baseOrder.filter((id) => isToolbarItemHidden(id));
    const nextOrder = [...visibleOrder, ...hiddenOrder];
    toolbarPreviewOrderRef.current = nextOrder;
    toolbarPreviewSlotsRef.current = nextSlots;
    setToolbarPreviewOrder(nextOrder);
    setToolbarPreviewSlots(nextSlots);
  };

  const getToolbarPointerSlotFromPointer = (
    clientX: number,
    container: HTMLElement,
    itemId: ToolbarItemId = toolbarDragId || "zoom",
  ) => {
    const rect = container.getBoundingClientRect();
    const slotWidth = rect.width / Math.max(1, toolbarSlotCount);
    const gridLeft = rect.left;
    return Math.max(
      0,
      Math.min(
        toolbarSlotCount - toolbarItemSlots(itemId),
        (clientX - gridLeft) / Math.max(1, slotWidth),
      ),
    );
  };

  const getToolbarDropIndexFromPointer = (
    clientX: number,
    container: HTMLElement,
    itemId: ToolbarItemId = toolbarDragId || "zoom",
  ) =>
    Math.floor(getToolbarPointerSlotFromPointer(clientX, container, itemId));

  const previewToolbarDropFromPointer = (
    clientX: number,
    container: HTMLElement,
    dragId: ToolbarItemId,
  ) => {
    const pointerSlot = getToolbarPointerSlotFromPointer(
      clientX,
      container,
      dragId,
    );
    const targetSlot = Math.floor(pointerSlot);
    const currentSlots = toolbarPreviewSlotsRef.current;
    const currentStart = currentSlots?.[dragId] ?? targetSlot;
    const pending = toolbarReorderPendingRef.current;
    const decision = evaluateToolbarReorderPreview({
      pointerSlot,
      currentStart,
      itemSlots: toolbarItemSlots(dragId),
      targetStart: targetSlot,
      pendingSince: pending?.targetSlot === targetSlot ? pending.pendingSince : null,
      now: Date.now(),
    });
    if (decision.shouldPreview) {
      previewToolbarItemAtSlot(dragId, targetSlot);
    }
    toolbarReorderPendingRef.current = decision.pendingSince === null
      ? null
      : { targetSlot, pendingSince: decision.pendingSince };
  };

  const commitToolbarPreview = () => {
    const committedOrder = toolbarPreviewOrderRef.current;
    const committedSlots = toolbarPreviewSlotsRef.current;
    if (!committedOrder) return;
    toolbarDropCommittedRef.current = true;
    setToolbarLayout((prev) => ({
      ...normalizeToolbarLayout(prev),
      order: committedOrder,
      slots: committedSlots || prev.slots,
    }));
    toolbarPreviewOrderRef.current = null;
    toolbarPreviewSlotsRef.current = null;
    toolbarDragOriginSlotsRef.current = null;
    toolbarReorderPendingRef.current = null;
    setToolbarPreviewOrder(null);
    setToolbarPreviewSlots(null);
    setToolbarDragStatus(null);
  };

  const cancelToolbarPreview = () => {
    toolbarPreviewOrderRef.current = null;
    toolbarPreviewSlotsRef.current = null;
    toolbarDragOriginSlotsRef.current = null;
    toolbarReorderPendingRef.current = null;
    toolbarDropCommittedRef.current = false;
    setToolbarPreviewOrder(null);
    setToolbarPreviewSlots(null);
    setToolbarDragStatus(null);
  };

  const moveToolbarItemToMore = (itemId: ToolbarItemId) => {
    if (!canMoveToolbarItemToMore(itemId) || isGeneralSettingsSection(itemId)) {
      cancelToolbarPreview();
      return false;
    }

    setToolbarLayout((current) => {
      const normalized = normalizeToolbarLayout(current);
      if (normalized.more.includes(itemId)) return normalized;
      return {
        ...normalized,
        // Moving to More only changes visibility. Slot ownership remains
        // stable so the toolbar does not jump while the user chooses tools.
        more: [...normalized.more, itemId],
        slots: {
          ...normalized.slots,
          ...toolbarSlots,
        },
      };
    });
    cancelToolbarPreview();
    setDetachedMoreMenuId(null);
    return true;
  };

  const startMoreToolDrag = (event: React.PointerEvent<HTMLElement>, itemId: ToolbarItemId) => {
    if (event.button !== 0) return;
    event.preventDefault(); event.stopPropagation();
    returnDragCleanupRef.current?.();
    setHeldMoreTool(itemId);
    const captureOwner = event.currentTarget.closest("header") as HTMLElement ?? event.currentTarget;
    captureOwner.setPointerCapture(event.pointerId);
    const source = document.querySelector<HTMLElement>(`[data-toolbar-item="${itemId}"]`);
    let ghost: HTMLElement | null = null;
    const menu = event.currentTarget.closest('.toolbar-dropdown')!.getBoundingClientRect();
    const pointerId = event.pointerId;
    let detached = false;
    const isInside = (x: number, y: number, rect: DOMRect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    const cleanup = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      returnDragCleanupRef.current = null;
      returnDraggingIdRef.current = null;
      setReturnDraggingId(null); setHeldMoreTool(null); setToolbarDragId(null);
      toolbarDragIdRef.current = null;
      document.body.style.userSelect = '';
      ghost?.remove();
      if (captureOwner.hasPointerCapture(pointerId)) captureOwner.releasePointerCapture(pointerId);
      window.removeEventListener('blur', blur);
    };
    const move = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      if (!detached && !isInside(next.clientX, next.clientY, menu)) {
        detached = true;
        returnDraggingIdRef.current = itemId;
        setReturnDraggingId(itemId); setToolbarCustomizeMode(false); setShowMoreToolsDropdown(false);
        toolbarDragIdRef.current = itemId; setToolbarDragId(itemId);
        document.body.style.userSelect = 'none';
        if (source) {
          ghost = createToolbarDragPreview(source, toolbarItemScale);
          ghost.setAttribute('data-more-drag-ghost', 'true');
          ghost.style.opacity = '.65';
        }
      }
      if (!detached) return;
      if (ghost) {
        const bounds = ghost.getBoundingClientRect();
        ghost.style.left = (next.clientX - bounds.width / 2) + 'px';
        ghost.style.top = (next.clientY - bounds.height / 2) + 'px';
      }
      const zone = document.querySelector<HTMLElement>('[data-toolbar-surface="true"]');
      if (zone && isInside(next.clientX, next.clientY, zone.getBoundingClientRect())) previewToolbarItemAtSlot(itemId, getToolbarDropIndexFromPointer(next.clientX, zone, itemId));
    };
    const up = (next: PointerEvent) => {
      if (next.pointerId !== pointerId) return;
      const zone = document.querySelector<HTMLElement>('[data-toolbar-surface="true"]');
      if (detached && zone && isInside(next.clientX, next.clientY, zone.getBoundingClientRect())) {
        previewToolbarItemAtSlot(itemId, getToolbarDropIndexFromPointer(next.clientX, zone, itemId));
        const order = toolbarPreviewOrderRef.current;
        const slots = toolbarPreviewSlotsRef.current;
        setToolbarLayout(current => ({ ...current, more: current.more.filter(id => id !== itemId), order: order ?? current.order, slots: slots ?? current.slots }));
      }
      cancelToolbarPreview(); cleanup();
    };
    const cancel = (next: PointerEvent) => { if (next.pointerId === pointerId) { cancelToolbarPreview(); cleanup(); } };
    const blur = () => { cancelToolbarPreview(); cleanup(); };
    window.addEventListener('blur', blur);
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    returnDragCleanupRef.current = cleanup;
  };

  const toolbarItemProps = (id: ToolbarItemId) => ({
    "data-toolbar-item": id,
    "data-toolbar-drag-suppressed": moreDropActive && toolbarDragId === id ? "true" : undefined,
    "data-toolbar-slot-start": toolbarItemSlotStart(id),
    "data-toolbar-slot-span": toolbarItemSlots(id),
    style: {
      display: isToolbarItemHidden(id) ? "none" : undefined,
      gridColumn: `${toolbarItemSlotStart(id) + 1} / span ${toolbarItemSlots(id)}`,
      gridRow: "1",
      justifySelf: "center",
      alignSelf: "center",
      transform: `scale(${toolbarItemScale})`,
      transformOrigin: "center",
      "--toolbar-dropdown-inverse-scale": String(
        1 / Math.max(0.0001, toolbarItemScale),
      ),
    } as React.CSSProperties,
    draggable: toolbarCustomizeMode && !isToolbarItemHidden(id),
    onClickCapture: (event: React.MouseEvent<HTMLElement>) => {
      if (!toolbarCustomizeMode) return;
      event.preventDefault();
      event.stopPropagation();
    },
    onDragStart: (e: React.DragEvent<HTMLElement>) => {
      if (!toolbarCustomizeMode) return;
      const order = normalizeToolbarLayout(toolbarLayout).order;
      const slots = packToolbarSlots(
        toolbarSlotCount,
        order,
        toolbarLayout.slots || getDefaultToolbarSlots(toolbarSlotCount, order),
        id,
      );
      toolbarPreviewOrderRef.current = order;
      toolbarPreviewSlotsRef.current = slots;
      toolbarDragOriginSlotsRef.current = { ...slots };
      toolbarReorderPendingRef.current = null;
      toolbarDropCommittedRef.current = false;
      setToolbarPreviewOrder(order);
      setToolbarPreviewSlots(slots);
      toolbarDragIdRef.current = id;
      setToolbarDragId(id);
      e.dataTransfer.setData("toolbar-item", id);
      e.dataTransfer.effectAllowed = "move";
      const dragPreview = createToolbarDragPreview(e.currentTarget, toolbarItemScale);
      const rect = dragPreview.getBoundingClientRect();
      e.dataTransfer.setDragImage(
        dragPreview,
        rect.width / 2,
        rect.height / 2,
      );
      window.setTimeout(() => dragPreview.remove(), 0);
    },
    onDragEnter: (e: React.DragEvent<HTMLElement>) => {
      if (!toolbarCustomizeMode) return;
      e.preventDefault();
    },
    onDragOver: (e: React.DragEvent<HTMLElement>) => {
      if (!toolbarCustomizeMode) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      const dragId =
        (e.dataTransfer.getData("toolbar-item") as ToolbarItemId) ||
        toolbarDragIdRef.current ||
        toolbarDragId;
      const container = (e.currentTarget as HTMLElement).closest(
        "[data-toolbar-drop-zone='true']",
      ) as HTMLElement | null;
      if (dragId && container) {
        previewToolbarDropFromPointer(e.clientX, container, dragId);
      }
    },
    onDragEnd: () => {
      setMoreDropActive(false);
      if (!toolbarDropCommittedRef.current) {
        cancelToolbarPreview();
      }
      toolbarDropCommittedRef.current = false;
      toolbarDragIdRef.current = null;
      setToolbarDragId(null);
    },
    onDrop: (e: React.DragEvent<HTMLElement>) => {
      if (!toolbarCustomizeMode) return;
      e.preventDefault();
      e.stopPropagation();
      const dragId =
        (e.dataTransfer.getData("toolbar-item") as ToolbarItemId) ||
        toolbarDragIdRef.current ||
        toolbarDragId;
      const container = (e.currentTarget as HTMLElement).closest(
        "[data-toolbar-drop-zone='true']",
      ) as HTMLElement | null;
      if (dragId && container) {
        previewToolbarItemAtSlot(
          dragId,
          getToolbarDropIndexFromPointer(e.clientX, container, dragId),
        );
      }
      commitToolbarPreview();
      toolbarDragIdRef.current = null;
      setToolbarDragId(null);
    },
  });

  const toolbarItemClass = (id: ToolbarItemId, className: string) =>
    cn(
      "flex h-[34px] min-h-[34px] min-w-0 items-center justify-center gap-0 [&>button]:h-8 [&>button]:min-w-8 [&>button]:py-0",
      toolbarEditingMode && TOOLBAR_EDITING_CLASSES,
      className,
      toolbarCustomizeMode &&
        !isToolbarItemHidden(id) &&
        "cursor-grab active:cursor-grabbing",
      toolbarDragId === id &&
        "opacity-100 border-gray-500/80 bg-gray-300/50 ring-2 ring-gray-400/60 shadow-sm",
    );

  const activateToolbarOverflowItem = (id: ToolbarItemId) => {
    if (
      !getEffectiveToolMenuSettings("more").alwaysOnTop &&
      !getEffectiveToolMenuSettings(getToolMenuId(id)).alwaysOnTop
    ) {
      setShowMoreToolsDropdown(false);
    }
    switch (id) {
      case "select":
        setActiveTool("select");
        break;
      case "pan":
        setActiveTool("pan");
        break;
      case "text":
        setActiveTool("text");
        break;
      case "shapes":
        setActiveTool(SHAPE_TYPES.includes(activeTool) ? activeTool : "rectangle");
        break;
      case "media":
        setActiveTool("media");
        break;
      case "table":
        setActiveTool("table");
        break;
      case "polygon-select":
      case "lasso":
      case "crop":
        setActiveTool(id);
        break;
      case "eyedropper": {
        const source=elements.find(element=>element.id===selectedId)?.type??activeTool;
        setEyedropperTarget(elementColors(source).strokeOnly?'stroke':isTextToolActive(source)?'text':'fill');
        setActiveTool(id);break;
      }
      case "draw":
        setActiveTool("draw");
        break;
      case "fill":
        setActiveTool("fill");
        break;
      case "eraser":
        setActiveTool("eraser");
        break;
      case "embed":
        setActiveTool("embed");
        break;
      case "board":
        setActiveTool("board");
        break;
      case "link":
        setActiveTool("link");
        break;
      case "object-presets":
        setShowObjectPresetsPanel(true);
        setActiveTool("select");
        break;
    }
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent | TouchEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest(".toolbar-dropdown") ||
        target.closest("[data-toolbar-item]")
      ) {
        return;
      }
      closeAllDropdowns({
        preservePresetPicking: shouldPreservePresetPicking({
          hasActivePreset: Boolean(pickingObjectPresetId),
          isPrimaryPointer: !("button" in e) || e.button === 0,
          isElementTarget: Boolean(
            target.closest('[data-board-element="true"]'),
          ),
        }),
      });
    };
    document.addEventListener("mousedown", handleClickOutside);
    document.addEventListener("touchstart", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("touchstart", handleClickOutside);
    };
  }, [
    alwaysOnTop,
    keepToolActive,
    previewMode,
    detachedMoreMenuId,
    pickingObjectPresetId,
    toolSettingsOverrides,
    toolbarLayout.more,
  ]);

  // Keep every toolbar menu usable when the toolbar is close to a viewport edge.
  // Menus retain their normal anchor; only the overflow correction is applied.
  useEffect(() => {
    let frame: number | null = null;
    const clampToolbarDropdowns = () => {
      if (frame !== null) cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        frame = null;
        document.querySelectorAll<HTMLElement>(".toolbar-dropdown").forEach((menu) => {
          // Reset before measuring so repeated resize/scroll events do not
          // accumulate the previous correction.
          menu.style.marginLeft = "0px";
          menu.style.maxWidth = `${Math.max(1, window.innerWidth - 16)}px`;
          const rect = menu.getBoundingClientRect();
          const horizontalCorrection =
            Math.min(0, window.innerWidth - 8 - rect.right) +
            Math.max(0, 8 - rect.left);
          const inverseScale =
            Number.parseFloat(
              getComputedStyle(menu).getPropertyValue(
                "--toolbar-dropdown-inverse-scale",
              ),
            ) || 1;
          menu.style.marginLeft =
            horizontalCorrection === 0
              ? ""
              : `${horizontalCorrection * inverseScale}px`;
          const availableHeight = Math.max(120, window.innerHeight - rect.top - 8);
          menu.style.maxHeight = `${availableHeight}px`;
          menu.style.overflowY = menu.querySelector(":scope > .menu-scroll-viewport") ? "hidden" : "auto";
        });
      });
    };

    clampToolbarDropdowns();
    window.addEventListener("resize", clampToolbarDropdowns);
    window.addEventListener("scroll", clampToolbarDropdowns, true);
    return () => {
      if (frame !== null) cancelAnimationFrame(frame);
      window.removeEventListener("resize", clampToolbarDropdowns);
      window.removeEventListener("scroll", clampToolbarDropdowns, true);
    };
  }, [
    expandedMoreTools,
    detachedMoreMenuId,
    showDrawDropdown,
    showEraserSettingsDropdown,
    showFillDropdown,
    showLayersPanel,
    showMediaSettingsDropdown,
    showMoreToolsDropdown,
    showObjectPresetsPanel,
    showPanDropdown,
    showSelectDropdown,
    showShapeDropdown,
    showTextSettingsDropdown,
    showZoomSettingsDropdown,
  ]);

  const cancelAreaPlacementDrag = () => {
    clearAreaGesture();
  };

  const creationParentId = (point: { x: number; y: number }) =>
    getPlacementSection(point, elementsRef.current)?.id ?? targetLayerId ?? undefined;

  const creationClip = (rect: { x: number; y: number; w: number; h: number }, rotation = 0) => getSectionClipPath({
    id: 'creation-preview', type: activeTool as ElementType, content: '',
    position: { x: rect.x, y: rect.y }, size: { width: rect.w, height: rect.h }, rotation,
    parentId: creationParentId(areaGestureRef.current?.start ?? { x: rect.x, y: rect.y }),
    zIndex: Math.max(0, ...elementsRef.current.map(e => e.zIndex)) + 1,
  }, elementsRef.current);

  const handleAddRegionElement = (
    type: ElementType,
    rect: { x: number; y: number; w: number; h: number },
    extraProps?: Partial<BoardElement>,
  ) => {
    const latestElements = elementsRef.current;
    let finalRect =
      type === "board" && (rect.w < gridSize || rect.h < gridSize)
        ? { ...rect, w: 360, h: 220 }
        : { ...rect };

    if (type === "embed" || type === "media" || type === "table") {
      const minimum = getElementMinSize({
        type,
        mediaMime: extraProps?.mediaMime,
      });
      finalRect.w = Math.max(finalRect.w, minimum.width);
      finalRect.h = Math.max(finalRect.h, minimum.height);
      const bounds = activeSurfaceBoundsRef.current;
      if (bounds) {
        finalRect.w = Math.min(finalRect.w, bounds.maxX - bounds.minX);
        finalRect.h = Math.min(finalRect.h, bounds.maxY - bounds.minY);
        finalRect.x = Math.min(
          Math.max(bounds.minX, finalRect.x),
          Math.max(bounds.minX, bounds.maxX - finalRect.w),
        );
        finalRect.y = Math.min(
          Math.max(bounds.minY, finalRect.y),
          Math.max(bounds.minY, bounds.maxY - finalRect.h),
        );
      }
    }

    if (overlapMode === "full" && type !== "section" && type !== "board") {
      const isOverlap = latestElements.some((el) => {
        if (el.type === "section" || el.type === "board") return false;
        const ew = el.size?.width || 100;
        const eh = el.size?.height || 40;
        return (
          finalRect.x < el.position.x + ew &&
          finalRect.x + finalRect.w > el.position.x &&
          finalRect.y < el.position.y + eh &&
          finalRect.y + finalRect.h > el.position.y
        );
      });
      if (isOverlap) {
        finishToolUse(type);
        return; // Block placement
      }
    }

    // Convert generic shapes
    let defaultContent = "";
    if (type === "h1" || type === "h2" || type === "h3") defaultContent = "";
    if (type === "text") defaultContent = "";
    if (type === "table") defaultContent = JSON.stringify(createWorkbookDocument());

    const placementProps = resolveObjectPlacementProps({
      type,
      pendingProps,
      savedDefaults: objectDefaultsRef.current[type],
      baseline: pendingPropsBaselineRef.current,
    });
    const newElement: BoardElement = {
      id: generateId(),
      type,
      parentId: type === "board" ? undefined : creationParentId(areaGestureRef.current?.start ?? { x: finalRect.x, y: finalRect.y }),
      position: { x: finalRect.x, y: finalRect.y },
      content: defaultContent,
      color:
        type === "section"
          ? "transparent"
          : type === "sticky"
            ? "#fef3c7"
            : TEXT_TYPES.includes(type)
              ? "transparent"
              : "#ffffff",
      sectionCollision: type === "section" ? "clip" : undefined,
      borderWidth:
        type === "triangle"
          ? pendingProps.borderWidth !== undefined
            ? pendingProps.borderWidth
            : 2
          : pendingProps.borderWidth,
      borderColor:
        type === "triangle"
          ? pendingProps.borderColor || "#000000"
          : pendingProps.borderColor,
      zIndex:
        type === "section" || type === "board"
          ? Math.min(0, ...latestElements.map((e) => e.zIndex)) - 1
          : Math.max(0, ...latestElements.map((e) => e.zIndex)) + 1,
      size: { width: finalRect.w, height: finalRect.h },
      ...placementProps,
      ...extraProps,
    };

    const placedElement = type === 'board'
      ? createBoardSurface(newElement.id, newElement.position, newElement.size!, newElement.color, newElement.zIndex)
      : newElement;
    pushElements([...latestElements, placedElement]);

    finishToolUse(type);

    // Keep newly placed text selected even when auto-select is disabled. A
    // blank text object is intentionally editable immediately after placement;
    // clearing selection here made it look as if the field had disappeared.
    if (autoSelectOnPlace || TEXT_TYPES.includes(type as (typeof TEXT_TYPES)[number]) || type === "sticky" || type === "table") {
      setTimeout(() => setSelectedId(newElement.id), 0);
    } else {
      setTimeout(() => setSelectedId(null), 0);
    }
  };

  const handleAddCustomColor = (
    color: string,
    index: number,
    type: "bg" | "text" | "border" | "grid" | "fill",
  ) => {
    setCustomColors((prev) => {
      const next = { ...prev };
      next[type] = [...next[type]];
      next[type][index] = color;
      return next;
    });
  };

  const changeTextColor = (color: string) => {
    const selected = elementsRef.current.find(element => element.id === selectedId);
    const editor = selected ? document.querySelector<HTMLElement>(`[data-board-element-editor-id="${selected.id}"]`) : null;
    const live = window.getSelection();
    const range = live?.rangeCount ? live.getRangeAt(0) : null;
    if (selected && editor?.isContentEditable && elementColors(selected.type).text) {
      const colorPickerFocused = document.activeElement instanceof HTMLInputElement && document.activeElement.type === "color";
      const candidate = range && editor.contains(range.commonAncestorContainer) ? range : colorPickerFocused ? savedRange : null;
      const restoreEditingFocus = (selectionRange: Range | null) => {
        if (!selectionRange || !editor.contains(selectionRange.commonAncestorContainer)) return;
        editor.focus({ preventScroll: true });
        live?.removeAllRanges(); live?.addRange(selectionRange);
        setSavedRange(selectionRange.cloneRange());
      };
      const usableRange = candidate && !candidate.collapsed && editor.contains(candidate.commonAncestorContainer) ? candidate : null;
      if (usableRange) {
        const colored = colorTextRange(editor, usableRange, color);
        if (colored) {
          restoreEditingFocus(colored);
          const content = sanitizeRichText(editor.innerHTML);
          replaceTextEditorHtml(editor, content);
          updateElement(selected.id, { content });
          return;
        }
      }
      editor.querySelectorAll<HTMLElement>('[style]').forEach(node => node.style.removeProperty('color'));
      restoreEditingFocus(candidate);
      const content = sanitizeRichText(editor.innerHTML);
      replaceTextEditorHtml(editor, content);
      updateElement(selected.id, { textColor: color, content });
    } else if (selected && elementColors(selected.type).text) {
      const holder = document.createElement('div'); holder.innerHTML = selected.content;
      holder.querySelectorAll<HTMLElement>('[style]').forEach(node => node.style.removeProperty('color'));
      updateElement(selected.id, { textColor: color, content: sanitizeRichText(holder.innerHTML) });
    } else {
      setPendingProps(current => ({ ...current, textColor: color }));
    }
  };

  const updateElement = (
    id: string,
    updates: Partial<BoardElement>,
    skipHistory = false,
  ) => {
    const applyElementUpdate = (source: BoardElement[]) => {
      const resizing=secondaryResizeRef.current;
      return updateMergedGroup(source,id,updates).map(element=>{
        if(resizing?.id===id&&!resizing.keepContent&&updates.position&&resizing.members.has(element.id)) {
          const initial=resizing.elements.find(item=>item.id===element.id)!;
          return {...element,position:{x:initial.position.x+updates.position.x-resizing.origin.x,y:initial.position.y+updates.position.y-resizing.origin.y}};
        }
        return element;
      });
    };

    if (skipHistory) {
      const next = applyElementUpdate(elementsRef.current);
      elementsRef.current = next;
      setElements(next);
    } else {
      pushElements(applyElementUpdate(elementsRef.current));
      if(secondaryResizeRef.current?.id===id)secondaryResizeRef.current=null;
    }
  };

  const toolForSelectedElement = (element: BoardElement) => {
    if(element.type==='group')return 'select';
    if (element.type === "image" || element.type === "media") return "media";
    if (element.type === "embed") return "embed";
    if (element.type === "section") return "section";
    if (element.type === "board") return "board";
    return element.type;
  };

  const hasActiveToolbarOverflowItem = toolbarLayout.more.some((id) => {
    if (id === "text") return isTextTool;
    return activeTool === id;
  });

  const createMediaFromFile = async (
    file: File,
    position: { x: number; y: number },
    region?: ClipboardRegion,
  ):Promise<BoardElement> => {
    const fileMime = inferFileMime(file);
    if (!isSupportedMediaMime(fileMime)) throw new Error('Unsupported media file.');
    assertFileSize(file.size, MAX_MEDIA_FILE_BYTES, "Media file");

    const makeMediaElement = (
      dataUrl: string,
      mediaSize: { width: number; height: number },
    ) => {
      const latestElements = elementsRef.current;
      if (region) {
        const scale = Math.min(region.w/mediaSize.width,region.h/mediaSize.height);
        mediaSize = {width:mediaSize.width*scale,height:mediaSize.height*scale};
        position = {x:region.x+(region.w-mediaSize.width)/2,y:region.y+(region.h-mediaSize.height)/2};
      }
      const bounds = getInteractionBoundsAtPoint(position) ?? {minX:0,minY:0,maxX:pageDimensions.width,maxY:pageDimensions.height};
      const newEl: BoardElement = {
        ...(objectDefaultsRef.current.media || {}),
        id: generateId(),
        type: "media",
        parentId: targetLayerId ?? undefined,
        position: {
          x: Math.min(
            Math.max(bounds.minX, position.x),
            Math.max(bounds.minX, bounds.maxX - mediaSize.width),
          ),
          y: Math.min(
            Math.max(bounds.minY, position.y),
            Math.max(bounds.minY, bounds.maxY - mediaSize.height),
          ),
        },
        size: mediaSize,
        content: dataUrl,
        mediaKind: "media",
        mediaMime: inferMediaMime(dataUrl, fileMime),
        keepRatio: !fileMime.startsWith("audio/"),
        color: "#f8fafc",
        zIndex: Math.max(0,...latestElements.map(element=>element.zIndex)) + 1,
      };
      return newEl;
    };
    const decoded=await new Promise<{dataUrl:string;size:{width:number;height:number}}>((resolve,reject)=>{
      if(fileMime.startsWith('image/')||fileMime==='image/url')handleImageUpload(file,(dataUrl,w,h)=>resolve({dataUrl,size:getScaledMediaSize(w,h)}),reject);
      else {
        const reader=new FileReader();
        reader.onerror=()=>reject(new Error('Could not read the media file.'));
        reader.onabort=()=>reject(new Error('Media import was interrupted.'));
        reader.onload=()=>resolve({dataUrl:String(reader.result),size:fileMime.startsWith('audio/')?AUDIO_DEFAULT_SIZE:MEDIA_DEFAULT_SIZE});
        reader.readAsDataURL(file);
      }
    });
    return makeMediaElement(decoded.dataUrl,decoded.size);
  };

  const addMediaFilesToBoard=async(files:File[],position:{x:number;y:number},region?:ClipboardRegion)=>{
    try {
      const imported=await Promise.all(files.map((file,index)=>createMediaFromFile(file,{x:position.x+index*24,y:position.y+index*24},region)));
      const topZ=Math.max(0,...elementsRef.current.map(element=>element.zIndex));
      const placed=imported.map((element,index)=>({...element,zIndex:topZ+index+1}));
      pushElements([...elementsRef.current,...placed]);setSelectedIds(placed.map(element=>element.id));setActiveTool('select');
    } catch(error) {alert(error instanceof Error?error.message:'Could not import media.');}
  };

  const addBoardPackageToBoard = async (
    file: File,
    position: { x: number; y: number },
  ) => {
    if (!isBoardPackageFile(file)) return false;

    try {
      const parsed = await readBoardPackageFile(file);
      const placed = placeBoardPackage(parsed, {
        existingElements: elementsRef.current,
        existingSheets: sectionSheetsRef.current,
        pageSize: pageDimensions,
        position,
        parentId: targetLayerId ?? currentLayerView ?? undefined,
        createId: generateId,
      });
      pushDocument(placed.elements, placed.sectionSheets);
      setSelectedId(placed.selectedId);
      if (activeTool !== "select") setActiveTool("select");
      return true;
    } catch {
      return false;
    }
  };

  const handleBoardFileDrop = async (event: React.DragEvent) => {
    const files=Array.from<File>(event.dataTransfer.files);
    if (!files.length) return;
    event.preventDefault();event.stopPropagation();
    const rect=boardSurfaceRef.current?.getBoundingClientRect();
    if(!rect)return;
    const position={x:(event.clientX-rect.left)/zoomRef.current,y:(event.clientY-rect.top)/zoomRef.current};
    const media=files.filter(file=>isSupportedMediaMime(inferFileMime(file)));
    if(media.length)await addMediaFilesToBoard(media,position);
    for (const [index,file] of files.entries()) {
      const point={x:position.x+index*24,y:position.y+index*24};
      if (isBoardPackageFile(file)) await addBoardPackageToBoard(file,point);
    }
  };

  useEffect(() => {
    const clear = () => {delete document.documentElement.dataset.noteboardFileDrag;};
    const enter = (event: DragEvent) => {
      if (Array.from(event.dataTransfer?.types??[]).includes('Files')) document.documentElement.dataset.noteboardFileDrag='true';
    };
    const leave = (event: DragEvent) => {
      if(!event.relatedTarget&&(event.clientX<=0||event.clientY<=0||event.clientX>=innerWidth||event.clientY>=innerHeight))clear();
    };
    window.addEventListener('dragenter',enter,true);window.addEventListener('dragleave',leave,true);
    window.addEventListener('drop',clear,true);window.addEventListener('dragend',clear,true);window.addEventListener('blur',clear);
    return ()=>{clear();window.removeEventListener('dragenter',enter,true);window.removeEventListener('dragleave',leave,true);window.removeEventListener('drop',clear,true);window.removeEventListener('dragend',clear,true);window.removeEventListener('blur',clear);};
  },[]);

  const clipboardSelection = (region: ClipboardRegion | undefined = quickAddRegion ?? undefined) => {
    const latest = syncLiveEditableState(elementsRef.current);
    const ids = region ? selectElementsInOutline(latest,[
      {x:region.x,y:region.y},{x:region.x+region.w,y:region.y},
      {x:region.x+region.w,y:region.y+region.h},{x:region.x,y:region.y+region.h},
    ], respectLayerVisibility) : selectedIds;
    const roots = new Set(ids), hierarchy = createElementHierarchy(latest);
    return latest.filter(element => roots.has(element.id) || ids.some(id => hierarchy.isDescendantOf(element.id,id)));
  };

  const copySelectionToSystem = async (region?: ClipboardRegion) => {
    const source = clipboardSelection(region);
    if (!source.length) return;
    const copy = cloneBoardDocument(source, sectionSheetsRef.current, generateId);
    try { await copyBoardToSystem(copy.elements,copy.sheets); }
    catch { alert('Could not access the clipboard. Try Ctrl+C.'); }
  };

  const pasteClipboardContents = (contents: ClipboardContents, region?: ClipboardRegion, parentId?: string) => {
    const boardRect=boardSurfaceRef.current?.getBoundingClientRect(), viewport=containerRef.current?.getBoundingClientRect();
    if (!boardRect || !viewport) return;
    const position=region ? {x:region.x,y:region.y} : {x:(viewport.left+viewport.width/2-boardRect.left)/zoomRef.current,y:(viewport.top+viewport.height/2-boardRect.top)/zoomRef.current};
    const copied=readBoardClipboard({getData:type=>type==='text/html'?contents.html:type==='text/plain'?contents.text:''});
    if (copied?.elements.length) {
      const cloned=cloneBoardDocument(copied.elements,copied.sectionSheets,generateId);
      const topZ=Math.max(0,...elementsRef.current.map(element=>element.zIndex));
      const lowZ=Math.min(...cloned.elements.map(element=>element.zIndex));
      const destinationParent=parentId ?? (region ? creationParentId(position) : undefined);
      const pasted=placeClipboardElements(cloned.elements,region).map(element=>({...element,
        parentId:element.parentId ?? destinationParent,zIndex:topZ+element.zIndex-lowZ+1,
      }));
      pushDocument([...elementsRef.current,...pasted],[...sectionSheetsRef.current,...cloned.sheets]);
      const pastedHierarchy=createElementHierarchy(pasted);
      setSelectedIds(pasted.filter(element=>element.type!=='layer'&&element.type!=='board'&&!element.isEraser&&!isMergedGroupMember(element,pastedHierarchy)).map(element=>element.id));
      setQuickAddRegion(null);
      return;
    }
    const files=contents.files.filter(file=>isSupportedMediaMime(inferFileMime(file)));
    if (files.length) {
      void addMediaFilesToBoard(files,position,region);
      setQuickAddRegion(null); return;
    }
    const {text,html}=contents;
    if (!text && !html) return;
    const plain=text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\r?\n/g,'<br>');
    const content=sanitizeRichText(html || plain);
    const element: BoardElement={...objectDefaultsRef.current.text,id:generateId(),type:'text',content,position,
      parentId:parentId ?? (region?creationParentId(position):targetLayerId??undefined),
      size:region?{width:region.w,height:region.h}:{width:400,height:240},zIndex:Math.max(0,...elementsRef.current.map(item=>item.zIndex))+1};
    pushElements([...elementsRef.current,element]);setSelectedId(element.id);setActiveTool('text');setQuickAddRegion(null);
  };

  const pasteSystemClipboard = async (region?: ClipboardRegion, parentId?: string) => {
    try { pasteClipboardContents(await readCurrentClipboard(),region,parentId); }
    catch { alert('Could not access the clipboard. Try Ctrl+V.'); }
  };

  const mergeSelectionArea=()=>{
    const latest=syncLiveEditableState(elementsRef.current),source=clipboardSelection();
    const result=mergeAreaElements(latest,source.map(element=>element.id),generateId());
    if(!result)return;
    pushElements(result.elements);setSelectedId(result.group.id);setQuickAddRegion(null);setActiveTool('select');
    if(currentLayerView&&createElementHierarchy(result.elements).isDescendantOf(currentLayerView,result.group.id))setCurrentLayerView(result.group.parentId??null);
  };
  const ungroupSelection=()=>{
    if(!selectedId)return;
    const result=ungroupAreaElements(elementsRef.current,selectedId);
    pushElements(result.elements);setSelectedIds(result.selectedIds);setActiveTool('select');
  };

  useEffect(() => {
    const inEditor = (event: ClipboardEvent) => isClipboardTextTarget(event.target) || isClipboardTextTarget(document.activeElement) || Boolean(document.querySelector('dialog[data-spreadsheet-editor][open]'));
    const handleCopyOrCut = (event: ClipboardEvent) => {
      if (event.defaultPrevented || !event.clipboardData || inEditor(event)) return;
      const source=clipboardSelection();
      if (!source.length) return;
      const copy=cloneBoardDocument(source,sectionSheetsRef.current,generateId);
      if (!writeBoardClipboard(event.clipboardData,copy.elements,copy.sheets)) return;
      event.preventDefault();
      if (event.type==='cut') {
        let kept=syncLiveEditableState(elementsRef.current);
        for (const element of source) kept=removeElementTreeAndReferences(kept,element.id).elements;
        pushDocument(kept);setSelectedId(null);setQuickAddRegion(null);
      }
    };
    const handlePaste = (event: ClipboardEvent) => {
      if (event.defaultPrevented || !event.clipboardData || inEditor(event)) return;
      const contents={text:event.clipboardData.getData('text/plain'),html:event.clipboardData.getData('text/html'),files:Array.from(event.clipboardData.files)};
      if (!contents.text && !contents.html && !contents.files.length) return;
      event.preventDefault();pasteClipboardContents(contents,quickAddRegion??undefined);
    };
    window.addEventListener('copy',handleCopyOrCut);window.addEventListener('cut',handleCopyOrCut);window.addEventListener('paste',handlePaste);
    return ()=>{window.removeEventListener('copy',handleCopyOrCut);window.removeEventListener('cut',handleCopyOrCut);window.removeEventListener('paste',handlePaste);};
  });

  const removeElement = (
    id: string,
    cascadedElements: BoardElement[] = elements,
  ) => {
    const removal = removeElementTreeAndReferences(cascadedElements, id);
    const newElements = removal.elements;
    const removedElementIds = removal.removedIds;
    pushDocument(newElements, []);
    if (
      (selectedId && removedElementIds.has(selectedId)) ||
      !newElements.some((el) => el.id === selectedId)
    ) {
      setSelectedId(null);
    }
  };

  const duplicateElement = (id: string) => {
    if(elementsRef.current.find(element=>element.id===id)?.type==='group'){duplicateElementTree(id);return;}
    const requested = elements.find((e) => e.id === id);
    const el = requested ? elementHierarchy.ancestors(id).slice().reverse().find(parent=>parent.type==='group') ?? requested : undefined;
    if (el) {
      const newEl = {
        ...el,
        id: generateId(),
        ...(el.type === 'embed' ? { webSessionId: generateId() } : {}),
        sheetCell: undefined,
        position: { x: el.position.x + 20, y: el.position.y + 20 },
        zIndex: elements.length + 1,
      };
      pushElements([...elements, newEl]);
      setSelectedId(newEl.id);
    }
  };

  const duplicateElementTree = (id: string) => {
    const latestElements = elementsRef.current;
    const root = latestElements.find((el) => el.id === id);
    if (!root) return;
    const collected: BoardElement[] = [];
    const collect = (parentId: string) => {
      latestElements
        .filter((el) => el.id === parentId || el.parentId === parentId)
        .forEach((el) => {
          if (!collected.some((item) => item.id === el.id)) {
            collected.push(el);
            collect(el.id);
          }
        });
    };
    collect(id);
    const clones = cloneElementsWithOffset(collected);
    pushElements([...latestElements, ...clones]);
    setSelectedId(clones.find((el) => el.type !== "layer")?.id || clones[0]?.id);
  };

  const cloneElementsWithOffset = (
    source: BoardElement[],
    offset = { x: 20, y: 20 },
  ) => {
    const cloned = cloneBoardDocument(source, [], generateId, {
      preserveExternalParents: true,
      preserveExternalLinks: true,
    }).elements;
    const lowestZ = Math.min(
      ...cloned.map((element) =>
        Number.isFinite(element.zIndex) ? element.zIndex : 0,
      ),
    );
    const highestZ = Math.max(
      0,
      ...elementsRef.current.map((element) =>
        Number.isFinite(element.zIndex) ? element.zIndex : 0,
      ),
    );
    return cloned.map((element) => ({
      ...element,
      position: {
        x: element.position.x + offset.x,
        y: element.position.y + offset.y,
      },
      zIndex:
        highestZ +
        ((Number.isFinite(element.zIndex) ? element.zIndex : 0) - lowestZ) +
        1,
    }));
  };

  const getObjectDefaultProps = (element: Partial<BoardElement>) => {
    const keys: (keyof BoardElement)[] = [
      "color",
      "borderColor",
      "borderWidth",
      "borderRadius",
      "opacity",
      "flipX",
      "flipY",
      "keepRatio",
      "sectionCollision",
      "textColor",
      "fontSize",
      "textScaling",
      "textScale",
      "fontWeight",
      "textAlign",
      "lineHeight",
      "isBold",
      "isItalic",
      "mediaControlsHidden",
      "mediaLoop",
      "mediaPlaybackRate",
      "mediaVolume",
      "webRememberSession",
      "webDeviceMode",
      "webAdBlock",
      "webCookieBlocker",
      "webPopupBlocker",
    ];
    const defaults: Partial<BoardElement> = {};
    keys.forEach((key) => {
      if (element[key] !== undefined) {
        (defaults as any)[key] = element[key];
      }
    });
    return defaults;
  };

  const saveDefaultsForType = (
    type: ElementType,
    source: Partial<BoardElement>,
  ) => {
    const defaults = getObjectDefaultProps(source);
    const nextObjectDefaults = {
      ...objectDefaultsRef.current,
      [type]: defaults,
    };
    const nextPendingProps = { ...pendingProps, ...defaults };
    objectDefaultsRef.current = nextObjectDefaults;
    setObjectDefaults(nextObjectDefaults);
    setPendingProps(nextPendingProps);
    pendingPropsBaselineRef.current = {
      tool: activeTool,
      props: { ...nextPendingProps },
    };
    // Persist the explicit next snapshot now; waiting for the state update
    // would let the auto-save capture the previous defaults object.
    onSave(
      buildCurrentPage({
        objectDefaults: nextObjectDefaults,
        pendingProps: nextPendingProps,
      }),
    );
    setObjectDefaultsSaved(true);
    if (objectDefaultsSavedTimerRef.current) {
      clearTimeout(objectDefaultsSavedTimerRef.current);
    }
    objectDefaultsSavedTimerRef.current = setTimeout(() => {
      setObjectDefaultsSaved(false);
      objectDefaultsSavedTimerRef.current = null;
    }, 900);
  };

  const saveDefaultsForElement = (element: BoardElement) => {
    saveDefaultsForType(element.type, element);
  };

  const snapshotObjectForPreset = (element: BoardElement): BoardElement => ({
    ...element,
    id: "preset-source",
    parentId: undefined,
    isHidden: false,
    isLocked: false,
    position: { x: 0, y: 0 },
    zIndex: 1,
  });

  const getViewportCenterOnBoard = () => {
    const viewportRect = containerRef.current?.getBoundingClientRect();
    const boardSurfaceRect = boardSurfaceRef.current?.getBoundingClientRect();
    if (!viewportRect || !boardSurfaceRect) {
      return { x: pageDimensions.width / 2, y: pageDimensions.height / 2 };
    }
    return {
      x: (viewportRect.left + viewportRect.width / 2 - boardSurfaceRect.left) / zoom,
      y: (viewportRect.top + viewportRect.height / 2 - boardSurfaceRect.top) / zoom,
    };
  };

  const placeObjectPreset = (preset: ObjectPreset) => {
    if (!preset.element) return;
    const latestElements = elementsRef.current;
    const center = getViewportCenterOnBoard();
    const width = preset.element.size?.width || 120;
    const height = preset.element.size?.height || 80;
    if(preset.element.type==='group'&&preset.elements?.length){
      const rootIndex=preset.elements.findIndex(element=>element.id===preset.element!.id);
      if(rootIndex<0)return;
      const cloned=cloneBoardDocument(preset.elements,[],generateId).elements;
      const origin=preset.elements[rootIndex].position;
      const topZ=Math.max(0,...latestElements.map(element=>element.zIndex));
      const lowZ=Math.min(...cloned.map(element=>element.zIndex));
      const position={x:Math.max(0,Math.min(pageDimensions.width-width,center.x-width/2)),y:Math.max(0,Math.min(pageDimensions.height-height,center.y-height/2))};
      const placed=cloned.map(element=>({...element,parentId:element.parentId??targetLayerId??undefined,
        position:{x:element.position.x-origin.x+position.x,y:element.position.y-origin.y+position.y},zIndex:topZ+element.zIndex-lowZ+1}));
      pushElements([...latestElements,...placed]);setSelectedId(placed[rootIndex].id);setActiveTool('select');return;
    }
    const clone: BoardElement = {
      ...preset.element,
      id: generateId(),
      parentId: targetLayerId ?? undefined,
      position: {
        x: Math.max(
          0,
          Math.min(pageDimensions.width - width, center.x - width / 2),
        ),
        y: Math.max(
          0,
          Math.min(pageDimensions.height - height, center.y - height / 2),
        ),
      },
      zIndex: Math.max(0, ...latestElements.map((el) => el.zIndex)) + 1,
    };
    pushElements([...latestElements, clone]);
    setSelectedId(clone.id);
    if (activeTool !== "select") setActiveTool("select");
  };

  const pickObjectForPreset = (presetId: string, element: BoardElement) => {
    if (element.type === "layer" || element.type === "draw" || element.isEraser) {
      return;
    }
    const hierarchy=createElementHierarchy(elementsRef.current);
    const source=element.type==='group'?elementsRef.current.filter(item=>item.id===element.id||hierarchy.isDescendantOf(item.id,element.id)):[];
    const snapshot=source.length?cloneBoardDocument(source,sectionSheetsRef.current,generateId).elements:undefined;
    const snapshotRoot=snapshot?.[source.findIndex(item=>item.id===element.id)];
    setObjectPresets((prev) =>
      prev.map((preset) =>
        preset.id === presetId
          ? { ...preset, element: snapshotRoot??snapshotObjectForPreset(element),elements:snapshot }
          : preset,
      ),
    );
    setPickingObjectPresetId(null);
  };

  const getLayerPanelElements = (includePreview = true) => {
    const parentId = currentLayerView ?? undefined;
    const siblings = elements.filter(
      (element) =>
        !element.isEraser &&
        element.parentId === parentId &&
        (element.type !== "board" || !currentLayerView),
    );
    const sorted = siblings.sort((a, b) => {
      if (a.type === "board") return 1;
      if (b.type === "board") return -1;
      return b.zIndex - a.zIndex;
    });
    const preview = includePreview
      ? layerPreviewOrderRef.current ?? layerPreviewOrder
      : null;
    if (!preview) return sorted;
    const byId = new Map(sorted.map((element) => [element.id, element]));
    const previewElements = preview
      .map((id) => byId.get(id))
      .filter((element): element is BoardElement => Boolean(element));
    return previewElements.length === sorted.length ? previewElements : sorted;
  };

  const startLayerPreview = (draggedId: string) => {
    const panelElements = getLayerPanelElements();
    if (
      !panelElements.some((element) => element.id === draggedId) ||
      panelElements.find((element) => element.id === draggedId)?.type === "board"
    ) {
      return;
    }
    const order = panelElements.map((element) => element.id);
    layerPreviewOrderRef.current = order;
    setLayerPreviewOrder(order);
  };

  const previewLayerOrder = (
    targetId: string,
    placement: "before" | "after",
  ) => {
    const draggedId = draggedLayerIdRef.current;
    const current = layerPreviewOrderRef.current;
    if (!draggedId || !current || draggedId === targetId) return;
    const withoutDragged = current.filter((id) => id !== draggedId);
    const targetIndex = withoutDragged.indexOf(targetId);
    if (targetIndex < 0) return;
    const next = [...withoutDragged];
    next.splice(targetIndex + (placement === "after" ? 1 : 0), 0, draggedId);
    if (next.every((id, index) => id === current[index])) return;
    layerPreviewOrderRef.current = next;
    setLayerPreviewOrder(next);
  };

  const previewLayerOrderFromPointer = (
    event: React.DragEvent<HTMLElement>,
    target: BoardElement,
    force = false,
  ) => {
    const draggedId = draggedLayerIdRef.current;
    if (!draggedId || draggedId === target.id) return;

    const rect = event.currentTarget.getBoundingClientRect();
    const pointerRatio = rect.height > 0
      ? (event.clientY - rect.top) / rect.height
      : 0.5;
    const placement = target.type === "board"
      ? "before"
      : pointerRatio < 0.44
        ? "before"
        : pointerRatio > 0.56
          ? "after"
          : null;

    if (!placement) {
      if (layerReorderTimerRef.current !== null) {
        window.clearTimeout(layerReorderTimerRef.current);
        layerReorderTimerRef.current = null;
      }
      layerReorderPendingRef.current = null;
      setDragOverLayerId(null);
      setLayerDropTarget(null);
      return;
    }

    const key = `${placement}:${target.id}`;
    setDragOverLayerId(key);
    setLayerDropTarget(target.id);
    const pending = layerReorderPendingRef.current;

    if (force) {
      if (layerReorderTimerRef.current !== null) {
        window.clearTimeout(layerReorderTimerRef.current);
        layerReorderTimerRef.current = null;
      }
      previewLayerOrder(target.id, placement);
      layerReorderPendingRef.current = null;
      return;
    }

    if (pending?.key === key) return;

    if (layerReorderTimerRef.current !== null) {
      window.clearTimeout(layerReorderTimerRef.current);
    }
    layerReorderPendingRef.current = { key, since: performance.now() };
    layerReorderTimerRef.current = window.setTimeout(() => {
      if (layerReorderPendingRef.current?.key !== key) return;
      previewLayerOrder(target.id, placement);
      layerReorderPendingRef.current = null;
      layerReorderTimerRef.current = null;
    }, 180);
  };

  const cancelLayerReorderPending = () => {
    if (layerReorderTimerRef.current !== null) {
      window.clearTimeout(layerReorderTimerRef.current);
      layerReorderTimerRef.current = null;
    }
    layerReorderPendingRef.current = null;
    setDragOverLayerId(null);
    setLayerDropTarget(null);
  };

  const clearLayerPreview = () => {
    layerPreviewOrderRef.current = null;
    setLayerPreviewOrder(null);
    setDragOverLayerId(null);
    setLayerDropTarget(null);
    cancelLayerReorderPending();
    draggedLayerIdRef.current = null;
    setDraggingLayerId(null);
  };

  const commitLayerPreview = () => {
    const preview = layerPreviewOrderRef.current;
    const draggedId = draggedLayerIdRef.current;
    if (!preview || !draggedId) {
      clearLayerPreview();
      return;
    }
    const panelElements = getLayerPanelElements(false);
    const currentOrder = panelElements.map((element) => element.id);
    const changed = preview.some((id, index) => id !== currentOrder[index]);
    if (changed) {
      const zIndexes = new Map<string, number>();
      const movable = preview.filter(
        (id) => panelElements.find((element) => element.id === id)?.type !== "board",
      );
      const highestZ = Math.max(
        0,
        ...panelElements
          .filter((element) => element.type !== "board")
          .map((element) => element.zIndex),
      );
      movable.forEach((id, index) =>
        zIndexes.set(id, highestZ - index),
      );
      pushElements(
        elementsRef.current.map((element) =>
          zIndexes.has(element.id)
            ? { ...element, zIndex: zIndexes.get(element.id)! }
            : element,
        ),
      );
    }
    clearLayerPreview();
  };

  const collectEditorSettings = (overrides: {
    objectDefaults?: ObjectDefaults;
    pendingProps?: Partial<BoardElement>;
  } = {}): BoardEditorSettings => ({
    activeTool,
    customColors,
    pendingProps: overrides.pendingProps ?? pendingProps,
    alwaysOnTop,
    keepToolActive,
    keepToolActiveFallback,
    toolModeShortcut,
    gridToggleShortcut,
    overlapShortcut,
    cropShortcut,
    scrollZoomShortcut,
    zoomToCursor,
    keepBoardContentPosition,
    cutShortcut,
    proportionalScale,
    altResizeCrops,
    previewMode,
    toolMenuSettingsOverrides: toolSettingsOverrides,
    isSelectionLockEnabled,
    selectionLockTime,
    enableObjectSnapping,
    smartGuidesEnabled,
    autoSelectOnPlace,
    autoToolOnSelect,
    spinSnapEnabled,
    spinSnapDegrees,
    allowEditing,
    allowMovingElementsInPan,
    fillToolColor,
    eraserMode,
    eraserSize,
    eraserShape,
    scrollZoomSensitivity,
    clickZoomSensitivity,
    overlapMode,
    toolbarLayout,
    objectPresets,
    objectDefaults: overrides.objectDefaults ?? objectDefaultsRef.current,
  });

  const buildCurrentPage = (
    settingsOverrides: {
      objectDefaults?: ObjectDefaults;
      pendingProps?: Partial<BoardElement>;
    } = {},
  ): Page => {
    const syncedElements = syncLiveEditableState(
      readLiveWorkbookSnapshots(syncLiveWebviewState(elementsRef.current)),
    );
    let currentScrollX = containerRef.current?.scrollLeft;
    let currentScrollY = containerRef.current?.scrollTop;
    let viewportCenterX = currentScrollX !== undefined
      ? currentScrollX + (containerRef.current?.clientWidth ?? 0) / 2
      : undefined;
    let viewportCenterY = currentScrollY !== undefined
      ? currentScrollY + (containerRef.current?.clientHeight ?? 0) / 2
      : undefined;
    
    const editorSettings = collectEditorSettings(settingsOverrides);
    return {
      ...page,
      title,
      elements: syncedElements,
      sectionSheets: sectionSheetsRef.current,
      width: pageDimensions.width,
      height: pageDimensions.height,
      workspaceWidth: workspaceDimensions.width,
      workspaceHeight: workspaceDimensions.height,
      boardX: boardPosition.x,
      boardY: boardPosition.y,
      showGrid,
      snapToGrid,
      showWorkspaceGrid,
      gridColor,
      boardColor,
      gridThickness,
      gridSize,
      workspaceGridColor,
      workspaceGridThickness,
      workspaceGridSize,
      zoom,
      scrollX: currentScrollX,
      scrollY: currentScrollY,
      viewportCenterX,
      viewportCenterY,
      editorSettings,
      updatedAt: Date.now(),
    };
  };

  const doSave = (
    options: { keepalive?: boolean } = {},
  ) => {
    onSave(buildCurrentPage(), options);
  };

  const handleSaveAs = async (kind: SaveAsKind, name: string): Promise<string> => {
    const snapshot = buildCurrentPage();
    if (kind === 'template') {
      if (await onSavePreset(createSavedTemplate(snapshot, name)) === false) throw new Error('Could not save the template. Please try again.');
      return 'Template saved.';
    }
    if (kind === 'board') {
      if (!onSaveAs) throw new Error('Saving a new board is unavailable.');
      if (await onSaveAs(createSavedBoard(snapshot, name)) === false) throw new Error('Could not save the new board. Please try again.');
      return 'New board saved in My Noteboards.';
    }
    await downloadBoardArchive({ ...snapshot, title: name }, name);
    return 'File download started.';
  };

  const handleConfirmPresetSave = () => {
    onSavePreset({
      id: `preset-${generateId()}`,
      name: presetName || "Custom Preset",
      description: "Custom preset created from page.",
      icon: "LayoutGrid",
      elements: presetContentChecked
        ? structuredClone(elements)
        : [],
      sectionSheets: presetContentChecked
        ? structuredClone(sectionSheets)
        : [],
      width: presetSettingsChecked ? pageDimensions.width : undefined,
      height: presetSettingsChecked ? pageDimensions.height : undefined,
      workspaceWidth: presetSettingsChecked
        ? workspaceDimensions.width
        : undefined,
      workspaceHeight: presetSettingsChecked
        ? workspaceDimensions.height
        : undefined,
      showGrid: presetSettingsChecked ? showGrid : undefined,
      snapToGrid: presetSettingsChecked ? snapToGrid : undefined,
      showWorkspaceGrid: presetSettingsChecked ? showWorkspaceGrid : undefined,
      gridColor: presetSettingsChecked ? gridColor : undefined,
      boardColor: presetSettingsChecked ? boardColor : undefined,
      gridThickness: presetSettingsChecked ? gridThickness : undefined,
      gridSize: presetSettingsChecked ? gridSize : undefined,
      workspaceGridColor: presetSettingsChecked ? workspaceGridColor : undefined,
      workspaceGridThickness: presetSettingsChecked ? workspaceGridThickness : undefined,
      workspaceGridSize: presetSettingsChecked ? workspaceGridSize : undefined,
      editorSettings: presetSettingsChecked
        ? collectEditorSettings()
        : undefined,
      brightness: undefined,
      isBuiltIn: false,
    });
    setShowSaveModal(false);
  };

  const selectedElement = elements.find((el) => el.id === selectedId);

  const jumpToElement = (id: string) => {
    if (id.startsWith("http://") || id.startsWith("https://")) {
      window.open(id, "_blank", "noopener,noreferrer");
      return;
    }
    const el = elements.find((e) => e.id === id);
    if (!el || !containerRef.current || !boardSurfaceRef.current) return;

    // Find absolute coordinates. We should scroll the container to center on this element.
    const containerRect = containerRef.current.getBoundingClientRect();

    // The element's center relative to board surface top-left, scaled by zoom
    const elCenterX = (el.position.x + (el.size?.width || 100) / 2) * zoom;
    const elCenterY = (el.position.y + (el.size?.height || 40) / 2) * zoom;

    // container's current scroll offsets
    const scrollX =
      elCenterX - containerRect.width / 2 + (boardPosition.x || 0);
    const scrollY =
      elCenterY - containerRect.height / 2 + (boardPosition.y || 48);

    containerRef.current.scrollTo({
      left: scrollX,
      top: scrollY,
      behavior: "smooth",
    });

    setSelectedId(id);
  };

  const handlePointerDown = (e: React.PointerEvent) => {
    if(activeTool==='eyedropper'){e.preventDefault();e.stopPropagation();if(e.button===0)void sampleColor(e.clientX,e.clientY);return;}
    if(activeTool==='crop'){e.preventDefault();return;}
    if(outlineSelection.begin(e)){setQuickAddRegion(null);setIsMainBoardSelected(false);closeAllDropdowns();return;}
    if (
      activePointerIdRef.current !== null &&
      activePointerIdRef.current !== e.pointerId
    ) {
      return;
    }
    if ((window as any).justLinkedElement) {
      // Allow drop-down states to clear, but do not change selection
      (window as any).justLinkedElement = false;
      return;
    }
    if (e.button === 0) {
      e.preventDefault();boardSurfaceRef.current?.focus({preventScroll:true});
      setSavedRange(null);window.getSelection()?.removeAllRanges();
    }
    pointerDownTime.current = Date.now();
    setContextMenuPos(null);
    setQuickAddRegion(null);
    if (activeTool === "pan") {
      closeAllDropdowns();
      captureSurfacePointer(e);
      setIsInteracting(true);
      setPanStart({ x: e.clientX, y: e.clientY });
      activeSurfaceBoundsRef.current = null;
      return;
    }

    const target = e.target as HTMLElement;
    const targetId = target.id;
    const rect = boardSurfaceRef.current!.getBoundingClientRect();
    const exactX = (e.clientX - rect.left) / zoom;
    const exactY = (e.clientY - rect.top) / zoom;
    const pointerPoint = { x: exactX, y: exactY };
    const interactionBounds = getInteractionBoundsAtPoint(pointerPoint);
    const isElementTarget = !!target.closest?.('[data-board-element="true"]');
    const secondaryBoardSurface = target.closest?.(
      '[data-board-element="true"][data-board-surface="true"]',
    );
    const isBoardSurface = isBoardPlacementSurface({
      hasBoardSurfaceMarker:
        targetId === "main-board" ||
        target === boardSurfaceRef.current ||
        target.dataset.boardSurface === "true" ||
        !!target.closest?.('[data-board-surface="true"]'),
      isElementTarget,
      isSecondaryBoardSurface: Boolean(secondaryBoardSurface),
    });
    closeAllDropdowns({
      preservePresetPicking: shouldPreservePresetPicking({
        hasActivePreset: Boolean(pickingObjectPresetId),
        isPrimaryPointer: e.button === 0,
        isElementTarget,
      }),
    });
    setIsMainBoardSelected(isBoardSurface && !secondaryBoardSurface);

    if (activeTool === "board") {
      activeSurfaceBoundsRef.current = null;
      return;
    }

    if (activeTool === "zoom") {
      activeSurfaceBoundsRef.current = null;
      const zoomStep = 0.5 * clickZoomSensitivity;
      if (e.button === 0) { // left click
         zoomAtPoint(zoomStep, e.clientX, e.clientY);
      } else if (e.button === 2) { // right click
         zoomAtPoint(-zoomStep, e.clientX, e.clientY);
      }
      return;
    }

    if (e.button === 2) {
      activeSurfaceBoundsRef.current = null;
      // Right click: verify if we hit any element based on coordinates to show its context menu
      const el = elements
        .slice()
        .reverse()
        .find((el) => {
          const ew = el.size?.width || 100;
          const eh = el.size?.height || 40;
          return (
            exactX >= el.position.x &&
            exactX <= el.position.x + ew &&
            exactY >= el.position.y &&
            exactY <= el.position.y + eh
          );
        });
      if (el) {
        setSelectedId(el.id);
        setContextMenuPos({ x: e.clientX, y: e.clientY });
      }
      return;
    }

    // Only capture on the board surface or main board for other tools
    if (!isBoardSurface || !interactionBounds) return;
    activeSurfaceBoundsRef.current = interactionBounds;
    // Keep the active gesture alive when the pointer crosses the board edge.
    // Without capture, Select receives a synthetic pointer-up/leave and the
    // marquee becomes a small stale region instead of following the pointer.
    captureSurfacePointer(e);

    if (activeTool === "link") {
      if (!getEffectiveToolMenuSettings("link").alwaysOnTop) {
        setSelectedId(null);
      }
      return;
    }

    setSelectedId(null);

    if (activeTool === "eraser") {
      setIsInteracting(true);
      beginAreaGesture({ x: exactX, y: exactY }, e.pointerId, activeTool);
      if (eraserMode === 'partial') {
         setCurrentDrawPoints([{ x: exactX, y: exactY }]);
      } else {
         // Delete any element under cursor immediately
         const el = elements
           .slice()
           .reverse()
           .find((el) => {
             if (el.type === "board" || el.type === "layer" || elementHierarchy.isLocked(el.id) || !elementHierarchy.isVisible(el.id, respectLayerVisibility)) return false;
             const ew = el.size?.width || 100;
             const eh = el.size?.height || 40;
             return (
               exactX >= el.position.x &&
               exactX <= el.position.x + ew &&
               exactY >= el.position.y &&
               exactY <= el.position.y + eh
             );
           });
         if (el) removeElement(el.id);
      }
      return;
    }

    if (activeTool === "fill") {
      setIsInteracting(true);
      beginAreaGesture({ x: exactX, y: exactY }, e.pointerId, activeTool);
      applyFillAtPoint({ x: exactX, y: exactY });
      return;
    }

    if (activeTool === "draw") {
      setIsInteracting(true);
      beginAreaGesture({ x: exactX, y: exactY }, e.pointerId, activeTool);
      setCurrentDrawPoints([{ x: exactX, y: exactY }]);
      return;
    }

    // Select uses the actual pointer coordinates. Snapping its marquee to the
    // grid made upper-left drags jump sides and could lose a fast gesture.
    const x = activeTool === "select" ? exactX : snap(exactX);
    const y = activeTool === "select" ? exactY : snap(exactY);
    const snappedPoint = clampPointToBounds({ x, y }, interactionBounds);

    beginAreaGesture(snappedPoint, e.pointerId, activeTool);
    setIsInteracting(true);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if(groupMoveRef.current){moveSelection(e);return;}
    if(outlineSelection.move(e))return;
    const activeAreaGesture = areaGestureRef.current;
    if (
      activePointerIdRef.current !== null &&
      activePointerIdRef.current !== e.pointerId
    ) {
      return;
    }
    if (
      activeAreaGesture &&
      activeAreaGesture.pointerId !== e.pointerId
    ) {
      return;
    }

    if (panStart && containerRef.current) {
      const dx = e.clientX - panStart.x;
      const dy = e.clientY - panStart.y;
      containerRef.current.scrollBy(-dx, -dy);
      setPanStart({ x: e.clientX, y: e.clientY });
      return;
    }

    if (activeTool === "eraser" && activeAreaGesture && boardSurfaceRef.current) {
      const rect = boardSurfaceRef.current.getBoundingClientRect();
      const exactX = (e.clientX - rect.left) / zoom;
      const exactY = (e.clientY - rect.top) / zoom;
      const bounds =
        activeSurfaceBoundsRef.current ??
        getInteractionBoundsAtPoint(activeAreaGesture.start);
      if (!bounds || !isPointInsideBounds({ x: exactX, y: exactY }, bounds)) {
        handlePointerUp(e);
        return;
      }
      
      if (eraserMode === 'partial' && currentDrawPoints) {
         setCurrentDrawPoints([...currentDrawPoints, { x: exactX, y: exactY }]);
      } else if (eraserMode === 'element') {
         // Eraser deletes elements under cursor continuously when dragging
         const el = elements
           .slice()
           .reverse()
           .find((el) => {
             if (el.type === "board" || el.type === "layer" || elementHierarchy.isLocked(el.id) || !elementHierarchy.isVisible(el.id, respectLayerVisibility)) return false;
             const ew = el.size?.width || 100;
             const eh = el.size?.height || 40;
             return (
               exactX >= el.position.x &&
               exactX <= el.position.x + ew &&
               exactY >= el.position.y &&
               exactY <= el.position.y + eh
             );
           });
         if (el) removeElement(el.id);
      }
      return;
    }

    if (activeTool === "fill" && activeAreaGesture && boardSurfaceRef.current) {
      const rect = boardSurfaceRef.current.getBoundingClientRect();
      const exactX = (e.clientX - rect.left) / zoom;
      const exactY = (e.clientY - rect.top) / zoom;
      const bounds =
        activeSurfaceBoundsRef.current ??
        getInteractionBoundsAtPoint(activeAreaGesture.start);
      if (bounds && isPointInsideBounds({ x: exactX, y: exactY }, bounds)) {
        applyFillAtPoint({ x: exactX, y: exactY });
      }
      return;
    }

    if (activeTool === "draw" && currentDrawPoints && activeAreaGesture && boardSurfaceRef.current) {
      const rect = boardSurfaceRef.current.getBoundingClientRect();
      const x = (e.clientX - rect.left) / zoom;
      const y = (e.clientY - rect.top) / zoom;
      const bounds =
        activeSurfaceBoundsRef.current ??
        getInteractionBoundsAtPoint(activeAreaGesture.start);

      if (!bounds || !isPointInsideBounds({ x, y }, bounds)) {
        handlePointerUp(e);
        return;
      }

      setCurrentDrawPoints([...currentDrawPoints, { x, y }]);
      return;
    }

    if (resizeMode && boardResizeStartRef.current) {
      setIsInteracting(true);
      const start = boardResizeStartRef.current;
      const dx = (e.clientX - start.clientX) / zoom;
      const dy = (e.clientY - start.clientY) / zoom;
      const next=resizeMainBoard({start:{size:{width:start.width,height:start.height},position:{x:start.boardX,y:start.boardY}},elements:start.elements,members:start.members,mode:resizeMode,dx,dy,zoom,keepContent:start.keepContent,snap});
      start.changed=next.geometry.size.width!==start.width||next.geometry.size.height!==start.height;
      applyMainBoardGeometry(next.geometry);elementsRef.current=next.elements;setElements(next.elements);
      return;
    }

    if (isBoardMoveEnabled && boardDragStart) {
      const dx = (e.clientX - boardDragStart.x) / zoom;
      const dy = (e.clientY - boardDragStart.y) / zoom;
      setBoardPosition({
        x: boardDragStart.startBx + dx,
        y: boardDragStart.startBy + dy,
      });
      return;
    }

    if (activeAreaGesture && boardSurfaceRef.current) {
      const rect = boardSurfaceRef.current.getBoundingClientRect();
      let cx = (e.clientX - rect.left) / zoom;
      let cy = (e.clientY - rect.top) / zoom;
      const bounds =
        activeSurfaceBoundsRef.current ??
        getInteractionBoundsAtPoint(activeAreaGesture.start);

      if (activeTool !== "pan" && activeTool !== "board") {
        const isSelectDrag = activeTool === "select";
        if (!bounds || (!isSelectDrag && !isPointInsideBounds({ x: cx, y: cy }, bounds))) {
          if (activeTool === "media" || activeTool === "embed") {
            cancelAreaPlacementDrag();
            return;
          }
          handlePointerUp(e);
          return;
        }
        if (isSelectDrag && bounds) {
          // A Select marquee remains active at the board edge. This is
          // especially important for upper-left drags, where both axes can
          // leave the surface during one gesture.
          const clamped = clampPointToBounds({ x: cx, y: cy }, bounds);
          cx = clamped.x;
          cy = clamped.y;
        }
      }

      // Proportional shape (square) if shift logic or toggle is on
      if (proportionalScale && activeTool !== "select") {
        const dx = cx - activeAreaGesture.start.x;
        const dy = cy - activeAreaGesture.start.y;
        const max = Math.max(Math.abs(dx), Math.abs(dy));
        cx = activeAreaGesture.start.x + Math.sign(dx) * max;
        cy = activeAreaGesture.start.y + Math.sign(dy) * max;
      }

      const nextPoint =
        activeTool === "select"
          ? bounds
            ? clampPointToBounds({ x: cx, y: cy }, bounds)
            : { x: cx, y: cy }
          : bounds
            ? clampPointToBounds({ x: snap(cx), y: snap(cy) }, bounds)
            : { x: snap(cx), y: snap(cy) };
      updateAreaGesture(nextPoint);
    }
  };

  const saveLatestRef = useRef(doSave);
  saveLatestRef.current = doSave;
  useEffect(() => {
    const flushLatestDocument = () => saveLatestRef.current({ keepalive: true });
    window.addEventListener("pagehide", flushLatestDocument);
    window.addEventListener("beforeunload", flushLatestDocument);
    return () => {
      window.removeEventListener("pagehide", flushLatestDocument);
      window.removeEventListener("beforeunload", flushLatestDocument);
    };
  }, []);

  const handlePointerUp = (event?: React.PointerEvent | PointerEvent) => {
    const capturedPointerId = activePointerIdRef.current;
    const captureTarget = pointerCaptureTargetRef.current;
    const eventPointerId = event?.pointerId;
    if (
      capturedPointerId !== null &&
      eventPointerId !== undefined &&
      eventPointerId !== capturedPointerId
    ) {
      return;
    }
    const activeAreaGesture = areaGestureRef.current;
    if (
      activeAreaGesture &&
      eventPointerId !== undefined &&
      eventPointerId !== activeAreaGesture.pointerId
    ) {
      return;
    }
    try {
      if (
        captureTarget &&
        capturedPointerId !== null &&
        captureTarget.hasPointerCapture?.(capturedPointerId)
      ) {
        captureTarget.releasePointerCapture?.(capturedPointerId);
      }
    } catch {
      // Browsers may revoke capture immediately before pointerup.
    }
    activePointerIdRef.current = null;
    pointerCaptureTargetRef.current = null;
    if(groupMoveRef.current){
      if(event&&'clientX' in event)moveSelection(event);
      const moved=groupMoveRef.current;groupMoveRef.current=null;
      if(selectionOutlineRef.current){selectionOutlineRef.current.style.transform='';selectionOutlineRef.current.style.backgroundColor='';}
      if(moved.changed&&moved.latest)pushElements(moved.latest);
      setIsInteracting(false);setVisibleGuides([]);return;
    }
    if(outlineSelection.end(event))return;
    const latestElements = elementsRef.current;
    const activeBounds =
      activeSurfaceBoundsRef.current ??
      (activeAreaGesture
        ? getInteractionBoundsAtPoint(activeAreaGesture.start)
        : null);
    const activeDragStart = activeAreaGesture?.start ?? dragStart;
    const activeDragCurrent = activeAreaGesture?.current ?? dragCurrent;

    const getSnapPoint = (px: number, py: number, threshold = 30) => {
      if (!enableObjectSnapping) return { x: px, y: py };
      let bestDist = threshold;
      let bestPt = { x: px, y: py };
      for (const el of latestElements) {
        if (el.type === "layer" || el.type === "draw") continue;
        const ex = el.position.x;
        const ey = el.position.y;
        const ew = el.size?.width || 0;
        const eh = el.size?.height || 0;
        const pts = [
          { x: ex, y: ey },
          { x: ex + ew, y: ey },
          { x: ex, y: ey + eh },
          { x: ex + ew, y: ey + eh },
          { x: ex + ew / 2, y: ey },
          { x: ex + ew / 2, y: ey + eh },
          { x: ex, y: ey + eh / 2 },
          { x: ex + ew, y: ey + eh / 2 },
          { x: ex + ew / 2, y: ey + eh / 2 },
        ];
        for (const pt of pts) {
          const d = Math.hypot(pt.x - px, pt.y - py);
          if (d < bestDist) {
            bestDist = d;
            bestPt = { ...pt }; // copy object
          }
        }
      }
      return bestPt;
    };

    if (panStart) {
      setPanStart(null);
      setIsInteracting(false);
      activeSurfaceBoundsRef.current = null;
      return;
    }

    if (activeTool === "eraser") {
      if (eraserMode === 'partial' && currentDrawPoints && currentDrawPoints.length > 0) {
        const minX = Math.min(...currentDrawPoints.map((p) => p.x));
        const minY = Math.min(...currentDrawPoints.map((p) => p.y));
        const normalizedPoints = currentDrawPoints.map((p) => ({
          x: p.x - minX,
          y: p.y - minY,
        }));
        const newElement = {
          id: generateId(),
          type: "draw",
          position: { x: minX, y: minY },
          size: {
            width: Math.max(...currentDrawPoints.map((p) => p.x)) - minX,
            height: Math.max(...currentDrawPoints.map((p) => p.y)) - minY,
          },
          points: normalizedPoints,
          color: "#ffffff", // color doesn't matter for mask, but stroke will be black in mask
          borderColor: "#000000",
          borderWidth: eraserSize,
          isEraser: true,
          eraserShape: eraserShape,
          zIndex: latestElements.length + 1,
          parentId: currentLayerView || undefined,
        };
        pushElements([...latestElements, newElement]);
        setCurrentDrawPoints(null);
      }
      clearAreaGesture();
      setIsInteracting(false);
      activeSurfaceBoundsRef.current = null;
      finishToolUse("eraser");
      return;
    }

    if (activeTool === "fill") {
      clearAreaGesture();
      setIsInteracting(false);
      activeSurfaceBoundsRef.current = null;
      finishToolUse("fill");
      return;
    }

    if (activeTool === "draw") {
      if (currentDrawPoints && currentDrawPoints.length > 1) {
        let xs = currentDrawPoints.map((p) => p.x);
        let ys = currentDrawPoints.map((p) => p.y);
        let minX = Math.min(...xs);
        let minY = Math.min(...ys);
        let maxX = Math.max(...xs);
        let maxY = Math.max(...ys);

        let newPoints = currentDrawPoints;
        let drawnType: ElementType = "draw";
        let smooth =
          pendingProps.isSmooth && pendingProps.drawingAssistSmooth !== false;

        // Guesser algorithm
        if (
          pendingProps.isSmooth &&
          pendingProps.drawingAssistGuess === true &&
          currentDrawPoints.length > 5
        ) {
          const w = maxX - minX;
          const h = maxY - minY;
          const maxDim = Math.max(w, h);

          const start = currentDrawPoints[0];
          const end = currentDrawPoints[currentDrawPoints.length - 1];
          const distStartEnd = Math.hypot(start.x - end.x, start.y - end.y);
          const isClosed = distStartEnd < maxDim * 0.25;

          let cx = (minX + maxX) / 2;
          let cy = (minY + maxY) / 2;
          let avgR = (w + h) / 4;
          let varR = 0;
          currentDrawPoints.forEach((p) => {
            let r = Math.hypot(p.x - cx, p.y - cy);
            varR += Math.abs(r - avgR);
          });
          varR /= Math.max(1, currentDrawPoints.length);

          // If it closely resembles a circle/ellipse, map to ellipse element
          if (isClosed && varR < avgR * 0.22 && currentDrawPoints.length > 10) {
            drawnType = "ellipse";
          } else {
            // Adaptive shape guessing via Ramer-Douglas-Peucker
            // This natively handles lines, triangles, squares, pentagons, stars, etc. perfectly
            const strength = pendingProps.drawingAssistStrength ?? 5; // 1 to 10
            const epsilon = Math.max(
              maxDim * (0.15 - (strength - 1) * 0.015),
              2,
            );
            let simplified = douglasPeucker(currentDrawPoints, epsilon);

            // If it's intended to be a closed shape, seal the polygon beautifully
            if (isClosed && simplified.length > 2) {
              simplified[simplified.length - 1] = { ...simplified[0] };
            } else if (!isClosed && maxDim > 20) {
              // Try to snap endpoints
              const startSnap = getSnapPoint(
                simplified[0].x,
                simplified[0].y,
                35,
              );
              const endSnap = getSnapPoint(
                simplified[simplified.length - 1].x,
                simplified[simplified.length - 1].y,
                35,
              );
              simplified[0] = startSnap;
              simplified[simplified.length - 1] = endSnap;
            }

            newPoints = simplified;
            drawnType = "draw";
            // Sharp corners for guessed shapes
            smooth = false;
          }
        }

        // If guesser decided on a shape, we don't need points except for custom drawn lines
        if (drawnType !== "draw") {
          const newElement: BoardElement = {
            id: generateId(),
            type: drawnType,
            parentId: creationParentId(currentDrawPoints[0]),
            position: { x: minX, y: minY },
            size: {
              width: Math.max(10, maxX - minX),
              height: Math.max(10, maxY - minY),
            },
            content: "",
            borderColor: pendingProps.borderColor || "#000000",
            borderWidth: pendingProps.borderWidth || 4,
            color: pendingProps.color || "transparent",
            zIndex: latestElements.length + 1,
          };
          pushElements([...latestElements, newElement]);
          setCurrentDrawPoints(null);
          clearAreaGesture();
          setIsInteracting(false);
          activeSurfaceBoundsRef.current = null;
          finishToolUse("draw");
          return;
        }

        let finalMinX = minX;
        let finalMinY = minY;

        if (drawnType === "draw") {
          const finalXs = newPoints.map((p) => p.x);
          const finalYs = newPoints.map((p) => p.y);
          finalMinX = Math.min(...finalXs);
          finalMinY = Math.min(...finalYs);
        }

        const normalizedPoints = newPoints.map((p) => ({
          x: p.x - finalMinX,
          y: p.y - finalMinY,
        }));

        const newElement: BoardElement = {
          id: generateId(),
          type: drawnType,
          parentId: creationParentId(currentDrawPoints[0]),
          position: { x: finalMinX, y: finalMinY },
          size: {
            width: Math.max(1, maxX - finalMinX),
            height: Math.max(1, maxY - finalMinY),
          },
          content: "",
          color: pendingProps.color || "transparent",
          points: normalizedPoints,
          isSmooth: smooth,
          drawingAssistSmoothStrength:
            pendingProps.drawingAssistSmoothStrength ?? 5,
          borderColor: pendingProps.borderColor || "#000000",
          borderWidth: pendingProps.borderWidth || 4,
          zIndex: latestElements.length + 1,
        };
        pushElements([...latestElements, newElement]);
      }
      setCurrentDrawPoints(null);
      clearAreaGesture();
      setIsInteracting(false);
      activeSurfaceBoundsRef.current = null;
      finishToolUse("draw");
      return;
    }

    if(resizeMode && boardResizeStartRef.current?.changed) pushDocument(elementsRef.current);
    if (resizeMode || isBoardMoveEnabled) {
      setResizeMode(null);
      boardResizeStartRef.current = null;
      setBoardDragStart(null);
      setIsInteracting(false);
    } else {
      setResizeMode(null);
      boardResizeStartRef.current = null;
      setIsInteracting(false);
    }

    if (activeDragStart && activeDragCurrent) {
      if (
        activeTool !== "select" && usesAreaPlacement(activeTool) &&
        !hasMeaningfulAreaDrag(activeDragStart, activeDragCurrent)
      ) {
        cancelAreaPlacementDrag();
        return;
      }

      if (
        activeTool !== "pan" &&
        activeTool !== "eraser" &&
        activeTool !== "draw"
      ) {
        const isWaitingForSelectionLock =
          usesAreaPlacement(activeTool) &&
          isSelectionLockEnabled &&
          activeAreaGesture?.activated === false;
        if (isWaitingForSelectionLock) {
          // If clicking on an element with select tool, let it be handled by element's onClick
          if (
            activeTool === "select" &&
            activeDragStart.x === activeDragCurrent.x &&
            activeDragStart.y === activeDragCurrent.y
          ) {
            // Do nothing, let it fall through to clear
          } else {
            clearAreaGesture();
            activeSurfaceBoundsRef.current = null;
            return;
          }
        }
      }

      const snappedStart =
        activeTool !== "select" &&
        activeTool !== "pan" &&
        activeTool !== "eraser" &&
        activeTool !== "draw"
          ? snapToGrid && (activeTool === "line" || activeTool === "arrow")
            ? activeDragStart
            : getSnapPoint(
              activeDragStart.x,
              activeDragStart.y,
              activeTool === "line" || activeTool === "arrow" ? 8 : 30,
            )
          : activeDragStart;
      const snappedCurrent =
        activeTool !== "select" &&
        activeTool !== "pan" &&
        activeTool !== "eraser" &&
        activeTool !== "draw"
          ? snapToGrid && (activeTool === "line" || activeTool === "arrow")
            ? activeDragCurrent
            : getSnapPoint(
              activeDragCurrent.x,
              activeDragCurrent.y,
              activeTool === "line" || activeTool === "arrow" ? 8 : 30,
            )
          : activeDragCurrent;

      if (activeTool === "arrow" || activeTool === "line") {
        const dx = snappedCurrent.x - snappedStart.x;
        const dy = snappedCurrent.y - snappedStart.y;
        const rawDistance = Math.sqrt(dx * dx + dy * dy);

        let distance = Math.max(rawDistance, gridSize);
        let angle = Math.atan2(dy, dx) * (180 / Math.PI);
        if (snapToGrid) {
          angle = Math.round(angle / 45) * 45;
          distance = Math.max(
            gridSize,
            Math.round(distance / gridSize) * gridSize,
          );
        }

        const rad = angle * (Math.PI / 180);
        const endX = snappedStart.x + Math.cos(rad) * distance;
        const endY = snappedStart.y + Math.sin(rad) * distance;
        let cx = (snappedStart.x + endX) / 2;
        let cy = (snappedStart.y + endY) / 2;

        handleAddRegionElement(
          activeTool as ElementType,
          {
            x: cx - distance / 2,
            y: cy - 20,
            w: distance,
            h: 40,
          },
          { rotation: Math.round(angle) },
        );
      } else {
        const clipped = getClippedRect(
          overlapMode,
            activeTool as string,
            snappedStart,
            snappedCurrent,
            latestElements,
            gridSize,
            pageDimensions,
            activeBounds ?? undefined,
        );

        if (clipped) {
          if (
            activeTool &&
            activeTool !== "select" &&
            activeTool !== "pan"
          ) {
            handleAddRegionElement(
              activeTool as ElementType,
              {
                x: clipped.x,
                y: clipped.y,
                w: clipped.w,
                h: clipped.h,
              },
              activeTool === "media"
                ? {
                    mediaKind: "media",
                    color: "#f8fafc",
                    keepRatio: true,
                  }
                : activeTool === "embed"
                  ? {
                      ...getWebElementDefaults(pendingProps),
                      mediaKind: "web",
                      color: "#f8fafc",
                    }
                : undefined,
            );
          } else if (activeTool === "select") {
            const selectionRect = getMinimumAreaRect(
              snappedStart,
              snappedCurrent,
              gridSize,
              activeBounds ?? undefined,
            );
            const intersecting = latestElements.filter((el) => {
              const ew = el.size?.width || 100;
              const eh = el.size?.height || 40;
              return !(
                el.position.x > clipped.x + clipped.w ||
                el.position.x + ew < clipped.x ||
                el.position.y > clipped.y + clipped.h ||
                el.position.y + eh < clipped.y
              );
            });

            if (
              intersecting.length > 0 &&
              clipped.w < gridSize &&
              clipped.h < gridSize
            ) {
              const topMost = intersecting.sort(
                (a, b) => b.zIndex - a.zIndex,
              )[0];
              setSelectedId(topMost.id);
            } else if (
              clipped.w > 5 ||
              clipped.h > 5 ||
              !isSelectionLockEnabled ||
              Date.now() - pointerDownTime.current >= selectionLockTime
            ) {
              setQuickAddRegion({
                x: selectionRect.x,
                y: selectionRect.y,
                w: selectionRect.w,
                h: selectionRect.h,
              });
            }
          } else if (activeTool === "pan" && (clipped.w > 0 || clipped.h > 0)) {
            setQuickAddRegion({
              x: clipped.x,
              y: clipped.y,
              w: clipped.w,
              h: clipped.h,
            });
          }
        }
      }

      clearAreaGesture();
      activeSurfaceBoundsRef.current = null;
    }
  };

  const handlePointerCancel = (event: React.PointerEvent | PointerEvent) => {
    const pointerId = activePointerIdRef.current;
    if (pointerId === null || event.pointerId !== pointerId) return;
    const captureTarget = pointerCaptureTargetRef.current;
    try {
      if (captureTarget?.hasPointerCapture?.(pointerId)) {
        captureTarget.releasePointerCapture(pointerId);
      }
    } catch {
      // Native cancellation may already have released capture.
    }
    activePointerIdRef.current = null;
    pointerCaptureTargetRef.current = null;
    areaGestureRef.current = null;
    activeSurfaceBoundsRef.current = null;
    outlineSelection.cancel();
    setVisibleGuides([]);
    if(groupMoveRef.current){elementsRef.current=groupMoveRef.current.elements;setElements(groupMoveRef.current.elements);groupMoveRef.current=null;}
    if(selectionOutlineRef.current){selectionOutlineRef.current.style.transform='';selectionOutlineRef.current.style.backgroundColor='';}
    const cancelledResize=boardResizeStartRef.current;
    if(cancelledResize){
      elementsRef.current=cancelledResize.elements;setElements(cancelledResize.elements);
      applyMainBoardGeometry({size:{width:cancelledResize.width,height:cancelledResize.height},position:{x:cancelledResize.boardX,y:cancelledResize.boardY}});
    }
    boardResizeStartRef.current = null;
    setDragStart(null);
    setDragCurrent(null);
    setCurrentDrawPoints(null);
    setPanStart(null);
    setResizeMode(null);
    setBoardDragStart(null);
    setIsHoldingToCreate(false);
    setIsInteracting(false);
  };

  const sampleColor=async(x:number,y:number)=>{
    try {
      setSamplingError('');
      let color:string;
      if(window.noteboardAPI?.sampleBoardColor)color=await window.noteboardAPI.sampleBoardColor({x,y});
      else {
        const Picker=(window as any).EyeDropper;
        if(!Picker)throw Error('Color sampling is available in the desktop app and browsers with an eyedropper.');
        color=(await new Picker().open()).sRGBHex;
      }
      if(!/^#[a-f0-9]{6}$/i.test(color))throw Error('Could not read the selected color.');
      setSampledColor(color);
      const property=eyedropperTarget==='fill'?'color':eyedropperTarget==='stroke'?'borderColor':'textColor';
      setPendingProps(current=>({...current,[property]:color}));
      const selected=elementsRef.current.find(element=>element.id===selectedId);
      if(selected&&elementColors(selected.type)[eyedropperTarget]){
        if(eyedropperTarget==='text')changeTextColor(color);else updateElement(selected.id,{[property]:color});
      }
      finishToolUse('eyedropper');
    }catch(error){if((error as any)?.name!=='AbortError')setSamplingError((error as any)?.message||'Could not read the selected color.');}
  };
  const updateSmartGuides=(element:BoardElement,position:{x:number;y:number},allowSnap=true,excludedIds?:Set<string>)=>{
    if(!smartGuidesEnabled)return position;
    const others=elementsRef.current.filter(other=>!excludedIds?.has(other.id)&&!elementHierarchy.isDescendantOf(other.id,element.id)&&elementHierarchy.isVisible(other.id,respectLayerVisibility));
    const result=smartGuides(element,position,[mainSurface,...others],zoomRef.current,allowSnap&&enableObjectSnapping);
    setVisibleGuides(result.guides);return result.position;
  };
  const outlineSelection=useOutlineSelection({tool:activeTool,zoom,surface:boardSurfaceRef,elements,selectedIds,onSelect:ids=>{setSelectedIds(ids);finishToolUse(activeTool);},respectVisibility:respectLayerVisibility,capture:captureSurfacePointer,onInteraction:setIsInteracting});
  const selectionBounds=selectedIds.length>1?selectedBounds(elements,selectedIds):null;
  const selectionTreeIds=()=>{
    const result=new Set(selectedIds);
    for(const element of elementsRef.current){let id=element.parentId;const seen=new Set<string>();while(id&&!seen.has(id)){seen.add(id);if(result.has(id)){result.add(element.id);break;}id=elementHierarchy.byId.get(id)?.parentId;}}
    return result;
  };
  const removeSelection=()=>{
    let next=elementsRef.current;
    selectedIds.forEach(id=>{next=removeElementTreeAndReferences(next,id).elements;});
    pushElements(next);setSelectedIds([]);
  };
  const duplicateSelection=()=>{
    const ids=selectionTreeIds(),source=elementsRef.current.filter(element=>ids.has(element.id));
    const cloned=cloneElementsWithOffset(source);
    const hierarchy=createElementHierarchy(cloned);
    pushElements([...elementsRef.current,...cloned]);setSelectedIds(cloned.filter(element=>element.type!=='layer'&&!isMergedGroupMember(element,hierarchy)).map(element=>element.id));
  };
  const startSelectionMove=(event:React.PointerEvent)=>{
    if(activeTool!=='select'||selectedIds.length<2||event.button!==0)return;
    const target=event.target as HTMLElement;
    if(target.closest('button,input,textarea,dialog'))return;
    const id=target.closest<HTMLElement>('[data-board-element-id]')?.dataset.boardElementId;
    if(!id||!selectedIds.includes(id))return;
    event.preventDefault();event.stopPropagation();window.getSelection()?.removeAllRanges();
    groupMoveRef.current={pointerId:event.pointerId,x:event.clientX,y:event.clientY,elements:elementsRef.current,ids:selectionTreeIds(),changed:false,preview:getEffectiveToolMenuSettings('select').previewMode};
    captureSurfacePointer(event);setIsInteracting(true);
  };
  const moveSelection=(event:{pointerId:number;clientX:number;clientY:number})=>{
    const start=groupMoveRef.current;if(!start||event.pointerId!==start.pointerId)return;
    let dx=snap((event.clientX-start.x)/zoomRef.current),dy=snap((event.clientY-start.y)/zoomRef.current);
    if(!start.changed&&Math.hypot(dx,dy)*zoomRef.current<2)return;
    start.changed=true;
    const bounds=selectedBounds(start.elements,[...start.ids]);
    if(bounds){const position=updateSmartGuides({id:'__group-selection',type:'rectangle',content:'',position:{x:bounds.x,y:bounds.y},size:bounds,zIndex:0},{x:bounds.x+dx,y:bounds.y+dy},true,start.ids);dx=position.x-bounds.x;dy=position.y-bounds.y;}
    const next=start.elements.map(element=>start.ids.has(element.id)?{...element,position:{x:element.position.x+dx,y:element.position.y+dy}}:element);
    start.latest=next;
    if(start.preview==='box'){
      if(selectionOutlineRef.current){selectionOutlineRef.current.style.transform=`translate(${dx}px,${dy}px)`;selectionOutlineRef.current.style.backgroundColor='rgba(59,130,246,.08)';}
    }else{elementsRef.current=next;setElements(next);}
  };
  const moreToolbarItemProps = toolbarItemProps("more");
  const maskBoards = [mainSurface, ...elements.filter(element => element.type === 'board')];
  const maskMinX = Math.min(...maskBoards.map(board => board.position.x));
  const maskMinY = Math.min(...maskBoards.map(board => board.position.y));
  const maskWidth = Math.max(...maskBoards.map(board => board.position.x + (board.size?.width ?? 0))) - maskMinX;
  const maskHeight = Math.max(...maskBoards.map(board => board.position.y + (board.size?.height ?? 0))) - maskMinY;
  const hasEraserMask = elements.some(element => element.isEraser && elementHierarchy.isVisible(element.id, respectLayerVisibility)) || Boolean(currentDrawPoints && activeTool === 'eraser' && eraserMode === 'partial');
  const eraserMaskStyle = { mask: hasEraserMask ? 'url(#global-eraser-mask)' : 'none', WebkitMask: hasEraserMask ? 'url(#global-eraser-mask)' : 'none' };
  const strokePreviewClip = currentDrawPoints?.length ? getSectionClipPath({
    id: 'stroke-preview', type: 'draw', content: '', position: { x: 0, y: 0 }, size: pageDimensions,
    parentId: creationParentId(currentDrawPoints[0]), zIndex: Math.max(0, ...elements.map(element => element.zIndex)) + 1,
  }, elements, elementPolygon({ position: { x: maskMinX, y: maskMinY }, size: { width: maskWidth, height: maskHeight } })) : undefined;



  return (
    <div
      className="h-screen flex flex-col bg-[#2e2e2e] overflow-hidden"
      data-board-interacting={isInteracting || !!toolbarDragId || !!returnDraggingId || undefined}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerCancel}
      onPointerLeave={() => {
        // Pointer capture owns an active drag, so crossing the app boundary
        // must not commit the marquee early. Keep the legacy cancellation
        // behavior only for non-captured interactions.
        if (activePointerIdRef.current === null) handlePointerUp();
      }}
    >
      {showBoardSaveModal && <SaveAsDialog name={title} onClose={() => setShowBoardSaveModal(false)} onSave={handleSaveAs} />}

      {showSaveModal && (
        <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white shadow-2xl rounded-3xl border-4 border-gray-800 p-6 max-w-sm w-full flex flex-col gap-4">
            <h3 className="font-bold text-lg text-gray-900 border-b-2 border-gray-100 pb-2 flex justify-between">
              Save as Preset
              <button
                onClick={() => setShowSaveModal(false)}
                className="text-gray-500 hover:text-black hover:bg-gray-100 p-1 rounded-md"
              >
                <X className="w-4 h-4" />
              </button>
            </h3>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-600 font-bold uppercase tracking-wider">
                Preset Name:
              </label>
              <input
                type="text"
                value={presetName}
                onChange={(e) => setPresetName(e.target.value)}
                className="w-full px-3 py-2 text-sm border-2 border-gray-300 rounded-lg focus:border-blue-500 outline-none font-bold transition-colors"
                placeholder="My Custom Preset"
              />
            </div>
            <span className="text-xs text-gray-600 font-bold uppercase tracking-wider mt-2">
              Select what to include:
            </span>
            <div
              className="flex items-center justify-between cursor-pointer group mt-2"
              onClick={() => setPresetSettingsChecked(!presetSettingsChecked)}
            >
              <span className="text-sm font-bold text-gray-700 select-none">
                Settings (Size, Grid)
              </span>
              <div
                className={cn(
                  "w-7 h-4 rounded-full flex items-center p-0.5 transition-colors duration-200 ease-in-out shrink-0 border border-black/10",
                  presetSettingsChecked ? "bg-blue-500" : "bg-gray-200",
                )}
              >
                <div
                  className={cn(
                    "w-3 h-3 bg-white rounded-full shadow-sm transform transition-transform duration-200 ease-in-out",
                    presetSettingsChecked ? "translate-x-3" : "translate-x-0",
                  )}
                />
              </div>
            </div>
            <div
              className="flex items-center justify-between cursor-pointer group mb-1"
              onClick={() => setPresetContentChecked(!presetContentChecked)}
            >
              <span className="text-sm font-bold text-gray-700 select-none">
                Content (Elements)
              </span>
              <div
                className={cn(
                  "w-7 h-4 rounded-full flex items-center p-0.5 transition-colors duration-200 ease-in-out shrink-0 border border-black/10",
                  presetContentChecked ? "bg-blue-500" : "bg-gray-200",
                )}
              >
                <div
                  className={cn(
                    "w-3 h-3 bg-white rounded-full shadow-sm transform transition-transform duration-200 ease-in-out",
                    presetContentChecked ? "translate-x-3" : "translate-x-0",
                  )}
                />
              </div>
            </div>
            <button
              onClick={handleConfirmPresetSave}
              className="bg-blue-600 text-white px-4 py-2 mt-2 rounded-lg font-bold hover:bg-blue-700 transition-colors w-full shadow-sm"
            >
              Save Preset
            </button>{" "}
          </div>
        </div>
      )}

      {/* Top Bar */}
      <header className="relative min-h-16 border-b-4 border-gray-800 bg-gray-100 px-1 min-[900px]:px-3 py-2 flex flex-nowrap items-center gap-2 z-50 shrink-0 overflow-visible">
        {/* Left Side: General settings */}
        <div className="flex items-center gap-2 shrink-0 min-w-0">
          <button
            onClick={() => {
              doSave();
              onBack();
            }}
            title="Back"
            className="shrink-0 p-2 rounded-lg text-gray-500 hover:text-[#1A1A1A] justify-center hover:bg-gray-100 transition-colors border-2 border-transparent hover:border-gray-300"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <button
            onClick={handleUndo}
            disabled={historyIndex === 0}
            className={cn(
              "shrink-0 p-2 rounded-lg justify-center transition-colors border-2 border-transparent",
              historyIndex === 0
                ? "text-gray-300 cursor-not-allowed"
                : "text-gray-500 hover:text-[#1A1A1A] hover:bg-gray-100 hover:border-gray-300",
            )}
            title="Undo (Ctrl+Z)"
          >
            <Undo2 className="w-5 h-5" />
          </button>
          <button
            onClick={handleRedo}
            disabled={historyIndex === history.length - 1}
            className={cn(
              "shrink-0 p-2 rounded-lg justify-center transition-colors border-2 border-transparent",
              historyIndex === history.length - 1
                ? "text-gray-300 cursor-not-allowed"
                : "text-gray-500 hover:text-[#1A1A1A] hover:bg-gray-100 hover:border-gray-300",
            )}
            title="Redo (Ctrl+Y)"
          >
            <Redo2 className="w-5 h-5" />
          </button>
          <div className="relative flex shrink-0 items-center">
            <input
              type="text"
              value={title}
              aria-label="Board name"
              onChange={(e) => setTitle(e.target.value)}
              className="shrink-0 font-bold text-base min-[900px]:text-lg tracking-tight text-[#1A1A1A] bg-transparent border-none outline-none rounded pl-2 pr-8 py-1 w-36 min-[900px]:w-52 hover:bg-gray-100 transition-all truncate"
            />
            {title !== page.title && (
              <button 
                type="button"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 h-6 w-6 shrink-0 text-green-600 hover:bg-green-100 rounded flex items-center justify-center transition-colors bg-white shadow-sm border border-green-200"
                title="Save title"
                onClick={() => {
                  (document.activeElement as HTMLElement)?.blur?.();
                  doSave();
                }}
              >
                <Check className="w-3.5 h-3.5 stroke-[3]" />
              </button>
            )}
          </div>
        </div>

        {/* Center: Tools */}
        <div
          ref={toolbarContainerRef}
          data-toolbar-container="true"
          data-toolbar-surface="true"
          data-toolbar-drop-zone={toolbarEditingMode ? "true" : undefined}
          onDragOver={(e) => {
            const dragId = toolbarDragIdRef.current || toolbarDragId;
            if (!toolbarCustomizeMode || !dragId) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            previewToolbarDropFromPointer(
              e.clientX,
              e.currentTarget,
              dragId,
            );
          }}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
          }}
          onDrop={(e) => {
            const dragId = toolbarDragIdRef.current || toolbarDragId;
            if (!toolbarCustomizeMode || !dragId) return;
            e.preventDefault();
            previewToolbarItemAtSlot(
              dragId,
              getToolbarDropIndexFromPointer(
                e.clientX,
                e.currentTarget,
                dragId,
              ),
            );
            commitToolbarPreview();
            toolbarDragIdRef.current = null;
            setToolbarDragId(null);
          }}
          className={cn(
            "grid w-auto flex-1 items-center justify-center min-w-0 transition-all",
            toolbarEditingMode
              ? "gap-0 rounded-lg bg-gray-100/70 ring-2 ring-gray-400/60 px-0 py-0.5 min-h-[38px]"
              : "gap-0",
          )}
          style={
            {
              gridTemplateColumns: `repeat(${toolbarSlotCount}, minmax(0, 1fr))`,
              gridTemplateRows: `${TOOLBAR_SLOT_HEIGHT}px`,
              gridAutoRows: `${TOOLBAR_SLOT_HEIGHT}px`,
              backgroundImage: toolbarEditingMode
                ? `repeating-linear-gradient(to right, rgba(107, 114, 128, 0.28) 0 1px, transparent 1px ${toolbarSlotPixelWidth}px)`
                : undefined,
              backgroundSize: toolbarEditingMode
                ? `${toolbarSlotPixelWidth}px 100%`
                : undefined,
            }
          }
        >
          <div className="contents">
            {/* Zoom Settings Dropdown */}
            <div
              {...toolbarItemProps("generalSettings")}
              className={toolbarItemClass(
                "generalSettings",
                "relative shrink-0 flex items-center",
              )}
            >
              <button
                onClick={() => {
                  const s = !showZoomSettingsDropdown;
                  closeAllDropdowns();
                  setShowZoomSettingsDropdown(s);
                }}
                className={cn(
                  "p-2 rounded-lg transition-all flex items-center justify-center",
                  showZoomSettingsDropdown
                    ? "text-[#1A1A1A] bg-white ring-2 ring-gray-200 shadow-sm"
                    : "text-gray-500 hover:text-[#1A1A1A] hover:bg-gray-200",
                )}
                title="General Settings"
              >
                <Settings2 className="w-4 h-4" />
              </button>

                {showZoomSettingsDropdown && (
                  <div className="toolbar-dropdown absolute top-full left-1/2 -translate-x-1/2 mt-5 bg-white border-[3px] border-gray-400 rounded-xl shadow-xl p-3 z-[100] flex flex-col gap-3 w-72 max-h-[80vh] overflow-y-auto">
                    <div className="border-b-[3px] border-gray-400 pb-1 text-[10px] font-bold uppercase tracking-wider text-gray-500">
                      General Settings
                    </div>
                    <div className="menu-scroll-viewport min-h-0 overflow-y-auto">{renderGeneralSettingsContent()}</div>

                  </div>
              )}
            </div>

            <div
              {...toolbarItemProps("zoom")}
              className={toolbarItemClass(
                "zoom",
                "relative shrink-0 flex items-center",
              )}
            >
              <button
                onClick={() => activateToolbarTool("zoom")}
                className={cn(
                  "p-2 rounded-lg transition-all flex items-center justify-center",
                  activeTool === "zoom"
                    ? "text-[#1A1A1A] bg-white"
                    : "text-gray-500 hover:text-[#1A1A1A] hover:bg-gray-200",
                )}
                title="Zoom Tool"
              >
                <ZoomIn className="w-4 h-4" />
              </button>
            </div>

            <div
              {...toolbarItemProps("select")}
              className={toolbarItemClass(
                "select",
                cn(
                  "relative flex rounded-lg transition-all [&>button]:bg-transparent [&>button]:ring-0 [&>button]:shadow-none",
                  activeTool === "select" || showSelectDropdown
                    ? "text-[#1A1A1A] bg-white ring-2 ring-gray-200 shadow-sm"
                    : "text-gray-500 hover:text-[#1A1A1A] hover:bg-gray-200",
                ),
              )}
            >
              <button
                onClick={() => {
                  activateToolbarTool("select");
                }}
                className={cn(
                  "p-2 text-xs font-bold rounded-l-lg transition-all flex items-center justify-center",
                )}
                title="Select Tool"
              >
                <MousePointer2 className="w-4 h-4" />
              </button>
              <button
                onClick={() => {
                  const s = !showSelectDropdown;
                  closeAllDropdowns();
                  setShowSelectDropdown(s);
                }}
                className={cn(
                  "p-2 rounded-r-lg transition-all flex items-center justify-center text-gray-500 hover:text-black",
                )}
                aria-label="Select settings"
              >
                <ChevronDown className="w-3 h-3 opacity-80" />
              </button>

              {showSelectDropdown && (
                <div className="toolbar-dropdown absolute top-full left-1/2 -translate-x-1/2 mt-5 w-72 bg-white border-[3px] border-gray-400 rounded-xl shadow-xl z-[100] flex flex-col overflow-hidden text-left">
                  {renderToolMenuTitle("Select Settings", "")}
                  <div className="flex flex-col gap-2">
                    {renderSelectToolSettings()}
                    {renderMenuSettingsBlock("select")}
                  </div>
                </div>
              )}
            </div>

            <div
              {...toolbarItemProps("pan")}
              className={toolbarItemClass(
                "pan",
                cn(
                  "relative flex rounded-lg transition-all [&>button]:bg-transparent [&>button]:ring-0 [&>button]:shadow-none",
                  activeTool === "pan" || showPanDropdown
                    ? "text-[#1A1A1A] bg-white"
                    : "text-gray-500 hover:text-[#1A1A1A]",
                ),
              )}
            >
              <button
                onClick={() => {
                  activateToolbarTool("pan");
                }}
                className={cn(
                  "p-2 text-xs font-bold rounded-l-lg transition-all flex items-center gap-1.5",
                )}
                title="Pan Tool (Hand)"
              >
                <Hand className="w-4 h-4" />
              </button>
              <button
                className={cn(
                  "p-2 rounded-r-lg transition-all flex items-center justify-center text-gray-500 hover:text-black",
                )}
                title="Pan settings"
                aria-label="Pan settings"
                onClick={() => {
                  const s = !showPanDropdown;
                  closeAllDropdowns();
                  setShowPanDropdown(s);
                }}
              >
                <ChevronDown className="w-3 h-3 opacity-80" />
              </button>

              {showPanDropdown && (
                <div className="toolbar-dropdown absolute top-full left-1/2 -translate-x-1/2 mt-5 bg-white border-[3px] border-gray-400 rounded-xl shadow-xl p-3 z-[100] flex flex-col gap-3 w-56">
                  {renderToolMenuTitle("Pan Settings")}
                  {renderPanToolSettings()}
                  {renderMenuSettingsBlock("pan")}
                </div>
              )}
            </div>
            <div
              {...toolbarItemProps("text")}
              className={toolbarItemClass(
                "text",
                cn(
                  "relative flex rounded-lg transition-all [&>button]:bg-transparent [&>button]:ring-0 [&>button]:shadow-none",
                  isTextTool || showTextSettingsDropdown
                    ? "text-[#1A1A1A] bg-white ring-2 ring-gray-200 shadow-sm"
                    : "text-gray-500 hover:text-[#1A1A1A] hover:bg-gray-200",
                ),
              )}
            >
              <button
                onClick={() => {
                  activateToolbarTool("text");
                }}
                className={cn(
                  "p-2 text-xs font-bold rounded-lg transition-all flex items-center gap-1",
                  isTextTool && activeTool !== "select" && activeTool !== "pan"
                    ? "text-[#1A1A1A]"
                    : "text-gray-500",
                )}
                title="Text Tool"
              >
                <Type className="w-4 h-4" />
              </button>
              <button
                type="button"
                className={cn(
                  "p-2 text-xs font-bold rounded-r-lg transition-all flex items-center justify-center",
                  "text-gray-500 hover:text-black",
                )}
                title="Text settings"
                aria-label="Open text settings"
                onClick={() => {
                  const s = !showTextSettingsDropdown;
                  closeAllDropdowns();
                  setShowTextSettingsDropdown(s);
                }}
              >
                <ChevronDown className="w-3 h-3 opacity-80" />
              </button>

              {showTextSettingsDropdown && (
                <div className="toolbar-dropdown absolute top-full left-1/2 -translate-x-1/2 mt-5 bg-white border-[3px] border-gray-400 rounded-xl shadow-xl p-3 z-[100] flex flex-col gap-3 w-64">
                  {renderToolMenuTitle("Text Settings")}
                  {renderTextToolSettings()}
                  {renderMenuSettingsBlock("text")}
                </div>
              )}
            </div>
            <div
              {...toolbarItemProps("shapes")}
              className={toolbarItemClass(
                "shapes",
                cn(
                  "relative flex rounded-lg transition-all [&>button]:bg-transparent [&>button]:ring-0 [&>button]:shadow-none",
                  SHAPE_TYPES.includes(activeTool) || showShapeDropdown
                    ? "text-[#1A1A1A] bg-white ring-2 ring-gray-200 shadow-sm"
                    : "text-gray-500 hover:text-[#1A1A1A] hover:bg-gray-200",
                ),
              )}
            >
              <button
                onClick={() => {
                  closeAllDropdowns();
                  setActiveTool(
                    SHAPE_TYPES.includes(activeTool) ? activeTool : "rectangle",
                  );
                }}
                className={cn(
                  "p-2 text-xs font-bold rounded-l-lg transition-all flex items-center gap-1",
                )}
                title="Shapes"
              >
                {activeTool === "ellipse" ? (
                  <Circle className="w-4 h-4" />
                ) : activeTool === "triangle" ? (
                  <Triangle className="w-4 h-4" />
                ) : activeTool === "line" ? (
                  <Minus className="w-4 h-4" />
                ) : activeTool === "arrow" ? (
                  <ArrowUpRight className="w-4 h-4" />
                ) : (
                  <Square className="w-4 h-4" />
                )}
              </button>
              <button
                className={cn(
                  "p-2 rounded-r-lg transition-all flex items-center justify-center text-gray-500 hover:text-black",
                )}
                title="Choose shape"
                onClick={() => {
                  const s = !showShapeDropdown;
                  closeAllDropdowns();
                  setShowShapeDropdown(s);
                }}
                aria-label="Choose shape"
              >
                <ChevronDown className="w-3 h-3 opacity-80" />
              </button>

              {showShapeDropdown && (
                <div className="toolbar-dropdown absolute top-full left-1/2 -translate-x-1/2 mt-5 bg-white border-[3px] border-gray-400 rounded-xl shadow-xl p-1 z-[100] flex flex-col gap-1 w-64">
                  {renderToolMenuTitle("Shape Settings", "-mx-1 -mt-1 mb-1")}
                  {renderShapeToolSettings()}
                  {renderMenuSettingsBlock("shapes")}
                </div>
              )}
            </div>

            <div
              {...toolbarItemProps("media")}
              className={toolbarItemClass(
                "media",
                cn(
                  "relative flex rounded-lg text-xs font-bold transition-all [&>button]:bg-transparent [&>button]:ring-0 [&>button]:shadow-none",
                  activeTool === "media" || showMediaSettingsDropdown
                    ? "text-[#1A1A1A] bg-white ring-2 ring-gray-200 shadow-sm"
                    : "text-gray-500 hover:text-[#1A1A1A] hover:bg-gray-200",
                ),
              )}
            >
              <button
                type="button"
                onClick={() => activateToolbarTool("media")}
                className="p-2 text-xs font-bold rounded-l-lg flex items-center justify-center"
                title="Media Tool"
                aria-label="Media tool"
              >
                <ImageIcon className="w-4 h-4" />
              </button>
              <button
                type="button"
                className="p-2 rounded-r-lg flex items-center justify-center text-gray-500 hover:text-black transition-all"
                title="Media settings"
                aria-label="Open media settings"
                onClick={() => {
                  const s = !showMediaSettingsDropdown;
                  closeAllDropdowns();
                  setShowMediaSettingsDropdown(s);
                }}
              >
                <ChevronDown className="w-3 h-3 opacity-80" />
              </button>
              {showMediaSettingsDropdown && (
                <div className="toolbar-dropdown absolute top-full left-1/2 -translate-x-1/2 mt-5 bg-white border-[3px] border-gray-400 rounded-xl shadow-xl p-3 z-[100] flex flex-col gap-0 w-64">
                  {renderToolMenuTitle(
                    "Media Settings",
                    "-mx-3 -mt-3 mb-1",
                    true,
                  )}
                  {renderMenuSettingsBlock("media", true)}
                </div>
              )}
            </div>
            <div
              {...toolbarItemProps("draw")}
              className={toolbarItemClass(
                "draw",
                cn(
                  "relative flex rounded-lg transition-all [&>button]:bg-transparent [&>button]:ring-0 [&>button]:shadow-none",
                  activeTool === "draw" || showDrawDropdown
                    ? "text-[#1A1A1A] bg-white ring-2 ring-gray-200 shadow-sm"
                    : "text-gray-500 hover:text-[#1A1A1A] hover:bg-gray-200",
                ),
              )}
            >
              <button
                onClick={() => {
                  activateToolbarTool("draw");
                }}
                className={cn(
                  "p-2 text-xs font-bold rounded-l-lg transition-all flex items-center gap-1",
                )}
                title="Draw"
              >
                <PenTool className="w-4 h-4" />
              </button>
              <button
                className={cn(
                  "p-2 rounded-r-lg transition-all flex items-center justify-center text-gray-500 hover:text-black",
                )}
                title="Draw settings"
                aria-label="Draw settings"
                onClick={() => {
                  const s = !showDrawDropdown;
                  closeAllDropdowns();
                  setShowDrawDropdown(s);
                }}
              >
                <ChevronDown className="w-3 h-3 opacity-80" />
              </button>

              {showDrawDropdown && (
                <div className="toolbar-dropdown absolute top-full left-1/2 -translate-x-1/2 mt-5 bg-white border-[3px] border-gray-400 rounded-xl shadow-xl w-64 p-3 z-[100]">
                  {renderToolMenuTitle("Draw Settings")}
                  {renderDrawToolSettings()}
                  {renderMenuSettingsBlock("draw")}
                </div>
              )}
            </div>

            <div
              {...toolbarItemProps("fill")}
              className={toolbarItemClass(
                "fill",
                cn(
                  "relative flex rounded-lg transition-all [&>button]:bg-transparent [&>button]:ring-0 [&>button]:shadow-none",
                  activeTool === "fill" || showFillDropdown
                    ? "text-[#1A1A1A] bg-white ring-2 ring-gray-200 shadow-sm"
                    : "text-gray-500 hover:text-[#1A1A1A] hover:bg-gray-200",
                ),
              )}
            >
              <button
                onClick={() => {
                  activateToolbarTool("fill");
                }}
                className={cn(
                  "p-2 text-xs font-bold rounded-l-lg transition-all flex items-center gap-1",
                )}
                title="Fill Tool"
              >
                <PaintBucket className="w-4 h-4" />
              </button>
              <button
                className={cn(
                  "p-2 rounded-r-lg transition-all flex items-center justify-center text-gray-500 hover:text-black",
                )}
                title="Fill settings"
                aria-label="Fill settings"
                onClick={() => {
                  const s = !showFillDropdown;
                  closeAllDropdowns();
                  setShowFillDropdown(s);
                }}
              >
                <ChevronDown className="w-3 h-3 opacity-80" />
              </button>

              {showFillDropdown && (
                <div className="toolbar-dropdown absolute top-full left-1/2 -translate-x-1/2 mt-5 bg-white border-[3px] border-gray-400 rounded-xl shadow-xl w-72 p-3 z-[100]">
                  {renderToolMenuTitle("Fill Settings")}
                  <div className="flex flex-col gap-3">
                    <div className="flex items-center justify-between gap-4 text-xs font-semibold text-gray-500 mb-1">
                      <span className="whitespace-nowrap">Color</span>
                      <div className="flex items-center gap-2">
                        <Palette className="w-4 h-4 text-gray-400" />
                        <ColorPicker
                          value={fillToolColor}
                          onChange={(c) => setFillToolColor(c)}
                          customColors={customColors.fill}
                          onAddCustomColor={(c, i) =>
                            handleAddCustomColor(c, i, "fill")
                          }
                        />
                      </div>
                    </div>
                  </div>
                  {renderMenuSettingsBlock("fill")}
                </div>
              )}
            </div>

            <div
              {...toolbarItemProps("eraser")}
              className={toolbarItemClass(
                "eraser",
                cn(
                  "relative flex rounded-lg text-xs font-bold transition-all [&>button]:bg-transparent [&>button]:ring-0 [&>button]:shadow-none",
                  activeTool === "eraser" || showEraserSettingsDropdown
                    ? "text-[#1A1A1A] bg-white ring-2 ring-gray-200 shadow-sm"
                    : "text-gray-500 hover:text-[#1A1A1A] hover:bg-gray-200",
                ),
              )}
            >
              <button
                type="button"
                onClick={() => activateToolbarTool("eraser")}
                className="p-2 text-xs font-bold rounded-l-lg flex items-center justify-center"
                title="Eraser Tool"
                aria-label="Eraser tool"
              >
                <Eraser className="w-4 h-4" />
              </button>
              <button
                type="button"
                className="p-2 rounded-r-lg flex items-center justify-center text-gray-500 hover:text-black transition-all"
                title="Eraser settings"
                aria-label="Open eraser settings"
                onClick={() => {
                  const s = !showEraserSettingsDropdown;
                  closeAllDropdowns();
                  setShowEraserSettingsDropdown(s);
                }}
              >
                <ChevronDown className="w-3 h-3 opacity-80" />
              </button>
              {showEraserSettingsDropdown && (
                <div className="toolbar-dropdown absolute top-full left-1/2 -translate-x-1/2 mt-5 bg-white border-[3px] border-gray-400 rounded-xl shadow-xl p-3 z-[100] flex flex-col gap-3 w-64">
                  {renderToolMenuTitle("Eraser Settings")}
                  {renderEraserToolSettings()}
                  {renderMenuSettingsBlock("eraser")}
                </div>
              )}
            </div>
            {BUILT_IN_MORE_TOOL_IDS.map((id) => {
              const item = TOOLBAR_ITEMS.find((candidate) => candidate.id === id);
              if (!item) return null;
              const Icon = item.icon;
              const menuOpen = detachedMoreMenuId === id;
              const isActive =
                activeTool === id ||
                (id === "object-presets" && showObjectPresetsPanel);
              return (
                <div
                  key={`detached-more-${id}`}
                  {...toolbarItemProps(id)}
                  className={toolbarItemClass(
                    id,
                    cn(
                      "relative flex rounded-lg transition-all [&>button]:bg-transparent [&>button]:ring-0 [&>button]:shadow-none",
                      isActive || menuOpen
                        ? "bg-white text-[#1A1A1A] ring-2 ring-gray-200 shadow-sm"
                        : "text-gray-500 hover:bg-gray-200 hover:text-[#1A1A1A]",
                    ),
                  )}
                >
                  <button
                    type="button"
                    onClick={() => activateToolbarOverflowItem(id)}
                    className="flex items-center justify-center rounded-l-lg p-2"
                    title={item.label}
                    aria-label={item.label}
                  >
                    <Icon className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const nextMenu = menuOpen ? null : id;
                      closeAllDropdowns();
                      setDetachedMoreMenuId(nextMenu);
                    }}
                    className="flex items-center justify-center rounded-r-lg p-2 text-gray-500 hover:text-black"
                    title={`${item.label} settings`}
                    aria-label={`Open ${item.label} settings`}
                    aria-expanded={menuOpen}
                  >
                    <ChevronDown className="h-3 w-3 opacity-80" />
                  </button>
                  {menuOpen && (
                    <div className="toolbar-dropdown absolute left-1/2 top-full z-[100] mt-5 flex w-80 -translate-x-1/2 flex-col gap-3 rounded-xl border-[3px] border-gray-400 bg-white p-3 text-left shadow-xl">
                      {renderToolMenuTitle(`${item.label} Settings`)}
                      {renderOverflowToolSettings(id)}
                    </div>
                  )}
                </div>
              );
            })}
            <div
              {...moreToolbarItemProps}
              data-more-drop-active={moreDropActive || undefined}
              onDragEnter={event => {
                const id = toolbarDragIdRef.current;
                if (!toolbarCustomizeMode || !id || id === 'more') return;
                event.preventDefault(); event.stopPropagation(); setMoreDropActive(true);
              }}
              onDragOver={event => {
                const id = toolbarDragIdRef.current;
                if (!toolbarCustomizeMode || !id || id === 'more') return;
                event.preventDefault(); event.stopPropagation();
                event.dataTransfer.dropEffect = 'move'; setMoreDropActive(true);
              }}
              onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setMoreDropActive(false); }}
              onDrop={event => {
                const id = toolbarDragIdRef.current;
                if (!toolbarCustomizeMode || !id || id === 'more') return;
                event.preventDefault(); event.stopPropagation();
                moveToolbarItemToMore(id); setMoreDropActive(false);
                toolbarDropCommittedRef.current = true; toolbarDragIdRef.current = null; setToolbarDragId(null);
              }}
              className={toolbarItemClass(
                "more",
                "relative flex",
              )}
            >
              <button
                className={cn(
                  "p-2 rounded-lg transition-all flex items-center justify-center gap-1.5",
                  showMoreToolsDropdown ||
                    hasActiveToolbarOverflowItem ||
                    showObjectPresetsPanel ||
                    ["embed", "board", "link"].includes(
                      activeTool,
                    )
                    ? "text-[#1A1A1A] bg-white ring-2 ring-gray-200 shadow-sm"
                    : "text-gray-500 hover:text-[#1A1A1A] hover:bg-gray-200",
                )}
                onClick={() => {
                  const s = !showMoreToolsDropdown;
                  closeAllDropdowns();
                  setShowMoreToolsDropdown(s);
                }}
                title="More"
                aria-label="More"
              >
                <Ellipsis className="h-4 w-4" aria-hidden="true" />
              </button>

              {showMoreToolsDropdown && (
                <div
                  className="toolbar-dropdown absolute top-full left-1/2 -translate-x-1/2 mt-5 bg-white border-[3px] border-gray-400 rounded-xl shadow-xl p-1 z-[100] flex flex-col gap-1 w-80 max-h-[80vh] overflow-x-hidden overflow-y-auto text-left"
                >
                  {renderToolMenuTitle("More", "-mx-1 -mt-1 mb-1")}
                  <div className="mx-1 mb-1 rounded-lg border border-gray-200 bg-gray-50 p-1">
                    {renderAlwaysOnTopControl("more")}
                    <button type="button" aria-pressed={smartGuidesEnabled} onClick={()=>{setSmartGuidesEnabled(value=>!value);setVisibleGuides([]);}} className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-2 py-2 text-xs font-bold text-gray-700"><span>Smart guides</span>{renderSwitch(smartGuidesEnabled)}</button>
                  </div>
                  {toolbarLayout.more.map((id) => {
                    const item = TOOLBAR_ITEMS.find(
                      (candidate) => candidate.id === id,
                    );
                    if (!item) return null;
                    const Icon = item.icon;
                    return (
                      <div
                        key={`more-${id}`}
                        data-more-toolbar-item={id}
                        data-more-dragging={heldMoreTool === id || undefined}
                        data-more-tool={
                          BUILT_IN_MORE_TOOL_IDS.includes(
                            id as (typeof BUILT_IN_MORE_TOOL_IDS)[number],
                          )
                            ? id
                            : undefined
                        }
                        className="overflow-hidden rounded-lg border-2 border-gray-200 bg-white transition-colors"
                      >
                        <div className="flex items-stretch text-xs font-bold text-gray-700 hover:bg-gray-50 hover:text-[#1A1A1A]">
                          <button
                            type="button"
                            onClick={() => activateToolbarOverflowItem(id)}
                            className="flex min-w-0 flex-1 items-center gap-2 rounded-l-lg p-2 text-left"
                          >
                            <Icon className="h-4 w-4 shrink-0" />
                            <span>{item.label}</span>
                          </button>
                          <button
                            type="button"
                            data-more-tool-return={id}
                            aria-label={`Move ${item.label} to toolbar`}
                            title="Hold and drag to toolbar"
                            onPointerDown={event => startMoreToolDrag(event, id)}
                            onClick={(event) => {
                              event.stopPropagation();
                              event.preventDefault();
                            }}
                            className="mx-1 flex h-6 w-6 shrink-0 self-center touch-none items-center justify-center rounded-md bg-transparent text-gray-400 transition-colors hover:text-blue-600"
                          >
                            <Move className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label={`${item.label} settings`}
                            aria-expanded={expandedMoreTools.has(id)}
                            aria-controls={`more-settings-${id}`}
                            onClick={(event) => {
                              event.stopPropagation();
                              toggleExpandedMoreTool(id);
                            }}
                            className="rounded-r-lg px-2 text-gray-500 hover:text-black"
                          >
                            <ChevronDown
                              className={cn(
                                "h-3.5 w-3.5 transition-transform",
                                expandedMoreTools.has(id) && "rotate-180",
                              )}
                            />
                          </button>
                        </div>
                        {expandedMoreTools.has(id) && (
                          <div id={`more-settings-${id}`} className="p-2 pt-1">
                            {renderOverflowToolSettings(id, true)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          <div className="contents">
            <div className="contents">
            <div
              {...toolbarItemProps("layers")}
              className={toolbarItemClass(
                "layers",
                "relative shrink-0 flex items-center justify-center z-[600]",
              )}
            >
              <div
                className={cn(
                  "flex items-center justify-center w-full h-full rounded-lg transition-colors",
                  showLayersPanel
                    ? "bg-white text-[#1A1A1A] ring-2 ring-gray-300 shadow-sm"
                    : "text-gray-500 hover:bg-gray-200 hover:text-[#1A1A1A]",
                )}
              >
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setRespectLayerVisibility(!respectLayerVisibility);
                  }}
                  className={cn(
                    "p-2 text-xs font-bold rounded-l-lg transition-all flex items-center gap-1.5 bg-transparent",
                  )}
                  title="Toggle layer visibility"
                  aria-label="Toggle layer visibility"
                >
                  <Layers className="w-4 h-4" />
                  <span className="select-none text-[11px] uppercase tracking-wider hidden min-[900px]:block">
                    Layers
                  </span>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    const s = !showLayersPanel;
                    closeAllDropdowns();
                    setShowLayersPanel(s);
                  }}
                  aria-label="Open Layers Panel"
                  title="Open Layers Panel"
                  className={cn(
                    "p-2 text-xs font-bold rounded-r-lg transition-all flex items-center bg-transparent text-gray-500 hover:text-black",
                  )}
                >
                  <ChevronDown className="w-3 h-3 opacity-80" />
                </button>
              </div>

              <AnimatePresence>
                {showLayersPanel && (
                  <motion.div
                    initial={{ opacity: 0, y: -10 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -10 }}
                    className="toolbar-dropdown absolute left-1/2 -translate-x-1/2 top-full mt-5 w-56 min-h-[144px] max-h-[85vh] bg-white border-[3px] border-gray-400 rounded-xl shadow-xl flex flex-col z-[1000] overflow-hidden"
                  >
                    <div className="p-3 border-b-2 border-gray-100 bg-white flex items-center justify-between shrink-0">
                      <div className="flex items-center gap-2 min-w-0">
                        <Layers className="w-4 h-4 text-gray-500 shrink-0" />
                        <span className="uppercase tracking-wider text-[11px] font-bold text-gray-700">
                          Layers
                        </span>
                        {currentLayerView && (
                          <>
                            <ChevronRight className="w-3 h-3 text-gray-400 shrink-0" />
                            <span className="uppercase tracking-wider text-[11px] font-bold text-gray-700 truncate max-w-[70px]">
                              {elements.find((e) => e.id === currentLayerView)
                                ?.name || `Layer ${currentLayerView.slice(0, 4)}`}
                            </span>
                            <button
                              onClick={() => setCurrentLayerView(null)}
                              className="p-1 hover:bg-gray-100 rounded-md transition-colors text-gray-500 hover:text-black shrink-0"
                              title="Back to Root"
                            >
                              <ArrowLeft className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                          <button
                            onClick={() => void pasteSystemClipboard(undefined,currentLayerView??undefined)}
                            className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-500 hover:text-black"
                            title="Paste Layer"
                          >
                            <ClipboardPaste className="w-4 h-4" />
                          </button>
                        <button
                          onClick={() => {
                            const l = {
                              id: generateId(),
                              type: "layer",
                              position: { x: 0, y: 0 },
                              name: "New Layer",
                              zIndex: elements.length + 1,
                              parentId: currentLayerView || undefined,
                            };
                            pushElements([...elements, l]);
                          }}
                          className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors text-gray-500 hover:text-black"
                          title="Add Layer"
                        >
                          <Plus className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div className="layers-scroll flex-1 overflow-y-auto bg-gray-50/50 p-3 grid grid-cols-2 gap-3 content-start">
                      {getLayerPanelElements().map((el) => {
                          const isLayerLike =
                            el.type === "layer" ||
                            el.type === "section" ||
                            el.type === "board";
                          const isBoard = el.type === "board";
                          const typeIndex = elementTypeIndexById.get(el.id) ?? 1;
                          const defaultName = isBoard
                              ? "Board"
                              : el.type === "layer"
                                ? `Layer ${typeIndex}`
                                : `${toTitleCase(el.type)} ${typeIndex}`;
                          const isDraggingThisLayer = draggingLayerId === el.id;
                          return (
                             <motion.div
                               layout="position"
                               transition={{ type: "spring", stiffness: 520, damping: 42 }}
                              style={
                                isDraggingThisLayer
                                  ? {
                                      backgroundColor: "#eff6ff",
                                      borderColor: "#3b82f6",
                                      opacity: 1,
                                      transition: "none",
                                    }
                                  : undefined
                               }
                               data-layer-tile-id={el.id}
                              data-layer-placeholder={
                                isDraggingThisLayer ? "true" : undefined
                              }
                              draggable={!isBoard}
                              onDragStart={(e) => {
                                if (
                                  isBoard ||
                                  (e.target as HTMLElement).closest(
                                    "button,input,textarea,select,[contenteditable='true']",
                                  )
                                ) {
                                  e.preventDefault();
                                  return;
                                }
                                draggedLayerIdRef.current = el.id;
                                setDraggingLayerId(el.id);
                                startLayerPreview(el.id);
                                e.dataTransfer.setData("text/plain", el.id);
                                e.dataTransfer.setData("layer-id", el.id);
                                e.dataTransfer.effectAllowed = "move";

                                const rect = e.currentTarget.getBoundingClientRect();
                                const dragPreview = e.currentTarget.cloneNode(true) as HTMLElement;
                                dragPreview.style.position = "fixed";
                                dragPreview.style.left = "-10000px";
                                dragPreview.style.top = "0";
                                dragPreview.style.width = `${rect.width}px`;
                                dragPreview.style.height = `${rect.height}px`;
                                dragPreview.style.opacity = "1";
                                dragPreview.style.pointerEvents = "none";
                                dragPreview.style.boxShadow = "0 16px 34px rgba(15, 23, 42, 0.22)";
                                dragPreview.style.transform = "scale(1.02)";
                                document.body.appendChild(dragPreview);
                                e.dataTransfer.setDragImage(
                                  dragPreview,
                                  rect.width / 2,
                                  Math.min(28, rect.height / 2),
                                );
                                window.setTimeout(() => dragPreview.remove(), 0);
                              }}
                              onDragEnd={() => {
                                clearLayerPreview();
                              }}
                              onDragOver={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                e.dataTransfer.dropEffect = "move";
                                previewLayerOrderFromPointer(e, el);
                              }}
                              onDrop={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                previewLayerOrderFromPointer(e, el, true);
                                commitLayerPreview();
                              }}
                              className={cn(
                                "col-span-2 p-2 aspect-[2/1] uppercase tracking-wider rounded-xl cursor-pointer transition-all relative flex flex-col justify-center items-center group",
                                draggingLayerId &&
                                  draggingLayerId !== el.id &&
                                  dragOverLayerId?.endsWith(`:${el.id}`) &&
                                  "ring-2 ring-gray-300/80",
                                 isDraggingThisLayer
                                   ? "border-[3px] border-blue-500 bg-blue-50 shadow-none ring-2 ring-blue-200 [&>*]:invisible"
                                        : selectedIds.includes(el.id)
                                          ? "bg-white text-[#1A1A1A] border-[3px] border-gray-400 shadow-sm z-10"
                                          : "bg-white text-gray-500 border-[3px] border-gray-200 hover:text-[#1A1A1A] hover:border-gray-300 shadow-sm",
                              )}
                              onClick={(e) => {
                                e.stopPropagation();
                                if (elementHierarchy.isLocked(el.id)) {
                                  setSelectedId(null);
                                  setIsMainBoardSelected(false);
                                  return;
                                }
                                setSelectedId(el.id);
                                setIsMainBoardSelected(false);
                              }}
                              onDoubleClick={(e) => {
                                e.stopPropagation();
                                if (isLayerLike) setCurrentLayerView(el.id);
                              }}
                            >
                                {/* Layer actions */}
                                <div
                                  className="absolute top-2 left-2 right-2 grid grid-cols-4 place-items-center gap-2 z-20"
                                  onPointerDown={(e) => e.stopPropagation()}
                                  onDoubleClick={e => e.stopPropagation()}
                                >
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      duplicateElementTree(el.id);
                                    }}
                                    className="w-7 h-7 flex items-center justify-center rounded-md transition-colors hover:bg-gray-100 text-gray-500 hover:text-[#1A1A1A]"
                                    title="Copy layer"
                                  >
                                    <Copy className="w-4 h-4" />
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      const nextLocked = !el.isLocked;
                                      updateElement(el.id, {
                                        isLocked: nextLocked,
                                      });
                                      if (nextLocked) {
                                        const selectedElement = elements.find(
                                          (candidate) => candidate.id === selectedId,
                                        );
                                        if (
                                          selectedId === el.id ||
                                          (selectedElement &&
                                            isElementDescendantOf(
                                              selectedElement,
                                              el.id,
                                              elements,
                                            ))
                                        ) {
                                          setSelectedId(null);
                                        }
                                      }
                                    }}
                                    className={cn(
                                      "w-7 h-7 flex items-center justify-center rounded-md transition-colors",
                                      el.isLocked
                                        ? "bg-blue-100 text-blue-600"
                                        : "hover:bg-gray-100 text-gray-500 hover:text-[#1A1A1A]",
                                    )}
                                    title={
                                      el.isLocked
                                        ? "Unlock editing"
                                        : "Lock editing"
                                    }
                                  >
                                    {el.isLocked ? (
                                      <Lock className="w-4 h-4" />
                                    ) : (
                                      <Unlock className="w-4 h-4" />
                                    )}
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      updateElement(el.id, {
                                        isHidden: !el.isHidden,
                                      });
                                    }}
                                    className="w-7 h-7 flex items-center justify-center rounded-md transition-colors hover:bg-gray-100 text-gray-500 hover:text-[#1A1A1A]"
                                    title={el.isHidden ? "Show layer" : "Hide layer"}
                                  >
                                    {el.isHidden ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                  </button>
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      removeElement(el.id);
                                    }}
                                    className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-red-500 hover:text-red-600 hover:bg-red-50"
                                    title="Delete layer"
                                  >
                                    <Trash2 className="w-4 h-4" />
                                  </button>
                                </div>

                                {/* Input in the middle */}
                                <div className="w-full flex items-center justify-center mt-3">
                                  <input
                                    value={el.name || ""}
                                    onChange={(e) =>
                                      updateElement(el.id, {
                                        name: e.target.value,
                                      })
                                    }
                                    onClick={(e) => e.stopPropagation()}
                                    onPointerDown={(e) => e.stopPropagation()}
                                    placeholder={isBoard ? "Board" : defaultName}
                                    className={cn(
                                      "text-center truncate text-sm font-bold tracking-wide bg-transparent border-none outline-none focus:ring-0 focus:outline-none w-[90%] px-1 transition-colors",
                                      selectedId === el.id
                                        ? "text-[#1A1A1A]"
                                        : "text-gray-700",
                                      "pointer-events-auto"
                                    )}
                                  />
                                </div>
                            </motion.div>
                          );
                        })}

                      {!currentLayerView && (
                        <div
                          className={cn(
                            "col-span-2 p-2 aspect-[2/1] uppercase tracking-wider rounded-xl cursor-pointer transition-all relative flex flex-col justify-center items-center group",
                            dragOverLayerId === 'main-board'
                              ? "bg-blue-50 border-[3px] border-blue-400 shadow-md transform scale-[1.02] z-20"
                                : (!selectedId || (selectedId.startsWith("main-board") && !isMainBoardSelected))
                                  ? "bg-white text-[#1A1A1A] border-[3px] border-gray-400 shadow-sm z-10"
                                  : "bg-white text-gray-500 border-[3px] border-gray-200 hover:text-[#1A1A1A] hover:border-gray-300 shadow-sm",
                          )}
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedId(null);
                            setIsMainBoardSelected(true);
                          }}

                        >
                          <span
                            className={cn(
                              "text-center truncate text-sm font-bold tracking-wide uppercase px-1",
                              !selectedId || isMainBoardSelected
                                ? "text-[#1A1A1A]"
                                : "text-gray-700",
                            )}
                          >
                            Main Board
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="shrink-0 bg-white px-2 pb-2">
                      {renderMenuSettingsBlock("layers", false, true)}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>

            <button
              {...toolbarItemProps("save")}
              onClick={() => {
                closeAllDropdowns();
                setShowBoardSaveModal(true);
              }}
              className={toolbarItemClass(
                "save",
                "px-3 py-2 text-xs font-bold rounded-lg hover:bg-gray-200 text-zinc-700 transition-colors flex items-center justify-center gap-1.5 shrink-0",
              )}
              title="Save board"
            >
              <Download className="w-4 h-4" />
              <span className="hidden sm:inline">Save</span>
            </button>
          </div>
        </div>
        {toolbarCustomizeMode &&
          toolbarDragId &&
          toolbarDragStatus &&
          !toolbarDragStatus.inside && (
            <div
              className="fixed z-[9999] pointer-events-none flex items-center justify-center w-8 h-8 rounded-full bg-red-50 border-2 border-red-400 text-red-600 shadow-lg"
              style={{
                left: toolbarDragStatus.x + 12,
                top: toolbarDragStatus.y + 12,
              }}
            >
              <Lock className="w-4 h-4" />
            </div>
          )}
        {toolbarCustomizeMode && (
          <button
            type="button"
            onClick={() => {
              commitToolbarPreview();
              setToolbarCustomizeMode(false);
            }}
            className="absolute left-1/2 top-full mt-2 z-[200] -translate-x-1/2 rounded-lg border-2 border-gray-400 bg-white px-4 py-1.5 text-[11px] font-bold uppercase tracking-wider text-gray-700 shadow-sm hover:bg-gray-50"
          >
            Finish
          </button>
        )}
      </header>

      {/* Main Workspace Area with Paint-like resizable board */}
      <div className="flex-1 flex overflow-hidden relative">
        <div
          className="workspace-scroll flex-1 relative overflow-auto select-none"
          ref={containerRef}
          style={{
            cursor:
              activeTool === "pan"
                ? isInteracting
                  ? "grabbing"
                  : "grab"
                : activeTool === "board"
                  ? "crosshair"
                  : "default",
          }}
          onClick={(e) => {
            if (
              e.target === e.currentTarget ||
              (e.target as HTMLElement).id === "workspace-bg"
            ) {
              if (
                activeTool !== "link" ||
                !getEffectiveToolMenuSettings("link").alwaysOnTop
              ) {
                setSelectedId(null);
              }
              setIsMainBoardSelected(false);
            }
          }}
          onPointerDown={(e) => {
            const target = e.target as HTMLElement;
            const isWorkspaceSurface = target.id === "workspace-bg";
            if (activeTool === "board" && e.button === 0 && isWorkspaceSurface) {
              const rect = boardSurfaceRef.current?.getBoundingClientRect();
              if (!rect) return;
              const x = snap((e.clientX - rect.left) / zoom);
              const y = snap((e.clientY - rect.top) / zoom);
              setSelectedId(null);
              setIsMainBoardSelected(false);
              captureSurfacePointer(e);
              beginAreaGesture({ x, y }, e.pointerId, activeTool);
              setIsInteracting(true);
              return;
            }
            if (e.button === 1) {
              // Middle click always pans
              e.preventDefault();
              captureSurfacePointer(e);
              setIsInteracting(true);
              setPanStart({ x: e.clientX, y: e.clientY });
              return;
            }
            if (
              e.target === e.currentTarget ||
              target.id === "workspace-bg" ||
              target.classList.contains("m-12") ||
              target.classList.contains("board-wrapper")
            ) {
              setIsMainBoardSelected(false);
              if (
                activeTool !== "link" ||
                !getEffectiveToolMenuSettings("link").alwaysOnTop
              ) {
                setSelectedId(null);
              }
            }
            if (activeTool === "pan") {
              e.preventDefault();
              captureSurfacePointer(e);
              setIsInteracting(true);
              setPanStart({ x: e.clientX, y: e.clientY });
            } else {
              // Only proxy handlePointerDown if it's the board surface itself that we clicked on.
              // But if activeTool is pan, we handle it everywhere inside containerRef
            }
          }}
        >
          <div
            id="workspace-bg"
            className="relative transition-all"
            style={{
              width: workspaceDimensions.width,
              height: workspaceDimensions.height,
              backgroundImage: showWorkspaceGrid
                ? `linear-gradient(to right, ${workspaceGridColor} ${workspaceGridThickness}px, transparent ${workspaceGridThickness}px), linear-gradient(to bottom, ${workspaceGridColor} ${workspaceGridThickness}px, transparent ${workspaceGridThickness}px)`
                : "none",
              backgroundSize: `${workspaceGridSize}px ${workspaceGridSize}px`,
            }}
          >
            <div
              className="absolute bg-white shadow-[0_0_20px_rgba(0,0,0,0.05)]"
              style={{
                left: boardPosition.x,
                top: boardPosition.y,
                width: pageDimensions.width * zoom,
                height: pageDimensions.height * zoom,
              }}
            >
              {elements.some(
                (element) =>
                  element.isEraser &&
                  elementHierarchy.isVisible(element.id, respectLayerVisibility),
              ) || (currentDrawPoints && activeTool === 'eraser' && eraserMode === 'partial') ? (
                <svg width="0" height="0" style={{ position: 'absolute' }}>
                  <defs>
                    <mask id="global-eraser-mask" maskUnits="userSpaceOnUse" x={maskMinX} y={maskMinY} width={maskWidth} height={maskHeight}>
                      <rect x={maskMinX} y={maskMinY} width={maskWidth} height={maskHeight} fill="white" />
                      {elements.filter(
                        (element) =>
                          element.isEraser &&
                          elementHierarchy.isVisible(
                            element.id,
                            respectLayerVisibility,
                          ),
                      ).map(el => (
                         <path key={el.id} d={getSvgPathFromPoints(el.points || [], el.isSmooth, el.drawingAssistSmoothStrength ?? 5)} fill="none" stroke="black" strokeWidth={el.borderWidth || 20} strokeLinecap={el.eraserShape === 'square' ? 'square' : 'round'} strokeLinejoin={el.eraserShape === 'square' ? 'miter' : 'round'} transform={'translate(' + el.position.x + ', ' + el.position.y + ')'} />
                      ))}
                      {currentDrawPoints && activeTool === 'eraser' && eraserMode === 'partial' && (
                         <path d={getSvgPathFromPoints(currentDrawPoints, false, 5)} fill="none" stroke="black" strokeWidth={eraserSize} strokeLinecap={eraserShape === 'square' ? 'square' : 'round'} strokeLinejoin={eraserShape === 'square' ? 'miter' : 'round'} />
                      )}
                    </mask>
                  </defs>
                </svg>
              ) : null}
              <div
                ref={boardSurfaceRef}
                tabIndex={-1}
                aria-label="Board canvas"
                data-board-root="true"
                className="absolute top-0 left-0 touch-none select-none outline-none"
                style={{
                  width: pageDimensions.width,
                  height: pageDimensions.height,
                  transform: `scale(${zoom})`,
                  transformOrigin: "top left",
                  cursor:
                    activeTool === "pan"
                      ? isInteracting
                        ? "grabbing"
                        : "grab"
                      : "crosshair",
                }}
                onPointerDown={handlePointerDown}
                onPointerDownCapture={startSelectionMove}
                onContextMenu={(e) => e.preventDefault()}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
                onDropCapture={event => {
                  const files=Array.from<File>(event.dataTransfer.files);
                  if(!files.length)return;
                  const target=(event.target as HTMLElement).closest('[data-board-element-id]');
                  const element=elementsRef.current.find(item=>item.id===target?.getAttribute('data-board-element-id'));
                  // A single supported file dropped on its media field replaces
                  // that field. Other targets and multi-file drops use the board.
                  if(files.length===1 && (element?.type==='media'&&isSupportedMediaMime(inferFileMime(files[0])) || element?.type==='image'&&inferFileMime(files[0]).startsWith('image/')))return;
                  void handleBoardFileDrop(event);
                }}
                onDrop={handleBoardFileDrop}
              >
                <div
                  className="absolute inset-0 overflow-visible pointer-events-none"
                  data-board-surface="true"
                >
                {(outlineSelection.enabled||activeTool==='eyedropper')&&<div data-selection-tool={activeTool} className="absolute cursor-crosshair touch-none pointer-events-auto" style={{left:-boardPosition.x/zoom,top:-boardPosition.y/zoom,width:workspaceDimensions.width/zoom,height:workspaceDimensions.height/zoom,zIndex:100000}}
                  onDoubleClick={event=>{if(activeTool==='polygon-select'&&outlineSelection.points.length>=3){event.preventDefault();event.stopPropagation();outlineSelection.finish();}}}/>}
                {outlineSelection.points.length>0&&<svg className="pointer-events-none absolute inset-0 overflow-visible" data-selection-outline={activeTool} style={{width:pageDimensions.width,height:pageDimensions.height,zIndex:100001}}>
                  <path d={`M${outlineSelection.outline.map(point=>`${point.x},${point.y}`).join(' L')} Z`} fill="rgba(59,130,246,.08)" stroke="#3b82f6" strokeWidth={1.5/zoom} strokeDasharray={`${5/zoom} ${4/zoom}`} fillRule="evenodd"/>
                  {activeTool==='polygon-select'&&outlineSelection.points.map((point,index)=><circle key={index} cx={point.x} cy={point.y} r={(index===0?4:2.5)/zoom} fill="white" stroke="#3b82f6" strokeWidth={1.5/zoom}/>)}
                </svg>}
                {selectionBounds&&<div ref={selectionOutlineRef} data-multi-selection={selectedIds.length} className="pointer-events-none absolute border border-dashed border-blue-500" style={{left:selectionBounds.x,top:selectionBounds.y,width:selectionBounds.width,height:selectionBounds.height,zIndex:100001}}/>}
                <SmartGuidesOverlay ref={guidesOverlayRef} zoom={zoom} width={pageDimensions.width} height={pageDimensions.height}/>
                {/* Main Board Visual Background */}
                  <div
                    id="main-board"
                    className={cn(
                      "absolute inset-0 pointer-events-auto",
                      mainBoardHidden && "hidden",
                      isMainBoardSelected && "ring-2 ring-blue-500 ring-inset",
                    )}
                    style={{
                      zIndex: -9999,
                      boxShadow: "0 0 0 1px rgba(0,0,0,0.5)",
                      ...boardSurfaceStyle(mainSurface, { showGrid, gridColor, gridSize, gridThickness }),
                  }}
                />
                <div className="absolute inset-0 overflow-visible pointer-events-none" style={eraserMaskStyle} data-board-surface="true">
                {/* Active drag region */}
                {activeTool !== "draw" &&
                  activeTool !== "pan" &&
                  activeTool !== "eraser" &&
                  activeTool !== "board" &&
                  dragStart &&
                  dragCurrent &&
                  isHoldingToCreate && (
                    <div
                      className="absolute pointer-events-none z-[100]"
                      style={{ left: 0, top: 0 }}
                    >
                      {(() => {
                        let minX = Math.min(dragStart.x, dragCurrent.x);
                        let minY = Math.min(dragStart.y, dragCurrent.y);
                        let w = Math.abs(dragCurrent.x - dragStart.x);
                        let h = Math.abs(dragCurrent.y - dragStart.y);

                        if (activeTool === "select") {
                          const selectionRect = getMinimumAreaRect(
                            dragStart,
                            dragCurrent,
                            gridSize,
                            activeSurfaceBoundsRef.current ?? undefined,
                          );
                          minX = selectionRect.x;
                          minY = selectionRect.y;
                          w = selectionRect.w;
                          h = selectionRect.h;
                        }

                        if (activeTool !== "select") {
                          if (w < gridSize) {
                            w = gridSize;
                            minX =
                              dragCurrent.x < dragStart.x
                                ? dragStart.x - gridSize
                                : dragStart.x;
                          }
                          if (h < gridSize) {
                            h = gridSize;
                            minY =
                              dragCurrent.y < dragStart.y
                                ? dragStart.y - gridSize
                                : dragStart.y;
                          }
                        }

                        if (activeTool === "arrow" || activeTool === "line") {
                          if (getActiveToolMenuSettings().previewMode === "box") {
                            return (
                              <div
                                className="absolute border-[1.5px] border-blue-500 bg-blue-500/10 pointer-events-none"
                                style={{
                                  left: Math.min(dragStart.x, dragCurrent.x),
                                  top: Math.min(dragStart.y, dragCurrent.y),
                                  width: Math.max(
                                    1,
                                    Math.abs(dragCurrent.x - dragStart.x),
                                  ),
                                  height: Math.max(
                                    1,
                                    Math.abs(dragCurrent.y - dragStart.y),
                                  ),
                                }}
                              />
                            );
                          }

                          const dx = dragCurrent.x - dragStart.x;
                          const dy = dragCurrent.y - dragStart.y;
                          const rawDistance = Math.sqrt(dx * dx + dy * dy);

                          let distance = Math.max(rawDistance, gridSize);
                          let angle = Math.atan2(dy, dx) * (180 / Math.PI);
                          if (snapToGrid) {
                            angle = Math.round(angle / 45) * 45;
                            distance = Math.max(
                              gridSize,
                              Math.round(distance / gridSize) * gridSize,
                            );
                          }

                          const rad = angle * (Math.PI / 180);
                          const endX = dragStart.x + Math.cos(rad) * distance;
                          const endY = dragStart.y + Math.sin(rad) * distance;
                          let cx = (dragStart.x + endX) / 2;
                          let cy = (dragStart.y + endY) / 2;

                          const previewElement = {
                            id: "preview",
                            type: activeTool,
                            position: { x: cx - distance / 2, y: cy - 20 },
                            size: { width: distance, height: 40 },
                            rotation: Math.round(angle),
                            borderColor: pendingProps.borderColor || "#000000",
                            borderWidth: pendingProps.borderWidth || 4,
                          };
                          return (
                            <div
                              style={{
                                position: "absolute",
                                clipPath: creationClip({ x: previewElement.position.x, y: previewElement.position.y, w: previewElement.size.width, h: previewElement.size.height }, angle),
                                left: previewElement.position.x,
                                top: previewElement.position.y,
                                width: Math.max(1, previewElement.size.width),
                                height: Math.max(1, previewElement.size.height),
                                transform: `rotate(${angle}deg)`,
                                transformOrigin: "center center",
                              }}
                            >
                              <ElementVisuals
                                element={previewElement as BoardElement}
                                onUpdate={() => {}}
                                isSelected={true}
                              />
                            </div>
                          );
                        }

                        if (activeTool !== "select") {
                          const clipped = getClippedRect(
                            overlapMode,
                            activeTool as string,
                            dragStart,
                            dragCurrent,
                            elements,
                            gridSize,
                            pageDimensions,
                            activeSurfaceBoundsRef.current ?? undefined,
                          );
                          if (!clipped) return null;

                          if (getActiveToolMenuSettings().previewMode === "box") {
                            return (
                              <div
                                className="absolute border-[1.5px] border-blue-500 bg-blue-500/10 pointer-events-none"
                                style={{
                                  left: clipped.x,
                                  top: clipped.y,
                                  width: clipped.w,
                                  height: clipped.h,
                                  clipPath: creationClip(clipped),
                                }}
                              />
                            );
                          } else {
                            const previewElement = {
                              id: "preview",
                              type: activeTool,
                              position: { x: clipped.x, y: clipped.y },
                              size: { width: clipped.w, height: clipped.h },
                              borderColor:
                                pendingProps.borderColor || "#000000",
                              borderWidth:
                                activeTool === "triangle"
                                  ? pendingProps.borderWidth !== undefined
                                    ? pendingProps.borderWidth
                                    : 2
                                  : pendingProps.borderWidth || 4,
                              content:
                                TEXT_TYPES.includes(activeTool) ||
                                activeTool === "sticky"
                                  ? "Text"
                                  : "",
                              fontSize: pendingProps.fontSize,
                              textAlign: pendingProps.textAlign,
                              fontWeight: pendingProps.fontWeight,
                              color:
                                pendingProps.color ||
                                (TEXT_TYPES.includes(activeTool)
                                  ? "transparent"
                                  : "#ffffff"),
                            };
                            return (
                              <div
                                className="pointer-events-none"
                                style={{
                                  position: "absolute",
                                  clipPath: creationClip({ x: previewElement.position.x, y: previewElement.position.y, w: previewElement.size.width, h: previewElement.size.height }),
                                  left: previewElement.position.x,
                                  top: previewElement.position.y,
                                  width: Math.max(1, previewElement.size.width),
                                  height: Math.max(
                                    1,
                                    previewElement.size.height,
                                  ),
                                }}
                              >
                                <ElementVisuals
                                  element={previewElement as BoardElement}
                                  onUpdate={() => {}}
                                  allowEditing={false}
                                />
                              </div>
                            );
                          }
                        }

                        if (activeTool === "select") {
                          return (
                            <div
                              data-selection-region="active"
                              className="absolute border-[1.5px] border-blue-500 bg-blue-500/10 pointer-events-none"
                              style={{
                                left: minX,
                                top: minY,
                                width: w,
                                height: h,
                              }}
                            />
                          );
                        }

                        return null;
                      })()}
                    </div>
                  )}

                {/* Quick Add Region Preview Outline */}
                {quickAddRegion && (
                  <div
                    data-selection-region="committed"
                    className="absolute border-[1.5px] border-blue-500 bg-blue-500/10 pointer-events-none"
                    style={{
                      left: quickAddRegion.x,
                      top: quickAddRegion.y,
                      width: quickAddRegion.w,
                      height: quickAddRegion.h,
                    }}
                  />
                )}

                {elements
                  .filter((el) => {
                    if (
                      !elementHierarchy.isVisible(
                        el.id,
                        respectLayerVisibility,
                      )
                    ) return false;
                    if (el.isEraser) return false;
                    if (el.type === "board") return false;
                    if (el.type === "layer" && selectedId !== el.id)
                      return false;
                    return true;
                  })
                  .sort(elementHierarchy.compare)
                  .map((el, renderIndex) => (
                    <MemoizedBoardElementNode
                      key={el.id}
                      element={el}
                      isGroupMember={isMergedGroupMember(el,elementHierarchy)}
                      renderZIndex={renderIndex + 1}
                      matchingToolEditing={getActiveToolMenuSettings().allowEditing ?? false}
                      matchingToolMoving={getActiveToolMenuSettings().allowMoving ?? false}
                      allowEditing={
                        allowEditing && !elementHierarchy.isLocked(el.id)
                      }
                      isInteractionLocked={elementHierarchy.isLocked(el.id)}
                      allowMovingElementsInPan={allowMovingElementsInPan}
                      isBoardResizeEnabled={isBoardResizeEnabled}
                      isBoardMoveEnabled={isBoardMoveEnabled}
                      isSelectMode={
                        activeTool === "select" ||
                        activeTool === "pan" ||
                        activeTool === "board"
                      }
                      activeTool={activeTool}
                      isSelected={selectedIds.includes(el.id)}
                      isGroupSelected={selectedIds.length > 1 && selectedIds.includes(el.id)}
                      manualLinkSourceId={manualLinkSourceId}
                      onSelect={() => {
                        if (pickingObjectPresetId) {
                          pickObjectForPreset(pickingObjectPresetId, el);
                          return;
                        }
                        if ((window as any).justLinkedElement) {
                          return;
                        }
                        if (
                          manualLinkSourceId &&
                          manualLinkSourceId !== el.id
                        ) {
                          let updatedElements = [...elements];
                          if (!el.isLinkTarget) {
                            updatedElements = updatedElements.map((e) =>
                              e.id === el.id
                                ? {
                                    ...e,
                                    isLinkTarget: true,
                                    linkTargetName: `${e.type} ${e.id.slice(0, 4)}`,
                                  }
                                : e,
                            );
                          }
                          if (linkSystemMode === "fragmenting") {
                            setTextLinkTarget(el.id);
                            pushElements(updatedElements);
                          } else {
                            updatedElements = updatedElements.map((e) =>
                              e.id === manualLinkSourceId
                                ? { ...e, linkToId: el.id }
                                : e,
                            );
                            pushElements(updatedElements);
                          }
                          setManualLinkSourceId(null);
                          setShowTargetDropdown(false);
                          (window as any).justLinkedElement = true;
                          setTimeout(() => {
                            (window as any).justLinkedElement = false;
                          }, 300);
                          return;
                        }
                        if (selectedId !== el.id) {
                          setSelectedId(el.id);
                          setShowLinkInput(false);
                          setShowTargetInput(false);
                          setLinkSystemMode("start");
                          if (autoToolOnSelect && activeTool === "select") {
                            setActiveTool(toolForSelectedElement(el));
                          }
                        }
                      }}
                      onUpdate={(updates, skipHistory) =>
                        updateElement(el.id, updates, skipHistory)
                      }
                      onJumpToTarget={jumpToElement}
                      onTextSelect={(range, originalElId) => {
                        setSavedRange(range);
                        setSelectedId(originalElId || null);
                        if (activeTool !== "text" && activeTool !== "link")
                          setActiveTool("text");
                      }}
                      onLinkEdit={(targetId) => {
                        setSelectedId(el.id);
                        setLinkSystemMode("fragmenting");
                        setTextLinkTarget(targetId);
                        if (activeTool !== "link") {
                          setActiveTool("link");
                        }
                      }}
                      snap={snap}
                      proportionalScale={proportionalScale}
                      globalPreviewMode={getActiveToolMenuSettings().previewMode}
                      zoomRef={zoomRef}
                      sceneHierarchy={elementHierarchy}
                      onBoardResizeStart={beginSecondaryBoardResize}
                      onSmartMove={updateSmartGuides}
                      onGuidesEnd={()=>setVisibleGuides([])}
                      highlightAll={highlightAll}
                      overlapMode={overlapMode}
                      elements={elements}
                      spinSnapEnabled={spinSnapEnabled}
                      spinSnapDegrees={spinSnapDegrees}
                      showGrid={showGrid}
                      gridColor={gridColor}
                      gridSize={gridSize}
                      gridThickness={gridThickness}
                      pageDimensions={pageDimensions}
                      altResizeCrops={altResizeCrops}
                      isAltKeyDown={isAltKeyDown}
                      onContextMenu={(e) => {
                        setContextMenuPos({
                          x: e.clientX,
                          y: e.clientY,
                        });
                        if (TEXT_TYPES.includes(el.type)) {
                          // do nothing
                        }
                      }}
                    />
                  ))}

                {/* Draw Path Preview */}
                {activeTool === "draw" &&
                  currentDrawPoints &&
                  currentDrawPoints.length > 0 && (
                    <svg
                      className="absolute inset-0 pointer-events-none overflow-visible"
                      style={{
                        width: pageDimensions.width,
                        height: pageDimensions.height,
                        zIndex: 10000,
                      }}
                    >
                      <path style={{ clipPath: strokePreviewClip }}
                        d={getSvgPathFromPoints(
                          currentDrawPoints,
                          pendingProps.isSmooth &&
                            pendingProps.drawingAssistSmooth !== false,
                          pendingProps.drawingAssistSmoothStrength ?? 5,
                        )}
                        fill="none"
                        stroke={pendingProps.borderColor || "#000000"}
                        strokeWidth={pendingProps.borderWidth || 4}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}

                </div>
                </div>

                {elements
                  .filter((el) => {
                    if (el.type !== "board") return false;
                    return elementHierarchy.isVisible(
                      el.id,
                      respectLayerVisibility,
                    );
                  })
                  .sort(elementHierarchy.compare)
                  .map((el, renderIndex) => (
                    <MemoizedBoardElementNode
                      key={el.id}
                      element={el}
                      isGroupMember={isMergedGroupMember(el,elementHierarchy)}
                      renderZIndex={-5000 + renderIndex}
                      matchingToolEditing={getActiveToolMenuSettings().allowEditing ?? false}
                      matchingToolMoving={getActiveToolMenuSettings().allowMoving ?? false}
                      allowEditing={
                        allowEditing && !elementHierarchy.isLocked(el.id)
                      }
                      isInteractionLocked={elementHierarchy.isLocked(el.id)}
                      allowMovingElementsInPan={allowMovingElementsInPan}
                      isBoardResizeEnabled={isBoardResizeEnabled}
                      isBoardMoveEnabled={isBoardMoveEnabled}
                      isSelectMode={
                        activeTool === "select" ||
                        activeTool === "pan" ||
                        activeTool === "board"
                      }
                      activeTool={activeTool}
                      isSelected={selectedIds.includes(el.id)}
                      isGroupSelected={selectedIds.length > 1 && selectedIds.includes(el.id)}
                      manualLinkSourceId={manualLinkSourceId}
                      onSelect={() => {
                        if (pickingObjectPresetId) {
                          pickObjectForPreset(pickingObjectPresetId, el);
                          return;
                        }
                        setSelectedId(el.id);
                        if (autoToolOnSelect && activeTool === "select") {
                          setActiveTool(toolForSelectedElement(el));
                        }
                        setIsMainBoardSelected(false);
                        setShowLinkInput(false);
                        setShowTargetInput(false);
                        setLinkSystemMode("start");
                      }}
                      onUpdate={(updates, skipHistory) =>
                        updateElement(el.id, updates, skipHistory)
                      }
                      onJumpToTarget={jumpToElement}
                      onTextSelect={(range, originalElId) => {
                        setSavedRange(range);
                        setSelectedId(originalElId || null);
                        if (activeTool !== "text" && activeTool !== "link")
                          setActiveTool("text");
                      }}
                      onLinkEdit={(targetId) => {
                        setSelectedId(el.id);
                        setLinkSystemMode("fragmenting");
                        setTextLinkTarget(targetId);
                        if (activeTool !== "link") {
                          setActiveTool("link");
                        }
                      }}
                      snap={snap}
                      proportionalScale={proportionalScale}
                      globalPreviewMode={getActiveToolMenuSettings().previewMode}
                      zoomRef={zoomRef}
                      sceneHierarchy={elementHierarchy}
                      onBoardResizeStart={beginSecondaryBoardResize}
                      onSmartMove={updateSmartGuides}
                      onGuidesEnd={()=>setVisibleGuides([])}
                      highlightAll={highlightAll}
                      overlapMode={overlapMode}
                      elements={elements}
                      spinSnapEnabled={spinSnapEnabled}
                      spinSnapDegrees={spinSnapDegrees}
                      showGrid={showGrid}
                      gridColor={gridColor}
                      gridSize={gridSize}
                      gridThickness={gridThickness}
                      pageDimensions={pageDimensions}
                      altResizeCrops={altResizeCrops}
                      isAltKeyDown={isAltKeyDown}
                      onContextMenu={(e) => {
                        setContextMenuPos({
                          x: e.clientX,
                          y: e.clientY,
                        });
                      }}
                    />
                  ))}

                {activeTool === "board" && dragStart && dragCurrent && isHoldingToCreate && (
                  <div
                    data-new-board-preview="true"
                    className="absolute pointer-events-none border-[1.5px] border-blue-500 bg-blue-500/10 z-[120]"
                    style={{
                      left: Math.min(dragStart.x, dragCurrent.x),
                      top: Math.min(dragStart.y, dragCurrent.y),
                      width:
                        Math.abs(dragCurrent.x - dragStart.x) || 360,
                      height:
                        Math.abs(dragCurrent.y - dragStart.y) || 220,
                    }}
                  />
                )}

                {/* Resize Handles for Main Board */}
                {isBoardResizeEnabled &&
                  (isMainBoardSelected || activeTool === "select") && (
                  <>
                    <div
                      className={cn("absolute right-[-10px] top-1/2 -mt-2.5 w-5 h-5 bg-white border-2 border-gray-500 cursor-e-resize z-[100000] hover:bg-blue-500", !isMainBoardSelected && "pointer-events-none opacity-0")}
                      data-main-board-resize="right"
                      onPointerDown={(e) => beginMainBoardResize(e, "right")}
                    />
                    <div
                      className={cn("absolute left-[-10px] top-1/2 -mt-2.5 w-5 h-5 bg-white border-2 border-gray-500 cursor-w-resize z-[100000] hover:bg-blue-500", !isMainBoardSelected && "pointer-events-none opacity-0")}
                      data-main-board-resize="left"
                      onPointerDown={(e) => beginMainBoardResize(e, "left")}
                    />
                    <div
                      className={cn("absolute top-[-10px] left-1/2 -ml-2.5 w-5 h-5 bg-white border-2 border-gray-500 cursor-n-resize z-[100000] hover:bg-blue-500", !isMainBoardSelected && "pointer-events-none opacity-0")}
                      data-main-board-resize="top"
                      onPointerDown={(e) => beginMainBoardResize(e, "top")}
                    />
                    <div
                      className={cn("absolute bottom-[-10px] left-1/2 -ml-2.5 w-5 h-5 bg-white border-2 border-gray-500 cursor-s-resize z-[100000] hover:bg-blue-500", !isMainBoardSelected && "pointer-events-none opacity-0")}
                      data-main-board-resize="bottom"
                      onPointerDown={(e) => beginMainBoardResize(e, "bottom")}
                    />

                    <div
                      className={cn("absolute top-[-10px] left-[-10px] w-5 h-5 bg-white border-2 border-gray-500 cursor-nw-resize z-[100000] hover:bg-blue-500", !isMainBoardSelected && "pointer-events-none opacity-0")}
                      onPointerDown={(e) =>
                        beginMainBoardResize(e, "top-left")
                      }
                    />
                    <div
                      className={cn("absolute top-[-10px] right-[-10px] w-5 h-5 bg-white border-2 border-gray-500 cursor-ne-resize z-[100000] hover:bg-blue-500", !isMainBoardSelected && "pointer-events-none opacity-0")}
                      onPointerDown={(e) =>
                        beginMainBoardResize(e, "top-right")
                      }
                    />
                    <div
                      className={cn("absolute bottom-[-10px] left-[-10px] w-5 h-5 bg-white border-2 border-gray-500 cursor-sw-resize z-[100000] hover:bg-blue-500", !isMainBoardSelected && "pointer-events-none opacity-0")}
                      onPointerDown={(e) =>
                        beginMainBoardResize(e, "bottom-left")
                      }
                    />
                    <div
                      className={cn("absolute bottom-[-10px] right-[-10px] w-5 h-5 bg-white border-2 border-gray-500 cursor-se-resize z-[100000] hover:bg-blue-500", !isMainBoardSelected && "pointer-events-none opacity-0")}
                      onPointerDown={(e) =>
                        beginMainBoardResize(e, "bottom-right")
                      }
                    />
                  </>
                )}

                {/* Move Handle for Main Board */}
                {isBoardMoveEnabled && isMainBoardSelected && (
                  <div
                    className="absolute left-4 top-4 px-2 py-1 bg-blue-500 text-white rounded cursor-move z-50 text-xs font-bold shadow-lg"
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      setBoardDragStart({
                        x: e.clientX,
                        y: e.clientY,
                        startBx: boardPosition.x,
                        startBy: boardPosition.y,
                      });
                    }}
                  >
                    Drag to Move Board
                  </div>
                )}

                {/* Quick Add Menu */}
                <AnimatePresence>
                  {quickAddRegion && (
                    <div className="absolute z-[200]"
                      style={{
                        left: quickAddRegion.x + quickAddRegion.w / 2,
                        top: quickAddRegion.y + quickAddRegion.h + 20 / zoom,
                        transform: `translateX(-50%) scale(${1 / zoom})`,
                        transformOrigin: "top center",
                      }}
                      onPointerDown={(e) => {e.preventDefault();e.stopPropagation();}}
                    >
                    <motion.div initial={{opacity:0,scale:.95}} animate={{opacity:1,scale:1}} exit={{opacity:0,scale:.95}}
                      className="bg-white border-[3px] border-gray-400 rounded-xl shadow-xl p-2 flex gap-2 items-center">
                      <div className="flex gap-1 items-center">
                        <span className="text-xs font-bold text-gray-500 mr-2 ml-1">
                          Add:
                        </span>
                        {QUICK_ADD_TOOLS.map((tool) => (
                          <button
                            key={tool.type}
                            onClick={() => {
                              handleAddRegionElement(
                                tool.type,
                                quickAddRegion,
                                tool.type === "embed"
                                  ? {
                                      ...getWebElementDefaults(pendingProps),
                                      color: "#f8fafc",
                                    }
                                  : undefined,
                              );
                              setQuickAddRegion(null);
                            }}
                            className="p-2 text-gray-600 hover:text-[#1A1A1A] hover:bg-gray-100 rounded-lg transition-colors"
                            title={tool.label}
                          >
                            <tool.icon className="w-5 h-5" />
                          </button>
                        ))}
                        <div className="mx-1 h-6 w-px bg-gray-300" />
                        <button type="button" title="Copy area" onClick={() => void copySelectionToSystem(quickAddRegion)} className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                          <Copy className="w-5 h-5" />
                        </button>
                        <button type="button" title="Paste into area" onClick={() => void pasteSystemClipboard(quickAddRegion)} className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                          <ClipboardPaste className="w-5 h-5" />
                        </button>
                        <button type="button" title="Merge area" onClick={mergeSelectionArea} className="p-2 text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                          <Layers className="w-5 h-5" />
                        </button>
                      </div>
                    </motion.div>
                    </div>
                  )}
                </AnimatePresence>

                {typeof document !== "undefined" &&
                  createPortal(
                    <AnimatePresence>
                      {showObjectPresetsPanel && (
                        <motion.div
                      initial={{ opacity: 0, y: 8, scale: 0.96 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 8, scale: 0.96 }}
                      className="toolbar-dropdown fixed right-8 top-24 z-[500] w-80 max-h-[70vh] overflow-y-auto rounded-2xl border-[3px] border-gray-800 bg-white p-3 shadow-2xl"
                      onPointerDown={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-between border-b-[3px] border-gray-300 pb-2">
                        <div className="flex items-center gap-2">
                          <ClipboardPaste className="w-4 h-4 text-gray-600" />
                          <span className="text-[11px] font-extrabold uppercase tracking-wider text-gray-700">
                            Object Presets
                          </span>
                        </div>
                        <button
                          onClick={() => {
                            setShowObjectPresetsPanel(false);
                            setPickingObjectPresetId(null);
                          }}
                          className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 hover:text-black"
                          title="Close"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="mt-2 rounded-lg border border-gray-200 bg-gray-50 p-1">
                        {renderAlwaysOnTopControl("object-presets")}
                      </div>

                      {pickingObjectPresetId && (
                        <div className="mt-3 rounded-xl border-2 border-blue-200 bg-blue-50 px-3 py-2 text-[11px] font-bold text-blue-700">
                          Pick an object on the board for this preset.
                        </div>
                      )}

                      <button
                        onClick={() =>
                          setObjectPresets((prev) => [
                            ...prev,
                            {
                              id: generateId(),
                              name: `Preset ${prev.length + 1}`,
                            },
                          ])
                        }
                        className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-gray-300 bg-gray-50 px-3 py-2 text-xs font-bold text-gray-700 hover:border-gray-500 hover:bg-gray-100"
                      >
                        <Plus className="w-4 h-4" />
                        Add preset
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          setPresetName(`${page.title || "Custom"} Preset`);
                          setShowSaveModal(true);
                        }}
                        className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border-2 border-blue-200 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:border-blue-400 hover:bg-blue-100"
                      >
                        <Save className="w-4 h-4" />
                        Save board preset
                      </button>

                      <div className="mt-3 flex flex-col gap-2">
                        {objectPresets.map((preset) => (
                          <div
                            key={preset.id}
                            className={cn(
                              "rounded-xl border-2 bg-gray-50 p-2",
                              pickingObjectPresetId === preset.id
                                ? "border-blue-400"
                                : "border-gray-200",
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <input
                                value={preset.name}
                                onChange={(e) =>
                                  setObjectPresets((prev) =>
                                    prev.map((item) =>
                                      item.id === preset.id
                                        ? { ...item, name: e.target.value }
                                        : item,
                                    ),
                                  )
                                }
                                className="min-w-0 flex-1 rounded-lg border-2 border-gray-200 bg-white px-2 py-1 text-xs font-bold text-gray-700 outline-none focus:border-blue-400"
                              />
                              <button
                                onClick={() =>
                                  setObjectPresets((prev) =>
                                    prev.filter((item) => item.id !== preset.id),
                                  )
                                }
                                className="rounded-lg border-2 border-red-200 bg-red-50 p-1.5 text-red-600 hover:bg-red-100"
                                title="Delete preset"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                              <button
                                className={cn(
                                  "rounded-lg border-2 p-1.5",
                                  preset.element
                                    ? "border-green-200 bg-green-50 text-green-700"
                                    : "border-gray-200 bg-white text-gray-400",
                                )}
                                title={
                                  preset.element
                                    ? "Preset has an object"
                                    : "No object picked"
                                }
                              >
                                <Check className="w-4 h-4" />
                              </button>
                            </div>
                            <button
                              onClick={() => {
                                setPickingObjectPresetId(preset.id);
                                setActiveTool("select");
                              }}
                              className="mt-2 w-full rounded-lg border-2 border-gray-300 bg-white px-3 py-2 text-xs font-bold text-gray-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
                            >
                              {preset.element
                                ? "Pick another object"
                                : "Pick an object"}
                            </button>
                            {preset.element && (
                              <div className="mt-1 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
                                {toTitleCase(preset.element.type)}
                              </div>
                            )}
                          </div>
                        ))}
                      </div>

                      <button
                        onClick={() => {
                          setShowObjectPresetsPanel(false);
                          setPickingObjectPresetId(null);
                        }}
                        className="mt-3 flex w-full items-center justify-center rounded-xl bg-black px-3 py-2 text-white hover:bg-gray-800"
                      >
                        <Check className="w-5 h-5" />
                      </button>
                        </motion.div>
                      )}
                    </AnimatePresence>,
                    document.body,
                  )}

                {/* Link Options Popup */}
                <AnimatePresence>
                  {activeTool === "link" && selectedId && selectedElement && (
                    <div
                      className="absolute z-[250]"
                      style={{
                        left:
                          selectedElement.position.x +
                          (selectedElement.size?.width || 0) / 2,
                        top:
                          selectedElement.position.y +
                          (selectedElement.size?.height || 0) +
                          20,
                        transform: `translateX(-50%) scale(${1 / zoom})`,
                        transformOrigin: "top center",
                      }}
                    >
                      <motion.div
                        initial={{ opacity: 0, scale: 0.95 }}
                        animate={{ opacity: 1, scale: 1 }}
                        exit={{ opacity: 0, scale: 0.95 }}
                        drag
                        dragMomentum={false}
                        dragListener={false}
                        dragControls={linkDragControls}
                        className="bg-white border border-gray-200 rounded-xl shadow-xl min-w-[16rem] w-max max-w-sm flex flex-col"
                        onPointerDown={(e) => e.stopPropagation()}
                      >
                        <div
                          className="flex items-center justify-between p-3 pb-1 cursor-move rounded-t-xl"
                          title="Drag to move"
                          onPointerDown={(e) => {
                            e.stopPropagation();
                            linkDragControls.start(e);
                          }}
                        >
                          <span className="text-[11px] font-extrabold text-black uppercase tracking-wider select-none">
                            LINK
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              setSelectedId(null);
                            }}
                            onPointerDown={(e) => e.stopPropagation()}
                            className="text-gray-500 hover:text-black hover:bg-gray-100 p-1 rounded-md transition-colors"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>

                        <div className="mx-3 border-y border-gray-200 py-1">
                          {renderAlwaysOnTopControl("link")}
                        </div>

                        <div className="px-3 pb-3">
                          {(() => {
                            const isTextLike =
                              selectedElement &&
                              (selectedElement.type === "text" ||
                                selectedElement.type === "h1" ||
                                selectedElement.type === "h2" ||
                                selectedElement.type === "h3" ||
                                selectedElement.type === "sticky" ||
                                selectedElement.type === "bullet-list" ||
                                selectedElement.type === "numbered-list");

                            return (
                              <div className="flex flex-col gap-3">
                                <div className="flex flex-col gap-4 bg-zinc-50 border border-zinc-200 rounded-md p-3 shadow-sm">
                                  <div className="flex flex-col gap-1.5">
                                    <div className="flex items-center justify-center p-1 border border-zinc-300 rounded bg-white w-6 h-6 mb-1">
                                      <Link2 className="w-3.5 h-3.5 text-gray-500" />
                                    </div>
                                    <div className="flex items-center gap-1.5">
                                      <input
                                        type="text"
                                        value={localTargetName}
                                        onChange={(e) =>
                                          setLocalTargetName(e.target.value)
                                        }
                                        onKeyDown={(e) => {
                                          if (e.key === "Enter") {
                                            updateElement(selectedElement.id, {
                                              isLinkTarget: !!localTargetName,
                                              linkTargetName: localTargetName,
                                            });
                                          }
                                          e.stopPropagation();
                                        }}
                                        onPointerDown={(e) => {
                                          e.stopPropagation();
                                        }}
                                        className="text-sm flex-1 py-1.5 px-2 border border-zinc-300 rounded-md outline-none focus:border-zinc-500 font-medium bg-white"
                                        placeholder="Name..."
                                      />
                                      <button
                                        onPointerDown={(e) => {
                                          e.stopPropagation();
                                        }}
                                        onClick={() => {
                                          updateElement(selectedElement.id, {
                                            isLinkTarget: false,
                                            linkTargetName: undefined,
                                          });
                                          setLocalTargetName("");
                                        }}
                                        className="p-1 px-1.5 border border-zinc-300 rounded-md hover:bg-red-50 hover:border-red-300 text-gray-500 hover:text-red-500 transition-colors bg-white"
                                        title="Remove target"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                      <button
                                        onPointerDown={(e) => {
                                          e.stopPropagation();
                                        }}
                                        onClick={(e) => {
                                          updateElement(selectedElement.id, {
                                            isLinkTarget: !!localTargetName,
                                            linkTargetName: localTargetName,
                                          });
                                          const target = e.currentTarget;
                                          target.classList.add(
                                            "!bg-green-50",
                                            "!border-green-500",
                                            "!text-green-600",
                                          );

                                          setTimeout(() => {
                                            if (target)
                                              target.classList.remove(
                                                "!bg-green-50",
                                                "!border-green-500",
                                                "!text-green-600",
                                              );
                                          }, 1500);
                                        }}
                                        className="p-1 px-1.5 border border-zinc-300 rounded-md hover:bg-zinc-100 text-zinc-600 transition-colors bg-white"
                                        title="Save name"
                                      >
                                        <Check className="w-4 h-4" />
                                      </button>
                                    </div>
                                  </div>

                                  <div className="flex flex-col gap-1.5 border-t border-zinc-200 pt-3">
                                    <div className="flex justify-between items-center mb-1">
                                      <div className="flex items-center justify-center p-1 border border-zinc-300 rounded bg-white w-6 h-6">
                                        <div className="relative flex items-center justify-center py-0.5">
                                          <ArrowUpRight className="w-3.5 h-3.5 text-gray-500" />
                                          <Link2 className="w-2.5 h-2.5 absolute -bottom-1 -right-1 text-gray-500" />
                                        </div>
                                      </div>
                                      <div className="flex gap-2 items-center">
                                        <button
                                          onClick={() =>
                                            setManualLinkSourceId(
                                              manualLinkSourceId ===
                                                selectedElement.id
                                                ? null
                                                : selectedElement.id,
                                            )
                                          }
                                          onPointerDown={(e) =>
                                            e.stopPropagation()
                                          }
                                          className={cn(
                                            "text-[10px] font-bold underline leading-none",
                                            manualLinkSourceId ===
                                              selectedElement.id
                                              ? "text-red-500"
                                              : "text-gray-500 hover:text-gray-800",
                                          )}
                                        >
                                          {manualLinkSourceId ===
                                          selectedElement.id
                                            ? "Cancel manual pick"
                                            : "Pick visually"}
                                        </button>
                                      </div>
                                    </div>

                                    <div className="flex gap-2 w-full">
                                      <div
                                        className="relative flex-1"
                                        onPointerDown={(e) => e.stopPropagation()}
                                        onClick={(e) => e.stopPropagation()}
                                      >
                                      <div className="relative flex items-center">
                                        <LinkTargetInput
                                          value={
                                            linkSystemMode === "fragmenting"
                                              ? textLinkTarget ?? undefined
                                              : selectedElement.linkToId
                                          }
                                          displayValue={(() => {
                                            const currentValue =
                                              linkSystemMode === "fragmenting"
                                                ? textLinkTarget
                                                : selectedElement.linkToId;
                                            const targetElement = elements.find(
                                              (element) => element.id === currentValue,
                                            );
                                            return targetElement
                                              ? targetElement.linkTargetName ||
                                                  `${targetElement.type} ${targetElement.id.slice(0, 4)}`
                                              : currentValue ?? "";
                                          })()}
                                          validElementIds={new Set(
                                            elements
                                              .filter(
                                                (element) =>
                                                  element.id !== selectedElement.id,
                                              )
                                              .map((element) => element.id),
                                          )}
                                          allowWebLinks={linkSystemMode !== "fragmenting"}
                                          manualPicking={
                                            manualLinkSourceId === selectedElement.id
                                          }
                                          onFocus={() => setShowTargetDropdown(true)}
                                          onCommit={(value) => {
                                            if (linkSystemMode === "fragmenting") {
                                              setTextLinkTarget(value ?? null);
                                            } else {
                                              updateElement(selectedElement.id, {
                                                linkToId: value,
                                              });
                                            }
                                          }}
                                          className={cn(
                                            "text-xs w-full py-1.5 px-2 pr-6 border-[2px] border-zinc-300 rounded-md outline-none font-bold bg-white hover:border-zinc-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-100 shadow-sm transition-colors",
                                            (
                                              linkSystemMode === "fragmenting"
                                                ? !textLinkTarget
                                                : !selectedElement.linkToId
                                            )
                                              ? "text-gray-400 font-medium"
                                              : "text-zinc-800",
                                          )}
                                        />
                                        <ChevronDown className="w-3 h-3 opacity-60 absolute right-2 pointer-events-none" />
                                      </div>

                                      {showTargetDropdown && (
                                        <div className="absolute top-full left-0 w-full mt-1.5 bg-white border-[2px] border-zinc-200 rounded-md shadow-lg z-50 max-h-[150px] overflow-y-auto">
                                          {elements.filter(
                                            (el) =>
                                              el.id !== selectedElement.id &&
                                              el.isLinkTarget,
                                          ).length === 0 ? (
                                            <div className="px-3 py-2 text-xs text-gray-400 italic">
                                              No targets found
                                            </div>
                                          ) : (
                                            elements
                                              .filter(
                                                (el) =>
                                                  el.id !==
                                                    selectedElement.id &&
                                                  el.isLinkTarget,
                                              )
                                              .map((el) => (
                                                <div
                                                  key={el.id}
                                                  onPointerDown={(e) => {
                                                    e.stopPropagation();
                                                    if (
                                                      linkSystemMode ===
                                                      "fragmenting"
                                                    ) {
                                                      setTextLinkTarget(el.id);
                                                    } else {
                                                      updateElement(
                                                        selectedElement.id,
                                                        { linkToId: el.id },
                                                      );
                                                    }
                                                    setShowTargetDropdown(
                                                      false,
                                                    );
                                                  }}
                                                  onClick={(e) => {
                                                    // Fallback for mobile
                                                    e.stopPropagation();
                                                    if (
                                                      linkSystemMode ===
                                                      "fragmenting"
                                                    ) {
                                                      setTextLinkTarget(el.id);
                                                    } else {
                                                      updateElement(
                                                        selectedElement.id,
                                                        { linkToId: el.id },
                                                      );
                                                    }
                                                    setShowTargetDropdown(
                                                      false,
                                                    );
                                                  }}
                                                  className="px-2 py-1.5 hover:bg-zinc-100 text-xs font-semibold text-zinc-700 cursor-pointer border-b border-zinc-100 last:border-0"
                                                >
                                                  {el.linkTargetName ||
                                                    `${el.type} ${el.id.slice(0, 4)}`}
                                                </div>
                                              ))
                                          )}
                                        </div>
                                      )}
                                      </div>
                                      <button
                                        onPointerDown={(e) => {
                                          e.stopPropagation();
                                        }}
                                        onClick={() => {
                                          updateElement(selectedElement.id, {
                                            linkToId: undefined,
                                          });
                                          setTextLinkTarget(null);
                                        }}
                                        className="p-1 border border-zinc-300 rounded-md hover:bg-red-50 hover:border-red-300 text-gray-500 hover:text-red-500 transition-colors bg-white flex items-center justify-center shrink-0"
                                        title="Remove Source Link"
                                      >
                                        <Trash2 className="w-4 h-4" />
                                      </button>
                                      <button onClick={(e) => {
                                         const target = e.currentTarget;
                                         target.classList.add('!bg-green-50', '!border-green-500', '!text-green-600');
                                         setTimeout(() => { 
                                            if (target) target.classList.remove('!bg-green-50', '!border-green-500', '!text-green-600');
                                         }, 1500);
                                      }} className="p-1 px-1.5 border border-zinc-300 rounded-md hover:bg-zinc-100 text-gray-500 transition-colors bg-white shrink-0 relative" title="Confirm selection">
                                        <Check className="w-4 h-4" />
                                      </button>
                                    </div>

                                    {isTextLike &&
                                      selectedElement.type !== "sticky" && (
                                        <div className="mt-2 flex flex-col gap-2">
                                          <div className="flex gap-2">
                                            <button
                                              onPointerDown={(e) => {
                                                e.stopPropagation();
                                              }}
                                              onClick={() => {
                                                setLinkSystemMode("whole");
                                                updateElement(
                                                  selectedElement.id,
                                                  {
                                                    linkToId:
                                                      textLinkTarget ||
                                                      undefined,
                                                  },
                                                );
                                              }}
                                              className={cn(
                                                "flex-1 py-1.5 border-[2px] rounded-md text-xs font-bold transition-colors text-center shadow-sm",
                                                linkSystemMode !== "fragmenting"
                                                  ? "border-zinc-800 bg-zinc-100 text-zinc-900"
                                                  : "border-gray-200 bg-white text-gray-500 hover:bg-gray-50",
                                              )}
                                            >
                                              Text Field
                                            </button>
                                            <button
                                              onPointerDown={(e) => {
                                                e.stopPropagation();
                                              }}
                                              onClick={() => {
                                                setLinkSystemMode(
                                                  "fragmenting",
                                                );
                                                setTextLinkTarget(
                                                  selectedElement.linkToId ||
                                                    null,
                                                );
                                                updateElement(
                                                  selectedElement.id,
                                                  { linkToId: undefined },
                                                );
                                              }}
                                              className={cn(
                                                "flex-1 py-1.5 border-[2px] rounded-md text-xs font-bold transition-colors text-center shadow-sm",
                                                linkSystemMode === "fragmenting"
                                                  ? "border-zinc-800 bg-zinc-100 text-zinc-900"
                                                  : "border-gray-200 bg-white text-gray-500 hover:bg-gray-50",
                                              )}
                                            >
                                              Text Fragment
                                            </button>
                                          </div>

                                          {linkSystemMode === "fragmenting" && (
                                            <div className="flex flex-col gap-2 mt-1">
                                              <div className="flex justify-between items-center bg-zinc-50 border border-zinc-200 rounded-md p-1.5 shadow-sm">
                                                <span className="text-[10px] text-gray-500 font-medium px-1">
                                                  Selected text -&gt; Target
                                                </span>
                                                <div className="flex gap-1">
                                                  <button
                                                    onPointerDown={(e) => {
                                                      e.preventDefault();
                                                      e.stopPropagation();
                                                      if (
                                                        savedRange &&
                                                        savedRange.commonAncestorContainer
                                                      ) {
                                                        const editorDiv =
                                                          savedRange
                                                            .commonAncestorContainer
                                                            .nodeType === 3
                                                            ? savedRange.commonAncestorContainer.parentElement?.closest(
                                                                ".content-editable-text",
                                                              )
                                                            : (
                                                                savedRange.commonAncestorContainer as HTMLElement
                                                              ).closest(
                                                                ".content-editable-text",
                                                              );
                                                        if (editorDiv) {
                                                          (
                                                            editorDiv as HTMLElement
                                                          ).focus();
                                                          const sel =
                                                            window.getSelection();
                                                          sel?.removeAllRanges();
                                                          sel?.addRange(
                                                            savedRange,
                                                          );
                                                          document.execCommand(
                                                            "unlink",
                                                            false,
                                                          );
                                                          updateElement(
                                                            selectedElement.id,
                                                            {
                                                              content:
                                                                editorDiv.innerHTML,
                                                            },
                                                          );
                                                        }
                                                      }
                                                    }}
                                                    className="p-1 px-1.5 border border-zinc-300 rounded-md hover:bg-red-50 hover:border-red-300 text-gray-500 hover:text-red-500 transition-colors bg-white shadow-sm flex items-center justify-center"
                                                    title="Remove Link from Selection"
                                                  >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                  </button>
                                                  <button
                                                    onPointerDown={(e) => {
                                                      e.preventDefault();
                                                      e.stopPropagation();
                                                      if (!textLinkTarget)
                                                        return;
                                                      if (
                                                        savedRange &&
                                                        savedRange.commonAncestorContainer
                                                      ) {
                                                        const editorDiv =
                                                          savedRange
                                                            .commonAncestorContainer
                                                            .nodeType === 3
                                                            ? savedRange.commonAncestorContainer.parentElement?.closest(
                                                                ".content-editable-text",
                                                              )
                                                            : (
                                                                savedRange.commonAncestorContainer as HTMLElement
                                                              ).closest(
                                                                ".content-editable-text",
                                                              );
                                                        if (editorDiv) {
                                                          (
                                                            editorDiv as HTMLElement
                                                          ).focus();
                                                          const sel =
                                                            window.getSelection();
                                                          sel?.removeAllRanges();
                                                          sel?.addRange(
                                                            savedRange,
                                                          );
                                                          document.execCommand(
                                                            "createLink",
                                                            false,
                                                            `#target-${textLinkTarget}`,
                                                          );
                                                          const links =
                                                            editorDiv.querySelectorAll(
                                                              `a[href="#target-${textLinkTarget}"]`,
                                                            );
                                                          links.forEach(
                                                            (link) => {
                                                              (
                                                                link as HTMLElement
                                                              ).style.color =
                                                                "#3b82f6";
                                                              (
                                                                link as HTMLElement
                                                              ).style.textDecoration =
                                                                "underline";
                                                              (
                                                                link as HTMLElement
                                                              ).style.cursor =
                                                                "pointer";
                                                            },
                                                          );
                                                          updateElement(
                                                            selectedElement.id,
                                                            {
                                                              content:
                                                                editorDiv.innerHTML,
                                                            },
                                                          );
                                                          const target =
                                                            e.currentTarget;
                                                          target.classList.add(
                                                            "!bg-green-50",
                                                            "!border-green-500",
                                                            "!text-green-600",
                                                          );

                                                          setTimeout(() => {
                                                            if (target)
                                                              target.classList.remove(
                                                                "!bg-green-50",
                                                                "!border-green-500",
                                                                "!text-green-600",
                                                              );
                                                          }, 1500);
                                                        }
                                                      }
                                                    }}
                                                    className="p-1 px-1.5 border border-zinc-300 rounded-md hover:bg-zinc-100 text-gray-500 hover:text-zinc-800 transition-colors bg-white shadow-sm flex items-center justify-center relative"
                                                    title="Confirm Fragment Link"
                                                  >
                                                    <Check className="w-4 h-4" />
                                                  </button>
                                                </div>
                                              </div>
                                            </div>
                                          )}
                                        </div>
                                      )}
                                  </div>
                                </div>
                              </div>
                            );
                          })()}
                        </div>
                      </motion.div>
                    </div>
                  )}
                </AnimatePresence>
              </div>

              {/* Layers Panel moved to header */}
            </div>
          </div>

          {/* Unified Floating Properties Panel */}
          {samplingError&&<div role="alert" className="absolute bottom-24 left-1/2 z-50 flex max-w-lg -translate-x-1/2 items-center gap-3 rounded-xl border border-red-200 bg-white p-3 text-sm text-red-700 shadow-lg">{samplingError}<button type="button" title="Dismiss" onClick={()=>setSamplingError('')}><X className="h-4 w-4"/></button></div>}
          {selectedIds.length>1&&!toolbarEditingMode&&<ToolPropertiesBar key="selection-toolbar">
            <div className="flex h-12 items-center gap-3 px-2 text-xs font-semibold">
              <span role="status">{selectedIds.length} selected</span>
              <button type="button" title="Move selected objects" onClick={()=>setActiveTool('select')} className="rounded-lg border border-gray-300 p-2 hover:bg-blue-50"><Move className="h-4 w-4"/></button>
              <button type="button" title="Copy selected objects" onClick={()=>void copySelectionToSystem()} className="rounded-lg border border-gray-300 p-2 hover:bg-blue-50"><Copy className="h-4 w-4"/></button>
              <button type="button" title="Duplicate selected objects" onClick={duplicateSelection} className="rounded-lg border border-gray-300 p-2 hover:bg-blue-50"><ClipboardPaste className="h-4 w-4"/></button>
              <button type="button" title="Delete selected objects" onClick={removeSelection} className="rounded-lg border border-red-200 p-2 text-red-400 hover:bg-red-50"><Trash2 className="h-4 w-4"/></button>
              <button type="button" title="Clear selection" onClick={()=>setSelectedIds([])} className="rounded-lg border border-blue-200 p-2 text-blue-500 hover:bg-blue-50"><Check className="h-4 w-4"/></button>
            </div>
          </ToolPropertiesBar>}
          {(() => {
            const isAnySelected =
              !!selectedElement &&
              !["board", "checklist"].includes(selectedElement.type);
            const isToolActive =
              !selectedElement &&
              (TEXT_TYPES.includes(activeTool) ||
                SHAPE_TYPES.includes(activeTool) ||
                ["sticky", "draw", "arrow", "line", "image", "media", "embed", "fill"].includes(
                  activeTool,
                ));
            const globalSettingsMenuOpen =
              showMoreToolsDropdown || showZoomSettingsDropdown;
            const showBottomToolbar =
              !toolbarEditingMode &&
              !globalSettingsMenuOpen &&
              (isAnySelected ||
                (isToolActive && activeTool !== "select" && activeTool !== "pan") ||
                (activeTool === "eraser" && !selectedElement));

            if (!showBottomToolbar) return <AnimatePresence />;

            const activeType = selectedElement
              ? selectedElement.type
              : activeTool;
            const targetProps = selectedElement
              ? selectedElement
              : pendingProps;

            const onUpdateTarget = (props: Partial<BoardElement>) => {
              if (selectedElement) {
                updateElement(selectedElement.id, props);
              } else {
                setPendingProps({ ...pendingProps, ...props });
              }
            };
            const defaultsSource: Partial<BoardElement> = selectedElement ?? {
              ...targetProps,
              type: activeType as ElementType,
              ...(activeType === "fill" ? { color: fillToolColor } : {}),
            };

            const isTextLike =
              TEXT_TYPES.includes(activeType) || activeType === "sticky";
            const colors = elementColors(activeType);
            const bottomToolbarGroupClass =
              "flex h-12 min-h-12 shrink-0 items-center gap-3 border-r-2 border-gray-300 pr-3";
            return (
              <AnimatePresence>
                <ToolPropertiesBar key="bottom-toolbar">
                  {activeTool === 'eraser' && !selectedElement && (
                    <div className={bottomToolbarGroupClass}>
                      <SegmentedControl label="Eraser mode" value={eraserMode} onChange={setEraserMode} options={[{ value: 'element', label: 'Whole' }, { value: 'partial', label: 'Partial' }]} />
                      {eraserMode === 'partial' && (
                        <>
                          <div className="flex items-center gap-1.5 px-2 border-l-2 border-gray-200">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Shape</span>
                            <SegmentedControl label="Eraser shape" value={eraserShape} onChange={setEraserShape} options={[{ value: 'round', label: 'Round' }, { value: 'square', label: 'Square' }]} />
                          </div>
                          <div className="flex items-center gap-2 px-2 border-l-2 border-gray-200">
                            <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Size</span>
                            <input type="range" min="2" max="100" value={eraserSize} onChange={(e) => setEraserSize(Number(e.target.value))} className="w-24" />
                            <span className="text-[10px] font-bold text-gray-700">{eraserSize}px</span>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  {activeTool === 'fill' && !selectedElement && (
                    <div className={bottomToolbarGroupClass}>
                      <div className="flex items-center gap-1.5" title="Fill Color">
                        <PaintBucket className="w-5 h-5 text-gray-500" />
                        <ColorPicker
                          value={fillToolColor}
                          onChange={(c) => setFillToolColor(c)}
                          customColors={customColors.fill}
                          onAddCustomColor={(c, i) => handleAddCustomColor(c, i, 'fill')}
                          />
                        </div>
                    </div>
                  )}
                  {/* Text Formatting */}
                  {isTextLike && (
                    <div className={bottomToolbarGroupClass}>
                      <div className="flex gap-1 items-center bg-gray-100 border-[3px] border-gray-300 p-1 rounded-xl">
                        <button
                          onPointerDown={(e) => {
                            e.preventDefault();
                            document.execCommand("formatBlock", false, "H1");
                          }}
                          className="p-2 rounded-lg transition-colors border-2 text-gray-500 hover:bg-white hover:text-[#1A1A1A] border-transparent"
                          title="Heading 1"
                        >
                          <Heading1 className="w-4 h-4" />
                        </button>
                        <button
                          onPointerDown={(e) => {
                            e.preventDefault();
                            document.execCommand("formatBlock", false, "H2");
                          }}
                          className="p-2 rounded-lg transition-colors border-2 text-gray-500 hover:bg-white hover:text-[#1A1A1A] border-transparent"
                          title="Heading 2"
                        >
                          <b className="font-bold text-sm leading-none block px-0.5">
                            H2
                          </b>
                        </button>
                        <button
                          onPointerDown={(e) => {
                            e.preventDefault();
                            document.execCommand("insertUnorderedList");
                          }}
                          className="p-2 rounded-lg transition-colors border-2 text-gray-500 hover:bg-white hover:text-[#1A1A1A] border-transparent"
                          title="Bulleted List"
                        >
                          <List className="w-4 h-4" />
                        </button>
                        <button
                          onPointerDown={(e) => {
                            e.preventDefault();
                            document.execCommand("insertOrderedList");
                          }}
                          className="p-2 rounded-lg transition-colors border-2 text-gray-500 hover:bg-white hover:text-[#1A1A1A] border-transparent"
                          title="Numbered List"
                        >
                          <ListOrdered className="w-4 h-4" />
                        </button>
                        <button
                          onPointerDown={(e) => {
                            e.preventDefault();
                            document.execCommand("formatBlock", false, "P");
                          }}
                          className="p-2 rounded-lg transition-colors border-2 text-gray-500 hover:bg-white hover:text-[#1A1A1A] border-transparent"
                          title="Normal Text (Clear Formatting)"
                        >
                          <Type className="w-4 h-4" />
                        </button>
                        <div className="w-px h-5 bg-gray-300 mx-1" />
                        <button
                          title="Bold"
                          onPointerDown={(e) => {
                            e.preventDefault();
                            document.execCommand("bold", false);
                          }}
                          className="p-2 rounded-lg transition-colors border-2 text-gray-500 hover:bg-white hover:text-[#1A1A1A] border-transparent"
                        >
                          <Bold className="w-4 h-4" />
                        </button>
                        <button
                          title="Italic"
                          onPointerDown={(e) => {
                            e.preventDefault();
                            document.execCommand("italic", false);
                          }}
                          className="p-2 rounded-lg transition-colors border-2 text-gray-500 hover:bg-white hover:text-[#1A1A1A] border-transparent"
                        >
                          <Italic className="w-4 h-4" />
                        </button>
                        <div className="w-px h-5 bg-gray-300 mx-1" />
                        <button
                          title="Align Left"
                          onPointerDown={(e) => {
                            e.preventDefault();
                            onUpdateTarget({ textAlign: "left" });
                          }}
                          className={cn(
                            "p-2 rounded-lg transition-colors border-2",
                            !targetProps.textAlign ||
                              targetProps.textAlign === "left"
                              ? "bg-white text-[#1A1A1A] border-gray-300 shadow-sm"
                              : "text-gray-500 hover:bg-white hover:text-gray-800 border-transparent",
                          )}
                        >
                          <AlignLeft className="w-4 h-4" />
                        </button>
                        <button
                          title="Align Center"
                          onPointerDown={(e) => {
                            e.preventDefault();
                            onUpdateTarget({ textAlign: "center" });
                          }}
                          className={cn(
                            "p-2 rounded-lg transition-colors border-2",
                            targetProps.textAlign === "center"
                              ? "bg-white text-[#1A1A1A] border-gray-300 shadow-sm"
                              : "text-gray-500 hover:bg-white hover:text-gray-800 border-transparent",
                          )}
                        >
                          <AlignCenter className="w-4 h-4" />
                        </button>
                        <button
                          title="Align Right"
                          onPointerDown={(e) => {
                            e.preventDefault();
                            onUpdateTarget({ textAlign: "right" });
                          }}
                          className={cn(
                            "p-2 rounded-lg transition-colors border-2",
                            targetProps.textAlign === "right"
                              ? "bg-white text-[#1A1A1A] border-gray-300 shadow-sm"
                              : "text-gray-500 hover:bg-white hover:text-gray-800 border-transparent",
                          )}
                        >
                          <AlignRight className="w-4 h-4" />
                        </button>
                      </div>
                      <div className="flex gap-2 items-center">
                        <div className="flex bg-gray-100 border-[3px] border-gray-300 rounded-xl p-1 gap-1 items-center">
                          <button
                            onPointerDown={(e) => {
                              e.preventDefault();
                              const isFrame =
                                targetProps.borderWidth !== undefined &&
                                targetProps.borderWidth > 0;
                              onUpdateTarget({
                                borderWidth: isFrame ? undefined : 2,
                                borderColor:
                                  targetProps.borderColor || "#1e293b",
                              });
                            }}
                            className={cn(
                              "p-1.5 rounded-lg transition-colors border-[3px] flex items-center justify-center gap-1.5 px-2 text-gray-500 hover:bg-white hover:text-[#1A1A1A] border-transparent",
                              targetProps.borderWidth !== undefined &&
                                targetProps.borderWidth > 0
                                ? "bg-white border-gray-300 text-gray-800 shadow-sm"
                                : "",
                            )}
                            title="Text Frame"
                          >
                            <Square className="w-4 h-4" />
                          </button>
                          <div className="w-px h-4 bg-gray-300 mx-0.5" />
                          <button
                            onPointerDown={(e) => {
                              e.preventDefault();
                              const snap = targetProps.textSnapToGrid;
                              onUpdateTarget({ textSnapToGrid: !snap });
                            }}
                            className={cn(
                              "p-1.5 rounded-lg transition-colors border-[3px] flex items-center justify-center gap-1.5 px-2 text-gray-500 hover:bg-white hover:text-[#1A1A1A] border-transparent",
                              targetProps.textSnapToGrid
                                ? "bg-white border-gray-300 text-gray-800 shadow-sm"
                                : "",
                            )}
                            title="Toggled-Lines"
                          >
                            <Equal className="w-4 h-4" />
                          </button>
                          {isScalableText(activeType) && <button
                            type="button" title="Text scaling" aria-label="Text scaling" aria-pressed={targetProps.textScaling === true}
                            onPointerDown={event => event.preventDefault()}
                            onClick={() => onUpdateTarget({ textScaling: targetProps.textScaling !== true })}
                            className={cn("flex items-center gap-1.5 rounded-lg border-[3px] border-transparent px-2 py-1.5 text-gray-500 transition-colors hover:bg-white hover:text-[#1A1A1A]", targetProps.textScaling && "bg-white border-gray-300 text-gray-800 shadow-sm")}>
                            <Maximize className="h-4 w-4" /><span className="text-[11px] font-bold">Text scaling</span>
                          </button>}
                          {targetProps.textSnapToGrid && (
                            <>
                              <div className="w-[2px] h-4 bg-gray-300 mx-0.5" />
                              <button
                                onPointerDown={(e) => {
                                  e.preventDefault();
                                  const mode =
                                    targetProps.textLinesMode || "text-only";
                                  onUpdateTarget({
                                    textLinesMode:
                                      mode === "everywhere"
                                        ? "text-only"
                                        : "everywhere",
                                  });
                                }}
                                className="px-2 py-0.5 text-[10px] font-extrabold tracking-wider uppercase text-blue-600 hover:bg-white rounded-md transition-all border border-blue-200 hover:border-blue-400 bg-blue-50/50 leading-none"
                                title="Format: All area vs Text lines only"
                              >
                                {targetProps.textLinesMode === "everywhere"
                                  ? "All"
                                  : "Text"}
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      <div className="w-[3px] h-6 bg-gray-300 mx-1" />
                      <div className="flex gap-2 items-center">
                        <div
                          className="flex items-center gap-1 bg-gray-50 border-[3px] border-gray-300 rounded-xl px-2 py-1 hover:border-gray-400 transition-colors"
                          title="Font Size (px)"
                        >
                          <input
                            type="number"
                            value={targetProps.fontSize !== undefined || getTextScale(targetProps) !== 1 ? displayedTextFontSize(targetProps, activeType).toString() : ""}
                            onKeyDown={(e) => e.stopPropagation()}
                            onPointerDown={(e) => e.stopPropagation()}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              if (!Number.isFinite(v)) {
                                onUpdateTarget({ fontSize: undefined });
                                return;
                              }

                              onUpdateTarget({ fontSize: Math.max(1, Math.min(500, v)) / (isScalableText(activeType) ? getTextScale(targetProps) : 1) });
                            }}
                            placeholder={displayedTextFontSize(targetProps, activeType).toString()}
                            className="bg-transparent text-sm font-bold text-gray-800 outline-none w-10 text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none placeholder:text-gray-400"
                            min="1"
                            max="500"
                          />
                          <span className="text-[11px] uppercase font-bold tracking-wider text-gray-600 select-none">
                            px
                          </span>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Colors */}
                  {(colors.fill || colors.stroke || colors.text) && (
                    <div className={bottomToolbarGroupClass}>
                      {colors.fill && <div
                        className="flex items-center gap-1.5"
                        title="Background / Fill Color"
                      >
                        <Palette className="w-5 h-5 text-gray-500" />
                        <ColorPicker
                          value={
                            targetProps.color || defaultFillColor(activeType)
                          }
                          onChange={(c) => onUpdateTarget({ color: c })}
                          customColors={customColors.bg}
                          onAddCustomColor={(c, i) =>
                            handleAddCustomColor(c, i, "bg")
                          }
                          allowTransparent
                          transparentTitle="Transparent Background"
                        />
                      </div>}
                      {colors.text && (
                        <div
                          className="flex items-center gap-1.5 ml-2"
                          title="Text Color"
                        >
                          <Type className="w-5 h-5 text-gray-500" />
                          <ColorPicker
                            value={targetProps.textColor || "#000000"}
                            onChange={changeTextColor}
                            customColors={customColors.text}
                            onAddCustomColor={(c, i) =>
                              handleAddCustomColor(c, i, "text")
                            }
                          />
                        </div>
                      )}
                      {/* Border Color / Line Color */}
                      {colors.stroke && (!isTextLike ||
                        targetProps.textSnapToGrid ||
                        (targetProps.borderWidth !== undefined &&
                          targetProps.borderWidth > 0)) && (
                        <div
                          className="flex items-center gap-1.5 ml-2"
                          title={
                            isTextLike && !targetProps.textSnapToGrid
                              ? "Frame Color"
                              : isTextLike
                                ? "Line Color"
                              : colors.strokeOnly ? "Stroke Color" : "Border Color"
                          }
                        >
                          {isTextLike && !targetProps.textSnapToGrid ? (
                            <Square className="w-5 h-5 text-gray-500" />
                          ) : isTextLike ? (
                            <div className="flex flex-col gap-[3px] w-5 h-5 items-center justify-center pointer-events-none opacity-60">
                              <div className="w-4 h-[2px] bg-gray-500 rounded-sm" />
                              <div className="w-4 h-[2px] bg-gray-500 rounded-sm" />
                            </div>
                          ) : (
                            <Square className="w-5 h-5 text-gray-500" />
                          )}
                          <ColorPicker
                            value={targetProps.borderColor || "#000000"}
                            onChange={(c) => onUpdateTarget({ borderColor: c })}
                            customColors={customColors.border}
                            onAddCustomColor={(c, i) =>
                              handleAddCustomColor(c, i, "border")
                            }
                            allowTransparent
                            transparentTitle={colors.strokeOnly ? "Transparent Stroke" : "Transparent Border"}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Borders & Details */}
                  {!["embed", "eraser", "media", "image", "fill", "group"].includes(activeType) && !isTextLike && (
                    <div className={bottomToolbarGroupClass}>
                      <div
                        className="flex items-center gap-1.5 bg-gray-50 border-[3px] border-gray-300 rounded-xl px-2 py-1 hover:border-gray-400 transition-colors"
                        title="Border / Line Width"
                      >
                        <span className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">
                          Thickness
                        </span>
                        <input
                          type="number"
                          value={
                            targetProps.borderWidth === undefined
                              ? ""
                              : targetProps.borderWidth
                          }
                          onChange={(e) => {
                            const v = parseInt(e.target.value);
                            onUpdateTarget({
                              borderWidth: isNaN(v) ? undefined : v,
                            });
                          }}
                          placeholder={
                            ["arrow", "line", "draw"].includes(activeType)
                              ? "2"
                              : "0"
                          }
                          className="bg-transparent text-sm font-bold text-gray-800 outline-none w-8 text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none placeholder:text-gray-400"
                          min="0"
                          max="50"
                        />
                        <span className="text-[11px] font-bold tracking-wider text-gray-600 select-none">
                          px
                        </span>
                      </div>

                      {[
                        "rectangle",
                        "image",
                        "media",
                        "section",
                        "board",
                        "sticky",
                      ].includes(activeType) && (
                        <div
                          className="flex items-center gap-1.5 bg-gray-50 border-[3px] border-gray-300 rounded-xl px-2 py-1 hover:border-gray-400 transition-colors"
                          title="Border Radius"
                        >
                          <span className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">
                            Radius
                          </span>
                          <input
                            type="number"
                            value={
                              targetProps.borderRadius === undefined
                                ? ""
                                : targetProps.borderRadius
                            }
                            onChange={(e) => {
                              const v = parseInt(e.target.value);
                              onUpdateTarget({
                                borderRadius: isNaN(v) ? undefined : v,
                              });
                            }}
                            placeholder="0"
                            className="bg-transparent text-sm font-bold text-gray-800 outline-none w-8 text-center [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none placeholder:text-gray-400"
                            min="0"
                            max="100"
                          />
                          <span className="text-[11px] font-bold tracking-wider text-gray-600 select-none">
                            px
                          </span>
                        </div>
                      )}


                    </div>
                  )}

                  {/* Element opacity */}
                  {!["embed", "eraser", "media", "image"].includes(activeType) && (
                    <div className={bottomToolbarGroupClass}>
                      <div
                        className="flex items-center gap-1.5 bg-gray-50 border-[3px] border-gray-300 rounded-xl px-2 py-1 hover:border-gray-400 transition-colors"
                        title="Opacity"
                      >
                        <span className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">
                          Opacity
                        </span>
                        <input
                          type="range"
                          min="0"
                          max="100"
                          value={
                            targetProps.opacity !== undefined
                              ? targetProps.opacity
                              : 100
                          }
                          onChange={(e) =>
                            onUpdateTarget({
                              opacity: parseInt(e.target.value),
                            })
                          }
                          className="w-16 accent-black"
                        />
                        <span className="text-[11px] font-bold tracking-wider text-gray-600 select-none min-w-[4ch] text-right leading-none tabular-nums">
                          {targetProps.opacity !== undefined
                            ? targetProps.opacity
                            : 100}
                          %
                        </span>
                      </div>
                    </div>
                  )}

                  {activeType === "embed" && (
                    <div className={bottomToolbarGroupClass}>
                      {(() => {
                        const webSettings = getWebSettings(targetProps);
                        const cookieModes: WebCookieBlockerMode[] = [
                          "off",
                          "third-party",
                          "all",
                        ];
                        const nextCookieMode =
                          cookieModes[
                            (cookieModes.indexOf(webSettings.cookieBlocker) + 1) %
                              cookieModes.length
                          ];
                        const deviceIcons: Record<
                          WebDeviceMode,
                          React.ElementType
                        > = {
                          desktop: Monitor,
                          tablet: Tablet,
                          phone: Smartphone,
                        };

                        return (
                          <>
                            <div
                              className="flex items-center gap-1.5 bg-gray-50 border-[3px] border-gray-300 rounded-xl px-2 py-1 hover:border-gray-400 transition-colors"
                              title="Browser Device Mode"
                            >
                              <span className="text-[11px] font-bold text-gray-600 uppercase tracking-wider">
                                Device
                              </span>
                              <div className="flex items-center gap-1">
                                {(["desktop", "tablet", "phone"] as WebDeviceMode[]).map(
                                  (mode) => {
                                    const Icon = deviceIcons[mode];
                                    const active =
                                      webSettings.deviceMode === mode;
                                    return (
                                      <button
                                        key={mode}
                                        className={cn(
                                          "flex h-7 w-7 items-center justify-center rounded-md border text-gray-500 transition-colors",
                                          active
                                            ? "border-blue-300 bg-blue-50 text-blue-700"
                                            : "border-transparent hover:border-gray-300 hover:bg-white hover:text-gray-900",
                                        )}
                                        title={WEB_DEVICE_PROFILES[mode].label}
                                        onClick={() =>
                                          onUpdateTarget({
                                            webDeviceMode: mode,
                                            size:
                                              WEB_DEVICE_PROFILES[mode]
                                                .defaultSize,
                                          })
                                        }
                                      >
                                        <Icon className="w-4 h-4" />
                                      </button>
                                    );
                                  },
                                )}
                              </div>
                            </div>

                            <button type="button" title="Block popups" aria-label="Block popups" aria-pressed={webSettings.popupBlocker}
                              onClick={() => onUpdateTarget({ webPopupBlocker: !webSettings.popupBlocker })}
                              className={cn('flex items-center gap-1.5 rounded-xl border-[3px] px-2 py-1 text-[11px] font-bold transition-colors', webSettings.popupBlocker ? 'border-blue-200 bg-blue-50 text-blue-700' : 'border-gray-300 bg-gray-50 text-gray-500 hover:border-gray-400')}>
                              <SquareDashed className="h-4 w-4" />Popups
                            </button>
                            {desktopWebRuntime && (
                              <>
                                <button
                                  title="Remember logins and cookies"
                                  onClick={() =>
                                    onUpdateTarget({
                                      webRememberSession:
                                        !webSettings.rememberSession,
                                      webSessionId:
                                        targetProps.webSessionId || targetProps.id || generateId(),
                                    })
                                  }
                                  className={cn(
                                    "flex items-center gap-1.5 rounded-xl border-[3px] px-2 py-1 text-[11px] font-bold uppercase tracking-wider transition-colors",
                                    webSettings.rememberSession
                                      ? "border-blue-200 bg-blue-50 text-blue-700"
                                      : "border-gray-300 bg-gray-50 text-gray-500 hover:border-gray-400",
                                  )}
                                >
                                  <Lock className="w-4 h-4" />
                                  Session
                                </button>

                                <button
                                  title="Ad and tracker blocker"
                                  aria-label="Ad blocker"
                                  aria-pressed={webSettings.adBlock}
                                  onClick={() =>
                                    onUpdateTarget({
                                      webAdBlock: !webSettings.adBlock,
                                    })
                                  }
                                  className={cn(
                                    "flex items-center gap-1.5 rounded-xl border-[3px] px-2 py-1 text-[11px] font-bold uppercase tracking-wider transition-colors",
                                    webSettings.adBlock
                                      ? "border-blue-200 bg-blue-50 text-blue-700"
                                      : "border-gray-300 bg-gray-50 text-gray-500 hover:border-gray-400",
                                  )}
                                >
                                  {webSettings.adBlock ? (
                                    <Shield className="w-4 h-4" />
                                  ) : (
                                    <ShieldOff className="w-4 h-4" />
                                  )}
                                  Ads
                                  {webSettings.adBlock && selectedElement && <WebBlockingBadge partition={getWebPartition(selectedElement)} />}
                                </button>

                                <button
                                  title="Cookie blocker: Off / Third-party / All"
                                  onClick={() =>
                                    onUpdateTarget({
                                      webCookieBlocker: nextCookieMode,
                                    })
                                  }
                                  className={cn(
                                    "flex items-center gap-1.5 rounded-xl border-[3px] px-2 py-1 text-[11px] font-bold uppercase tracking-wider transition-colors",
                                    webSettings.cookieBlocker !== "off"
                                      ? "border-blue-200 bg-blue-50 text-blue-700"
                                      : "border-gray-300 bg-gray-50 text-gray-500 hover:border-gray-400",
                                  )}
                                >
                                  <Cookie className="w-4 h-4" />
                                  {WEB_COOKIE_BLOCKER_LABELS[
                                    webSettings.cookieBlocker
                                  ]}
                                </button>
                              </>
                            )}

                            {desktopWebRuntime && (
                              <button
                                title="Clear this web field session"
                                disabled={!selectedElement}
                                onClick={() =>
                                  selectedElement &&
                                  clearElectronWebSession({
                                    ...targetProps,
                                    id: selectedElement.id,
                                  })
                                }
                                className="flex items-center gap-1.5 rounded-xl border-[3px] border-gray-300 bg-gray-50 px-2 py-1 text-[11px] font-bold uppercase tracking-wider text-gray-600 transition-colors hover:border-gray-400 hover:bg-white disabled:opacity-40 disabled:pointer-events-none"
                              >
                                <RotateCcw className="w-4 h-4" />
                                Clear
                              </button>
                            )}
                          </>
                        );
                      })()}
                    </div>
                  )}

                  {/* Specific Options */}
                  {false && activeType === "draw" && (
                    <div className={bottomToolbarGroupClass}>
                      <div
                        className="flex items-center justify-between cursor-pointer group mt-1 bg-white p-2 border-[2px] border-gray-200 rounded-xl hover:bg-gray-50 transition-all"
                        onClick={() =>
                          onUpdateTarget({
                            isSmooth: !(targetProps.isSmooth || false),
                          })
                        }
                      >
                        <span className="text-xs font-bold text-gray-600 select-none group-hover:text-black">
                          Smoothing
                        </span>
                        <div
                          className={cn(
                            "w-7 h-4 rounded-full flex items-center p-0.5 transition-colors duration-200 ease-in-out shrink-0 border border-black/10",
                            targetProps.isSmooth || false
                              ? "bg-blue-500"
                              : "bg-gray-200",
                          )}
                        >
                          <div
                            className={cn(
                              "w-3 h-3 bg-white rounded-full shadow-sm transform transition-transform duration-200 ease-in-out",
                              targetProps.isSmooth || false
                                ? "translate-x-3"
                                : "translate-x-0",
                            )}
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {[
                    "image",
                    "media",
                    "triangle",
                    "arrow",
                    "line",
                    "diamond",
                    "ellipse",
                    "hexagon",
                    "rectangle",
                    "section",
                  ].includes(activeType) && (
                    <div className={bottomToolbarGroupClass}>
                      {(() => {
                        const ratioDefaultOn =
                          activeType === "image" || activeType === "media";
                        const ratioActive = ratioDefaultOn
                          ? targetProps.keepRatio !== false
                          : targetProps.keepRatio === true;
                        return (
                          <button
                            title="Preserve Ratio"
                            onClick={() => {
                              const willKeep = !ratioActive;
                              const isImageContent =
                                activeType === "image" ||
                                (activeType === "media" &&
                                  inferMediaMime(
                                    targetProps.content,
                                    targetProps.mediaMime,
                                  ).startsWith("image"));
                              if (
                                willKeep &&
                                isImageContent &&
                                targetProps.content &&
                                selectedElement
                              ) {
                                const img = new Image();
                                img.onload = () => {
                                  const ratio =
                                    img.naturalWidth / img.naturalHeight;
                                  const w = targetProps.size?.width || 256;
                                  onUpdateTarget({
                                    keepRatio: true,
                                    size: { width: w, height: w / ratio },
                                  });
                                };
                                img.src = targetProps.content;
                              } else {
                                onUpdateTarget({ keepRatio: willKeep });
                              }
                            }}
                            className={cn(
                              "p-2 text-gray-500 hover:text-[#1A1A1A] hover:bg-gray-100 rounded-lg transition-colors border-2 flex items-center gap-1",
                              ratioActive
                                ? "bg-gray-200 border-gray-300 text-[#1A1A1A]"
                                : "border-transparent hover:border-gray-300",
                            )}
                          >
                            <Maximize className="w-4 h-4" />
                            <span className="text-[10px] font-bold">
                              RATIO
                            </span>
                          </button>
                        );
                      })()}
                      {activeType === "media" &&
                        inferMediaMime(
                          targetProps.content,
                          targetProps.mediaMime,
                        ).startsWith("video") && (
                          <>
                            <button
                              title={
                                targetProps.mediaControlsHidden
                                  ? "Show Player Controls"
                                  : "Hide Player Controls"
                              }
                              onClick={() =>
                                onUpdateTarget({
                                  mediaControlsHidden:
                                    !targetProps.mediaControlsHidden,
                                })
                              }
                              className={cn(
                                "p-2 rounded-lg transition-colors border-2 flex items-center gap-1",
                                !targetProps.mediaControlsHidden
                                  ? "bg-gray-200 border-gray-300 text-[#1A1A1A]"
                                  : "border-transparent text-gray-500 hover:bg-gray-100 hover:border-gray-300",
                              )}
                            >
                              <Film className="w-4 h-4" />
                              <span className="text-[10px] font-bold">
                                PLAYER
                              </span>
                            </button>
                          </>
                        )}
                      <button
                        title="Flip Horizontally"
                        onClick={() =>
                          onUpdateTarget({ flipX: !targetProps.flipX })
                        }
                        className={cn(
                          "p-2 rounded-lg transition-colors border-2",
                          targetProps.flipX
                            ? "bg-gray-200 text-[#1A1A1A] border-gray-300"
                            : "text-gray-500 hover:bg-gray-100 border-transparent hover:border-gray-300",
                        )}
                      >
                        <FlipHorizontal className="w-4 h-4" />
                      </button>
                      <button
                        title="Flip Vertically"
                        onClick={() =>
                          onUpdateTarget({ flipY: !targetProps.flipY })
                        }
                        className={cn(
                          "p-2 rounded-lg transition-colors border-[3px]",
                          targetProps.flipY
                            ? "bg-gray-200 text-[#1A1A1A] border-gray-400"
                            : "text-gray-500 hover:bg-gray-100 border-transparent hover:border-gray-400",
                        )}
                      >
                        <FlipVertical className="w-5 h-5" />
                      </button>
                    </div>
                  )}

                  {/* Actions (Always visible, disabled if nothing is selected) */}
                  <div
                    className={cn(
                      bottomToolbarGroupClass,
                      "relative border-r-0 pr-0",
                    )}
                  >
                    <button
                      type="button"
                      title="Duplicate"
                      disabled={!selectedElement}
                      data-duplicate-feedback={objectDuplicated || undefined}
                      onClick={() => {
                        if (!selectedElement) return;
                        duplicateElement(selectedElement.id);
                        setObjectDuplicated(true);
                        if (objectDuplicatedTimerRef.current) clearTimeout(objectDuplicatedTimerRef.current);
                        objectDuplicatedTimerRef.current = setTimeout(() => {
                          setObjectDuplicated(false); objectDuplicatedTimerRef.current = null;
                        }, 900);
                      }}
                      className={cn("p-2 rounded-xl transition-all border-[3px] flex items-center justify-center shadow-sm disabled:cursor-not-allowed disabled:opacity-40",
                        objectDuplicated ? "text-green-700 bg-green-50 border-green-300 scale-110" : "text-gray-600 bg-gray-100 hover:text-[#1A1A1A] hover:bg-gray-200 border-gray-300 hover:border-gray-400")}
                    >
                      {objectDuplicated ? <Check className="w-5 h-5" /> : <Copy className="w-5 h-5" />}
                    </button>
                    {selectedElement?.type==='group'&&<button type="button" title="Ungroup" onClick={ungroupSelection} className="p-2 text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-xl border-[3px] border-gray-300 shadow-sm"><Layers className="w-5 h-5"/></button>}
                    <button
                      type="button"
                      title="Delete"
                      disabled={!selectedElement}
                      onClick={() =>
                        selectedElement && removeElement(selectedElement.id)
                      }
                      className="p-2 text-red-600 bg-red-50 hover:text-red-700 hover:bg-red-100 rounded-xl transition-colors border-[3px] border-red-200 hover:border-red-300 flex items-center justify-center shadow-sm disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-red-50 disabled:hover:text-red-600 disabled:hover:border-red-200"
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                    <button
                      type="button"
                      data-save-object-defaults="true"
                      disabled={selectedElement?.type==='group'}
                      title={selectedElement?.type==='group'?'Ungroup to save individual object settings':'Save settings for this object type'}
                      aria-label="Save settings for this object type"
                      onClick={() =>
                        selectedElement
                          ? saveDefaultsForElement(selectedElement)
                          : saveDefaultsForType(
                              activeType as ElementType,
                              defaultsSource,
                            )
                      }
                      className={cn(
                        "relative p-2 rounded-xl transition-all border-[3px] flex items-center justify-center shadow-sm disabled:opacity-40 disabled:cursor-not-allowed",
                        objectDefaultsSaved
                          ? "text-green-700 bg-green-50 border-green-300 scale-110"
                          : "text-blue-700 bg-blue-50 hover:text-blue-800 hover:bg-blue-100 border-blue-200 hover:border-blue-300",
                      )}
                    >
                      <Check className="w-5 h-5" />
                    </button>
                  </div>
                </ToolPropertiesBar>
              </AnimatePresence>
            );
          })()}
        </div>
      </div>
    </div>
  );
}

function BoardElementNode({
  element,
  renderZIndex,
  onBoardResizeStart,
  onSmartMove,
  onGuidesEnd,
  isSelectMode: _isSelectMode,
  activeTool,
  isSelected,
  isGroupSelected = false,
  isGroupMember = false,
  onSelect,
  onUpdate,
  onJumpToTarget,
  onLinkEdit,
  onTextSelect,
  snap,
  proportionalScale,
  globalPreviewMode,
  zoomRef,
  highlightAll,
  onContextMenu,
  overlapMode: _overlapMode,
  elements,
  sceneHierarchy,
  spinSnapEnabled = false,
  spinSnapDegrees = 15,
  allowEditing = true,
  matchingToolEditing = false,
  matchingToolMoving = false,
  isInteractionLocked = false,
  allowMovingElementsInPan = false,
  isBoardResizeEnabled = false,
  isBoardMoveEnabled = false,
  showGrid = false,
  gridColor = "#e2e8f0",
  gridSize = 24,
  gridThickness = 1,
  pageDimensions,
  altResizeCrops = true,
  isAltKeyDown = false,
}: {
  key?: React.Key;
  element: BoardElement;
  renderZIndex?: number;
  onBoardResizeStart?: (id:string)=>void;
  onSmartMove?: (element:BoardElement,position:{x:number;y:number},allowSnap?:boolean)=>{x:number;y:number};
  onGuidesEnd?: ()=>void;
  allowEditing?: boolean;
  matchingToolEditing?: boolean;
  matchingToolMoving?: boolean;
  allowMovingElementsInPan?: boolean;
  isBoardResizeEnabled?: boolean;
  isBoardMoveEnabled?: boolean;
  isSelectMode: boolean;
  activeTool?: string;
  isSelected: boolean;
  isGroupSelected?: boolean;
  isGroupMember?: boolean;
  onSelect: () => void;
  onUpdate: (u: Partial<BoardElement>, skipHistory?: boolean) => void;
  onJumpToTarget?: (id: string) => void;
  onLinkEdit?: (targetId: string) => void;
  onTextSelect?: (range: Range, elementId: string) => void;
  snap: (v: number) => number;
  proportionalScale: boolean;
  globalPreviewMode: "box" | "realistic";
  zoomRef: React.MutableRefObject<number>;
  highlightAll?: boolean;
  onContextMenu?: (e: React.MouseEvent) => void;
  overlapMode?: "none" | "partial" | "full";
  elements?: BoardElement[];
  sceneHierarchy?: ElementHierarchy;
  spinSnapEnabled?: boolean;
  spinSnapDegrees?: number;
  showGrid?: boolean;
  isInteractionLocked?: boolean;
  gridColor?: string;
  gridSize?: number;
  gridThickness?: number;
  pageDimensions?: { width: number; height: number };
  altResizeCrops?: boolean;
  isAltKeyDown?: boolean;
  manualLinkSourceId?: string | null;
}) {
  if (element.type === "layer") return null;
  isInteractionLocked = isInteractionLocked || isGroupMember;
  const nodeRef = useRef<HTMLDivElement>(null);
  const [boardPortalRoot, setBoardPortalRoot] = useState<HTMLElement | null>(
    null,
  );
  const [interactionPreview, setInteractionPreview] = useState<
    Partial<Pick<BoardElement, "position" | "size" | "crop">> | null
  >(null);
  const activePointerGestureCleanupRef = useRef<(() => void) | null>(null);
  const resolvedPreviewMode = element.previewMode ?? globalPreviewMode;

  const captureElementPointer = (event: React.PointerEvent) => {
    const pointerId = event.pointerId;
    const target = event.currentTarget as HTMLElement;
    const captureToken = `${element.id}:${pointerId}`;
    document.documentElement.dataset.boardPointerCapture = captureToken;
    try {
      target.setPointerCapture(pointerId);
    } catch {
      // Pointer capture can be unavailable if the browser already cancelled it.
    }
    return {
      matches: (nextEvent: PointerEvent) => nextEvent.pointerId === pointerId,
      release: () => {
        if (document.documentElement.dataset.boardPointerCapture === captureToken) delete document.documentElement.dataset.boardPointerCapture;
        try {
          if (target.hasPointerCapture(pointerId)) {
            target.releasePointerCapture(pointerId);
          }
        } catch {
          // The browser may have released capture before our cleanup runs.
        }
      },
    };
  };

  useEffect(
    () => () => {
      activePointerGestureCleanupRef.current?.();
      activePointerGestureCleanupRef.current = null;
      document.body.style.userSelect = "";
      document.body.style.cursor = "";
    },
    [],
  );

  useEffect(() => {
    if (!isSelected) {
      setBoardPortalRoot(null);
      return;
    }
    setBoardPortalRoot(
      nodeRef.current?.closest('[data-board-root="true"]') as HTMLElement | null,
    );
  }, [isSelected]);

  const handleResizePointerDown = (
    e: React.PointerEvent,
    dir: "nw" | "ne" | "sw" | "se" | "n" | "s" | "w" | "e",
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (!nodeRef.current || !canResize) return;
    nodeRef.current.closest<HTMLElement>('[data-board-root]')?.focus({preventScroll:true});
    if(element.type==="board")onBoardResizeStart?.(element.id);

    activePointerGestureCleanupRef.current?.();
    const pointerGesture = captureElementPointer(e);
    setInteractionPreview(null);
    document.body.style.userSelect = "none";

    const startX = e.clientX;
    const startY = e.clientY;
    const startWidth = element.size?.width || nodeRef.current.offsetWidth;
    const startHeight = element.size?.height || nodeRef.current.offsetHeight;
    const startPosX = element.position.x;
    const startPosY = element.position.y;
    const rotation = element.rotation || 0;
    const rad = -rotation * (Math.PI / 180);
    const startFontSize =
      element.fontSize ||
      (element.type === "h1"
        ? 36
        : element.type === "h2"
          ? 24
          : element.type === "h3"
            ? 18
            : 16);
    const startLineHeight = element.lineHeight || 24;
    const startCrop = element.crop || {
      left: 0,
      top: 0,
      right: 0,
      bottom: 0,
    };

    let timerX = 0;
    let timerY = 0;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let lastEvt: PointerEvent | null = null;
    let latestUpdatePayload: Partial<BoardElement> | null = null;

    const processMove = (
      evt: PointerEvent,
      forceFlipX = false,
      forceFlipY = false,
    ) => {
      let dxScreen = (evt.clientX - startX) / zoomRef.current;
      let dyScreen = (evt.clientY - startY) / zoomRef.current;

      // Convert screen delta to local delta
      let dx = dxScreen * Math.cos(rad) - dyScreen * Math.sin(rad);
      let dy = dxScreen * Math.sin(rad) + dyScreen * Math.cos(rad);
      const localSnap = TEXT_TYPES.includes(element.type)
        ? (v: number) => v
        : snap;

      if (activeTool==='crop' || (element.type!=='group' && altResizeCrops && (isAltKeyDown || evt.altKey))) {
        const crop = normalizeCrop(startCrop);
        const visibleWidthPct = Math.max(1, 100 - crop.left - crop.right);
        const visibleHeightPct = Math.max(1, 100 - crop.top - crop.bottom);
        const contentWidth = startWidth / (visibleWidthPct / 100);
        const contentHeight = startHeight / (visibleHeightPct / 100);
        const startLeftPx = (crop.left / 100) * contentWidth;
        const startRightPx = (crop.right / 100) * contentWidth;
        const startTopPx = (crop.top / 100) * contentHeight;
        const startBottomPx = (crop.bottom / 100) * contentHeight;
        const minVisible = element.type === "media" ? 24 : 8;

        let nextLeftPx = startLeftPx;
        let nextRightPx = startRightPx;
        let nextTopPx = startTopPx;
        let nextBottomPx = startBottomPx;

        if (dir.includes("w")) {
          nextLeftPx = Math.min(
            contentWidth - startRightPx - minVisible,
            Math.max(startLeftPx, startLeftPx + dx),
          );
        }
        if (dir.includes("e")) {
          nextRightPx = Math.min(
            contentWidth - nextLeftPx - minVisible,
            Math.max(startRightPx, startRightPx - dx),
          );
        }
        if (dir.includes("n")) {
          nextTopPx = Math.min(
            contentHeight - startBottomPx - minVisible,
            Math.max(startTopPx, startTopPx + dy),
          );
        }
        if (dir.includes("s")) {
          nextBottomPx = Math.min(
            contentHeight - nextTopPx - minVisible,
            Math.max(startBottomPx, startBottomPx - dy),
          );
        }

        const nextWidth = Math.max(
          minVisible,
          contentWidth - nextLeftPx - nextRightPx,
        );
        const nextHeight = Math.max(
          minVisible,
          contentHeight - nextTopPx - nextBottomPx,
        );
        const localShiftX = nextLeftPx - startLeftPx;
        const localShiftY = nextTopPx - startTopPx;
        const radFwd = rotation * (Math.PI / 180);
        const globalShiftX =
          localShiftX * Math.cos(radFwd) - localShiftY * Math.sin(radFwd);
        const globalShiftY =
          localShiftX * Math.sin(radFwd) + localShiftY * Math.cos(radFwd);

        const cropUpdatePayload: Partial<BoardElement> = {
          crop: normalizeCrop({
            left: (nextLeftPx / contentWidth) * 100,
            right: (nextRightPx / contentWidth) * 100,
            top: (nextTopPx / contentHeight) * 100,
            bottom: (nextBottomPx / contentHeight) * 100,
          }),
          size: {
            width: nextWidth,
            height: nextHeight,
          },
          position: {
            x: startPosX + globalShiftX,
            y: startPosY + globalShiftY,
          },
        };
        latestUpdatePayload = cropUpdatePayload;
        onSmartMove?.({...element,...cropUpdatePayload},cropUpdatePayload.position,false);
        if (resolvedPreviewMode === "box") {
          setInteractionPreview(cropUpdatePayload);
        } else {
          onUpdate(cropUpdatePayload, true);
        }
        return;
      }

      let newW = startWidth;
      let newH = startHeight;
      let localDx = 0; // shift in local top-left
      let localDy = 0;

      if (dir.includes("e")) {
        newW = startWidth + dx;
      }
      if (dir.includes("w")) {
        newW = startWidth - dx;
        localDx = dx;
      }
      if (dir.includes("s")) {
        newH = startHeight + dy;
      }
      if (dir.includes("n")) {
        newH = startHeight - dy;
        localDy = dy;
      }

      const isProportional =
        element.type==='group' ||
        isTextScaling(element) ||
        proportionalScale ||
        element.keepRatio === true ||
        ((element.type === "image" || element.type === "media") &&
          element.keepRatio !== false);
      if (
        isProportional &&
        (dir === "nw" || dir === "ne" || dir === "sw" || dir === "se")
      ) {
        // If proportional and dragging corners, force aspect ratio
        const aspectRatio = startWidth / startHeight;
        if (newW / newH > aspectRatio) {
          if (dir.includes("w")) {
            localDx -= newH * aspectRatio - newW;
          }
          newW = newH * aspectRatio;
        } else {
          if (dir.includes("n")) {
            localDy -= newW / aspectRatio - newH;
          }
          newH = newW / aspectRatio;
        }
      }
      if (isProportional && dir.length === 1) {
        // Keep the element's original ratio when an edge handle is used too.
        // The opposite axis is centered so resizing does not make the object
        // jump away from the pointer.
        const aspectRatio = startWidth / Math.max(1, startHeight);
        if (dir === "e" || dir === "w") {
          newH = newW / Math.max(0.0001, aspectRatio);
          localDy = (startHeight - newH) / 2;
        } else if (dir === "n" || dir === "s") {
          newW = newH * aspectRatio;
          localDx = (startWidth - newW) / 2;
        }
      }

      let signedW = newW;
      let signedH = newH;

      const now = Date.now();
      let shouldScheduleX = false;
      let shouldScheduleY = false;

      if (signedW < 0) {
        if (!timerX) timerX = now;
        if (!forceFlipX && now - timerX < 750) {
          signedW = 1;
          shouldScheduleX = true;
        }
      } else {
        timerX = 0;
      }

      if (signedH < 0) {
        if (!timerY) timerY = now;
        if (!forceFlipY && now - timerY < 750) {
          signedH = 1;
          shouldScheduleY = true;
        }
      } else {
        timerY = 0;
      }

      if (timeoutId) clearTimeout(timeoutId);
      if (shouldScheduleX || shouldScheduleY) {
        timeoutId = setTimeout(() => {
          if (lastEvt) processMove(lastEvt, shouldScheduleX, shouldScheduleY);
        }, 750);
      }

      const minSize = getElementMinSize(element);
      let finalW: number;
      let finalH: number;
      if (isProportional) {
        const proportionalSize = constrainProportionalSize({
          width: Math.abs(signedW),
          height: Math.abs(signedH),
          aspectRatio: startWidth / Math.max(0.0001, startHeight),
          minWidth: minSize.width,
          minHeight: minSize.height,
          primaryAxis:
            dir === "n" || dir === "s" ? "height" : "width",
          snap: localSnap,
        });
        finalW = proportionalSize.width;
        finalH = proportionalSize.height;
      } else {
        finalW = Math.max(minSize.width, localSnap(Math.abs(signedW)));
        finalH = Math.max(minSize.height, localSnap(Math.abs(signedH)));
      }

      signedW = signedW < 0 ? -finalW : finalW;
      signedH = signedH < 0 ? -finalH : finalH;

      // Re-calculate localDx/localDy based on signed dimensions
      if (dir.includes("w")) localDx = startWidth - signedW;
      if (dir.includes("n")) localDy = startHeight - signedH;
      if (isProportional && (dir === "e" || dir === "w")) {
        localDy = (startHeight - finalH) / 2;
      }
      if (isProportional && (dir === "n" || dir === "s")) {
        localDx = (startWidth - finalW) / 2;
      }

      // Calculate how much the local center shifted
      const centerShiftX = localDx + (signedW - startWidth) / 2;
      const centerShiftY = localDy + (signedH - startHeight) / 2;

      // Rotate the shift back to global space to find new global center change
      const radFwd = rotation * (Math.PI / 180);
      const globalCenterShiftX =
        centerShiftX * Math.cos(radFwd) - centerShiftY * Math.sin(radFwd);
      const globalCenterShiftY =
        centerShiftX * Math.sin(radFwd) + centerShiftY * Math.cos(radFwd);

      // We want the new (x,y) to place the new center exactly at the old center + globalCenterShift
      // newCenter = (startPosX + startWidth/2) + globalCenterShiftX
      // newX = newCenter - finalW/2
      let newX = startPosX + startWidth / 2 + globalCenterShiftX - finalW / 2;
      let newY =
        startPosY + startHeight / 2 + globalCenterShiftY - finalH / 2;

      if (false && pageDimensions && element.type !== "board") {
        if (newX < 0) {
          if (dir.includes("w")) finalW += newX;
          newX = 0;
        }
        if (newY < 0) {
          if (dir.includes("n")) finalH += newY;
          newY = 0;
        }
        if (newX + finalW > pageDimensions.width) {
          finalW = Math.max(minSize.width, pageDimensions.width - newX);
        }
        if (newY + finalH > pageDimensions.height) {
          finalH = Math.max(minSize.height, pageDimensions.height - newY);
        }
        finalW = Math.max(
          Math.min(minSize.width, pageDimensions.width),
          Math.min(finalW, pageDimensions.width),
        );
        finalH = Math.max(
          Math.min(minSize.height, pageDimensions.height),
          Math.min(finalH, pageDimensions.height),
        );
        newX = Math.min(
          Math.max(0, newX),
          Math.max(0, pageDimensions.width - finalW),
        );
        newY = Math.min(
          Math.max(0, newY),
          Math.max(0, pageDimensions.height - finalH),
        );
      }

      let updatePayload: any = {
        size: { width: finalW, height: finalH },
        position: {
          x: TEXT_TYPES.includes(element.type) ? newX : localSnap(newX),
          y: TEXT_TYPES.includes(element.type) ? newY : localSnap(newY),
        },
      };

      if (isTextScaling(element)) {
        updatePayload.textScale = resizedTextScale(element, startWidth, finalW);
      } else if (isProportional && TEXT_TYPES.includes(element.type) && dir.length === 2) {
        const scaleRatio = finalW / startWidth;
        updatePayload.fontSize = Math.max(
          8,
          Math.round(startFontSize * scaleRatio),
        );
        updatePayload.lineHeight = Math.max(
          10,
          Math.round(startLineHeight * scaleRatio),
        );
      }

      latestUpdatePayload = updatePayload;
      onSmartMove?.({...element,...updatePayload},updatePayload.position,false);
      if (resolvedPreviewMode === "box") {
        setInteractionPreview(updatePayload);
      } else {
        onUpdate(updatePayload, true);
      }
    };

    const onPointerMove = (evt: PointerEvent) => {
      if (!pointerGesture.matches(evt)) return;
      lastEvt = evt;
      processMove(evt);
    };

    const cleanupPointerGesture = () => {
      if (timeoutId) clearTimeout(timeoutId);
      pointerGesture.release();
      onGuidesEnd?.();
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      if (activePointerGestureCleanupRef.current === cleanupPointerGesture) {
        activePointerGestureCleanupRef.current = null;
      }
    };

    const finishResize = () => {
      setInteractionPreview(null);
      if (latestUpdatePayload) onUpdate(latestUpdatePayload, false);
    };

    const onPointerUp = (evt: PointerEvent) => {
      if (!pointerGesture.matches(evt)) return;
      cleanupPointerGesture();
      finishResize();
    };

    const onPointerCancel = (evt: PointerEvent) => {
      if (!pointerGesture.matches(evt)) return;
      cleanupPointerGesture();
      finishResize();
    };

    activePointerGestureCleanupRef.current = cleanupPointerGesture;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
  };

  const handleDragPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    if (element.linkToId && activeTool !== "link" && onJumpToTarget) {
      e.stopPropagation();
      e.preventDefault();
      onJumpToTarget(element.linkToId);
      return;
    }

    // If a text tool is active, allow clicking on an existing text block to convert it AND move it
    if (TEXT_TYPES.includes(activeTool ?? "")) {
      if (TEXT_TYPES.includes(element.type)) {
        onUpdate({ type: activeTool as ElementType });
      }
    }

    if (!canInteract) return;

    const pointerTarget = e.target as HTMLElement;
    const isEditableTarget =
      pointerTarget.isContentEditable ||
      pointerTarget.tagName.toLowerCase() === "input" ||
      pointerTarget.tagName.toLowerCase() === "textarea";
    const isElementContentTool =
      (TEXT_TYPES.includes(element.type) &&
        TEXT_TYPES.includes(activeTool ?? "")) ||
      activeTool === element.type ||
      (element.type === "image" && activeTool === "media");

    if (isEditableTarget && isElementContentTool) {
      e.stopPropagation();
      onSelect();
      return;
    }

    nodeRef.current?.closest<HTMLElement>('[data-board-root]')?.focus({preventScroll:true});

    // Select/Hand should be able to start a reliable drag from the text body.
    // Editing remains available after the element's own tool is active.
    if (isEditableTarget) e.preventDefault();

    if (activeTool === "link") {
      e.stopPropagation();
      onSelect();
      return;
    }

    if (!canMove) { if (activeTool === "pan") return; e.stopPropagation(); onSelect(); return; }

    e.preventDefault();
    e.stopPropagation();
    onSelect();

    activePointerGestureCleanupRef.current?.();
    const pointerGesture = captureElementPointer(e);
    setInteractionPreview(null);
    document.body.style.userSelect = "none";

    const startX = e.clientX;
    const startY = e.clientY;
    const startPosX = element.position.x;
    const startPosY = element.position.y;
    const elementBoxWidth = element.size?.width || 100;
    const elementBoxHeight = element.size?.height || 40;
    const usesRotatedBounds =
      !!element.rotation || element.type === "line" || element.type === "arrow";

    const getVisualBounds = (x: number, y: number) => {
      const visualWidth = elementBoxWidth;
      const visualHeight =
        element.type === "line"
          ? Math.max(1, element.borderWidth || 4)
          : elementBoxHeight;

      if (!usesRotatedBounds) {
        return {
          minX: x,
          maxX: x + visualWidth,
          minY: y,
          maxY: y + visualHeight,
        };
      }

      const cx = x + elementBoxWidth / 2;
      const cy = y + elementBoxHeight / 2;
      const rad = ((element.rotation || 0) * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const corners = [
        { x: -visualWidth / 2, y: -visualHeight / 2 },
        { x: visualWidth / 2, y: -visualHeight / 2 },
        { x: -visualWidth / 2, y: visualHeight / 2 },
        { x: visualWidth / 2, y: visualHeight / 2 },
      ].map((pt) => ({
        x: cx + pt.x * cos - pt.y * sin,
        y: cy + pt.x * sin + pt.y * cos,
      }));
      const minX = Math.min(...corners.map((pt) => pt.x));
      const maxX = Math.max(...corners.map((pt) => pt.x));
      const minY = Math.min(...corners.map((pt) => pt.y));
      const maxY = Math.max(...corners.map((pt) => pt.y));
      return { minX, maxX, minY, maxY };
    };

    const shiftBoundsInside = (
      x: number,
      y: number,
      bounds: ReturnType<typeof getVisualBounds>,
      limits: { minX: number; minY: number; maxX: number; maxY: number },
    ) => {
      let nextX = x;
      let nextY = y;

      if (bounds.minX < limits.minX) nextX += limits.minX - bounds.minX;
      if (bounds.maxX > limits.maxX) nextX -= bounds.maxX - limits.maxX;
      if (bounds.minY < limits.minY) nextY += limits.minY - bounds.minY;
      if (bounds.maxY > limits.maxY) nextY -= bounds.maxY - limits.maxY;
      return { x: nextX, y: nextY };
    };

    const clampToPage = (x: number, y: number) => {
      if (!pageDimensions || element.type === "board") return { x, y };

      return shiftBoundsInside(x, y, getVisualBounds(x, y), {
        minX: 0,
        minY: 0,
        maxX: pageDimensions.width,
        maxY: pageDimensions.height,
      });
    };

    const startBounds = getVisualBounds(startPosX, startPosY);
    const startCenterX = (startBounds.minX + startBounds.maxX) / 2;
    const startCenterY = (startBounds.minY + startBounds.maxY) / 2;
    let latestPosition: { x: number; y: number } | null = null;

    const onPointerMove = (evt: PointerEvent) => {
      if (!pointerGesture.matches(evt)) return;
      const dx = (evt.clientX - startX) / zoomRef.current;
      const dy = (evt.clientY - startY) / zoomRef.current;
      const localSnap = snap;
      let newX = localSnap(startPosX + dx);
      let newY = localSnap(startPosY + dy);

      if (false && pageDimensions && element.type !== "board") {
        const pageClamped = clampToPage(newX, newY);
        newX = pageClamped.x;
        newY = pageClamped.y;

        // Only sections with collision enabled should cage nearby elements.
        if (element.type !== "section") {
          const containerSections =
            elements?.filter(
              (el) =>
                el.type === "section" &&
                (el.sectionCollision === "block" ||
                  el.sectionCollision === "clip") &&
                startCenterX >= el.position.x &&
                startCenterX <= el.position.x + (el.size?.width || 0) &&
                startCenterY >= el.position.y &&
                startCenterY <= el.position.y + (el.size?.height || 0),
            ) || [];
          for (const sec of containerSections) {
            const secMinX = sec.position.x;
            const secMinY = sec.position.y;
            const sectionClamped = shiftBoundsInside(
              newX,
              newY,
              getVisualBounds(newX, newY),
              {
                minX: secMinX,
                minY: secMinY,
                maxX: secMinX + (sec.size?.width || 0),
                maxY: secMinY + (sec.size?.height || 0),
              },
            );
            newX = sectionClamped.x;
            newY = sectionClamped.y;
          }
        }
      }

      latestPosition = onSmartMove?.(element,{x:newX,y:newY}) ?? { x: newX, y: newY };
      const updatePayload = { position: latestPosition };
      if (resolvedPreviewMode === "box") {
        setInteractionPreview(updatePayload);
      } else {
        onUpdate(updatePayload, true);
      }
    };

    const cleanupPointerGesture = () => {
      pointerGesture.release();
      onGuidesEnd?.();
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointercancel", onPointerCancel);
      if (activePointerGestureCleanupRef.current === cleanupPointerGesture) {
        activePointerGestureCleanupRef.current = null;
      }
    };

    const onPointerUp = (upEvt: PointerEvent) => {
      if (!pointerGesture.matches(upEvt)) return;
      cleanupPointerGesture();
      setInteractionPreview(null);

      // Save to history once on mouse up
      const dx = (upEvt.clientX - startX) / zoomRef.current;
      const dy = (upEvt.clientY - startY) / zoomRef.current;
      let newX = snap(startPosX + dx);
      let newY = snap(startPosY + dy);

      if (false && pageDimensions && element.type !== "board") {
        const pageClamped = clampToPage(newX, newY);
        newX = pageClamped.x;
        newY = pageClamped.y;

        if (element.type !== "section") {
          const containerSections =
            elements?.filter(
              (el) =>
                el.type === "section" &&
                (el.sectionCollision === "block" ||
                  el.sectionCollision === "clip") &&
                startCenterX >= el.position.x &&
                startCenterX <= el.position.x + (el.size?.width || 0) &&
                startCenterY >= el.position.y &&
                startCenterY <= el.position.y + (el.size?.height || 0),
            ) || [];
          for (const sec of containerSections) {
            const secMinX = sec.position.x;
            const secMinY = sec.position.y;
            const sectionClamped = shiftBoundsInside(
              newX,
              newY,
              getVisualBounds(newX, newY),
              {
                minX: secMinX,
                minY: secMinY,
                maxX: secMinX + (sec.size?.width || 0),
                maxY: secMinY + (sec.size?.height || 0),
              },
            );
            newX = sectionClamped.x;
            newY = sectionClamped.y;
          }
        }
      }
      onUpdate({ position: onSmartMove?.(element,{x:newX,y:newY}) ?? { x: newX, y: newY } }, false);
      onGuidesEnd?.();
    };

    const onPointerCancel = (cancelEvt: PointerEvent) => {
      if (!pointerGesture.matches(cancelEvt)) return;
      cleanupPointerGesture();
      setInteractionPreview(null);
      if (latestPosition) onUpdate({ position: latestPosition }, false);
    };

    activePointerGestureCleanupRef.current = cleanupPointerGesture;
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointercancel", onPointerCancel);
  };

  const permissions = getElementPermissions({ tool: activeTool ?? "select", element, locked: isInteractionLocked, handEditing: allowEditing, handMoving: allowMovingElementsInPan, matchingEditing: matchingToolEditing, matchingMoving: matchingToolMoving });
  const canResize = !isGroupSelected && (permissions.canResize || (element.type === "board" && isBoardResizeEnabled && !isInteractionLocked));
  const canMove = permissions.canMove || (element.type === "board" && isBoardMoveEnabled && !isInteractionLocked);
  const canInteract = permissions.canSelect || canResize || canMove;
  const isBoardInteraction = element.type === "board" && (canResize || canMove);
  const isRatioLocked =
    element.type==='group' ||
    isTextScaling(element) ||
    element.keepRatio === true ||
    ((element.type === "image" || element.type === "media") &&
      element.keepRatio !== false);
  const showEdgeResizeHandles =
    !isRatioLocked || activeTool==='crop' || (element.type!=='group' && altResizeCrops && isAltKeyDown);
  const handleSize = resizeHandleSize(element.size?.width ?? 100, element.size?.height ?? 40, zoomRef.current);
  const selfManagedCrop =
    element.type === "media" &&
    inferMediaMime(element.content, element.mediaMime).startsWith("video");
  const mediaMime =
    element.type === "media"
      ? inferMediaMime(element.content, element.mediaMime)
      : "";
  const hasPlayableMediaControls =
    !isInteractionLocked &&
    activeTool !== "draw" &&
    element.type === "media" &&
    (mediaMime.startsWith("video") || mediaMime.startsWith("audio"));
  const cropMetrics = selfManagedCrop
    ? null
    : getCropRenderMetrics(element.size, element.crop);
  const croppedElement = cropMetrics
    ? {
        ...element,
        crop: undefined,
        size: {
          width: cropMetrics.contentWidth,
          height: cropMetrics.contentHeight,
        },
      }
    : element;
  const boardClipStyle = (() => {
    if (!pageDimensions || element.type === "board") return undefined;
    const center = { x: element.position.x + (element.size?.width ?? 100) / 2, y: element.position.y + (element.size?.height ?? 40) / 2 };
    const board = (elements ?? []).filter(e => e.type === 'board').sort((a,b) => b.zIndex-a.zIndex).find(e =>
      center.x >= e.position.x && center.x <= e.position.x + (e.size?.width ?? 0) && center.y >= e.position.y && center.y <= e.position.y + (e.size?.height ?? 0));
    const boundary = board ? elementPolygon(board) : elementPolygon({ position: { x:0, y:0 }, size: pageDimensions });
    return { clipPath: getSectionClipPath(element, elements ?? [], boundary, sceneHierarchy) };
  })();

  // We should also override the drag ability if they only enabled resize, but
  // canInteract covers the handle rendering too.

  const boardHandlePortal =
    boardPortalRoot &&
    element.type === "board" &&
    isSelected &&
    canInteract &&
    isBoardResizeEnabled
      ? createPortal(
          <div
            className="absolute pointer-events-none"
            style={{
              left: element.position.x,
              top: element.position.y,
              width: element.size?.width || 100,
              height: element.size?.height || 40,
              zIndex: 100000,
              transformOrigin: "center center",
              transform: `rotate(${element.rotation || 0}deg)`,
            }}
          >
            {([
              ["nw", "left-[-12px] top-[-12px] cursor-nw-resize"],
              ["ne", "right-[-12px] top-[-12px] cursor-ne-resize"],
              ["sw", "left-[-12px] bottom-[-12px] cursor-sw-resize"],
              ["se", "right-[-12px] bottom-[-12px] cursor-se-resize"],
              ["n", "left-1/2 top-[-12px] -translate-x-1/2 cursor-n-resize"],
              ["s", "left-1/2 bottom-[-12px] -translate-x-1/2 cursor-s-resize"],
              ["w", "left-[-12px] top-1/2 -translate-y-1/2 cursor-w-resize"],
              ["e", "right-[-12px] top-1/2 -translate-y-1/2 cursor-e-resize"],
            ] as const).map(([direction, positionClass]) => (
              <button
                key={direction}
                type="button"
                aria-label={`Resize board ${direction}`}
                className={cn(
                  "absolute h-6 w-6 touch-none pointer-events-auto bg-transparent",
                  positionClass,
                )}
                onPointerDown={(event) =>
                  handleResizePointerDown(event, direction)
                }
              />
            ))}
          </div>,
          boardPortalRoot,
        )
      : null;

  const interactionPreviewPortal =
    boardPortalRoot && interactionPreview && resolvedPreviewMode === "box"
      ? createPortal(
          <div
            data-element-preview="translucent"
            className="absolute pointer-events-none border-2 border-blue-500/80 bg-blue-500/10"
            style={{
              left: interactionPreview.position?.x ?? element.position.x,
              top: interactionPreview.position?.y ?? element.position.y,
              width:
                interactionPreview.size?.width ?? element.size?.width ?? 100,
              height:
                interactionPreview.size?.height ?? element.size?.height ?? 40,
              clipPath: getSectionClipPath({ ...element, ...interactionPreview }, elements ?? []),
              zIndex: 100001,
              transformOrigin: "center center",
              transform: `rotate(${element.rotation || 0}deg)`,
            }}
          />,
          boardPortalRoot,
        )
      : null;

  return (
    <>
    <motion.div
      initial={false}
      animate={{
        opacity: (element.opacity !== undefined ? element.opacity / 100 : 1) *
          (sceneHierarchy?.ancestors(element.id).slice(1).filter(parent=>parent.type==='group').reduce((value,parent)=>value*(parent.opacity??100)/100,1)??1),
      }}
      className={cn(
        "absolute",
        canInteract && "touch-none",
        isInteractionLocked
          ? "pointer-events-none"
        : element.type === "board" && !canInteract
          ? "cursor-crosshair pointer-events-auto"
          : element.type === "line"
          ? canInteract
            ? "cursor-move pointer-events-auto"
            : "pointer-events-none"
          : canInteract
          ? element.linkToId && activeTool !== "link"
            ? "cursor-pointer pointer-events-auto"
            : activeTool === "pan"
              ? "pointer-events-auto"
              : activeTool === "link"
                ? "cursor-pointer pointer-events-auto"
                : isBoardInteraction && !isBoardMoveEnabled
                  ? "pointer-events-auto"
                  : "cursor-move pointer-events-auto"
          : hasPlayableMediaControls
            ? "cursor-default pointer-events-auto"
          : element.linkToId
            ? "cursor-pointer pointer-events-auto"
            : "pointer-events-none",
      )}
      data-board-surface={element.type === "board" ? "true" : undefined}
      data-board-element={isGroupMember?"false":"true"}
      data-merged-group-member={isGroupMember||undefined}
      data-board-element-id={element.id}
      data-board-element-type={element.type}
      style={{
        left: element.position.x,
        top: element.position.y,
        zIndex: renderZIndex ?? element.zIndex,
        transformOrigin: "center center",
        transform: `rotate(${element.rotation || 0}deg) scaleX(${element.flipX ? -1 : 1}) scaleY(${element.flipY ? -1 : 1})`,
      }}
      onPointerDown={(e) => {
        // If it's a link and we're not using the link tool, block board interaction and just wait for the click.
        if (element.linkToId && activeTool !== "link") {
          e.stopPropagation();
          return;
        }

        if (!canInteract) return;

        // If only resize is enabled, prevent moving the board body
        if (
          element.type === "board" &&
          !isBoardMoveEnabled &&
          isBoardResizeEnabled &&
          activeTool !== "select" &&
          activeTool !== "pan"
        ) {
          e.stopPropagation();
          onSelect();
          return;
        }
        handleDragPointerDown(e);
      }}
      onClick={(e) => {
        if (!canInteract && element.type === "board") return;
        e.stopPropagation();
        if (
          element.linkToId &&
          activeTool !== "link" &&
          onJumpToTarget &&
          (!allowEditing || activeTool === "pan")
        ) {
          onJumpToTarget(element.linkToId);
          return;
        }
        if (canInteract) onSelect();
      }}
      onContextMenu={(e) => {
        if (onContextMenu && canInteract && !isInteractionLocked) {
          e.preventDefault();
          e.stopPropagation();
          onSelect();
          onContextMenu(e);
        }
      }}
    >
      <div
        ref={nodeRef}
        className={cn(
          "relative group",
          (isInteractionLocked || (["draw", "fill", "eraser"].includes(activeTool ?? "") && !canInteract)) &&
            "pointer-events-none [&_*]:!pointer-events-none",
          element.type === "line" && "pointer-events-none",
          isSelected
            ? "ring-2 ring-blue-500 shadow-[0_0_0_2px_rgba(59,130,246,0.3)]"
            : "hover:ring-2 hover:ring-blue-400/20",
          highlightAll && !isSelected ? "ring-4 ring-red-500/50" : "",
        )}
      >
        <div className="relative" style={boardClipStyle}>
          {cropMetrics && element.size ? (
            <div
              className="relative overflow-hidden"
              style={{
                width: element.size.width,
                height: element.size.height,
              }}
            >
              <div
                className="absolute"
                style={{
                  left: cropMetrics.offsetX,
                  top: cropMetrics.offsetY,
                  width: cropMetrics.contentWidth,
                  height: cropMetrics.contentHeight,
                }}
              >
                <ElementVisuals
                  element={croppedElement}
                  renderGroupMembers={false}
                  onUpdate={onUpdate}
                  isSelected={isSelected}
                  allowEditing={activeTool !== "crop" && (permissions.canEditText || canResize || canMove || (element.type !== "embed" && permissions.canEditContent))}
                  allowContentEditing={permissions.canEditContent}
                  activeTool={activeTool}
                  showGrid={showGrid}
                  gridColor={gridColor}
                  gridSize={gridSize}
                  gridThickness={gridThickness}
                  elements={elements}
                  onJumpToTarget={onJumpToTarget}
                  onLinkEdit={onLinkEdit}
                  onTextSelect={onTextSelect}
                />
              </div>
            </div>
          ) : (
            <ElementVisuals
              element={croppedElement}
              renderGroupMembers={false}
              onUpdate={onUpdate}
              isSelected={isSelected}
              allowEditing={activeTool !== "crop" && (permissions.canEditText || canResize || canMove || (element.type !== "embed" && permissions.canEditContent))}
                  allowContentEditing={permissions.canEditContent}
              activeTool={activeTool}
              showGrid={showGrid}
              gridColor={gridColor}
              gridSize={gridSize}
              gridThickness={gridThickness}
              elements={elements}
              onJumpToTarget={onJumpToTarget}
              onLinkEdit={onLinkEdit}
              onTextSelect={onTextSelect}
            />
          )}
            </div>

        {isSelected && element.linkToId && (
          <button
            onPointerDown={(e) => {
              e.stopPropagation();
              e.preventDefault();
              if (onJumpToTarget) onJumpToTarget(element.linkToId!);
            }}
            className="absolute top-[-36px] right-0 bg-white border-[2.5px] border-blue-500 rounded-xl px-2.5 py-1.5 shadow-md hover:bg-blue-50 hover:shadow-lg transition-all z-[100] flex items-center gap-1.5 group font-bold text-blue-600 scale-90 origin-bottom-right"
            title="Follow Link"
          >
            <ArrowUpRight className="w-4 h-4 stroke-[3]" />
            <span className="text-[11px] tracking-wide uppercase leading-none mt-[1px]">
              Jump
            </span>
          </button>
        )}

        {isSelected && canResize && (
          <>
            {/* Rotation Handle */}
            {element.type !== "board" && (
              <>
                <button
                  type="button"
                  className="absolute top-[-122px] left-1/2 -translate-x-1/2 flex h-8 w-8 touch-none items-center justify-center rounded-full border-2 border-blue-500 bg-white text-blue-600 shadow-md cursor-grab active:cursor-grabbing z-50 hover:bg-blue-50 transition-colors rotate-handle pointer-events-auto"
                  title="Rotate"
                   onPointerDown={(e) => {
                     e.stopPropagation();
                     e.preventDefault();
                     activePointerGestureCleanupRef.current?.();
                     setInteractionPreview(null);
                     document.body.style.userSelect = "none";
                    document.body.style.cursor = "grabbing";
                    const boardRoot = nodeRef.current?.closest(
                      '[data-board-root="true"]',
                    ) as HTMLElement | null;
                    const boardSurfaceRect = boardRoot?.getBoundingClientRect();
                     if (!boardSurfaceRect) {
                       document.body.style.userSelect = "";
                       document.body.style.cursor = "";
                       return;
                     }
                     const pointerGesture = captureElementPointer(e);
                    const width =
                      element.size?.width ||
                      nodeRef.current?.offsetWidth ||
                      100;
                    const height =
                      element.size?.height ||
                      nodeRef.current?.offsetHeight ||
                      40;
                    const centerX =
                      boardSurfaceRect.left +
                      (element.position.x + width / 2) * zoomRef.current;
                    const centerY =
                      boardSurfaceRect.top +
                      (element.position.y + height / 2) * zoomRef.current;
                    const startRotation = element.rotation || 0;
                    const snapStep = spinSnapDegrees;
                    let latestRotation = startRotation;
                    const getPointerAngle = (event: PointerEvent | React.PointerEvent) =>
                      (Math.atan2(event.clientY - centerY, event.clientX - centerX) *
                        180) /
                      Math.PI;
                    const startPointerAngle = getPointerAngle(e);
                    let previousPointerAngle = startPointerAngle;
                    let unwrappedPointerAngle = startPointerAngle;
                    let pointerWasInsideDeadZone = false;
                    const minRotateRadius = Math.max(
                      40,
                      Math.min(width, height) * zoomRef.current * 0.25,
                    );

                     const onMove = (me: PointerEvent) => {
                       if (!pointerGesture.matches(me)) return;
                       const dx = me.clientX - centerX;
                      const dy = me.clientY - centerY;
                      const distanceFromCenter = Math.hypot(dx, dy);
                      if (distanceFromCenter < minRotateRadius) {
                        pointerWasInsideDeadZone = true;
                        return;
                      }
                      const currentPointerAngle = getPointerAngle(me);
                      if (pointerWasInsideDeadZone) {
                        // Re-anchor after crossing the unstable center instead
                        // of applying the angle from the opposite side at once.
                        previousPointerAngle = currentPointerAngle;
                        pointerWasInsideDeadZone = false;
                        return;
                      }
                      const pointerDelta = normalizeAngleDelta(
                        currentPointerAngle - previousPointerAngle,
                      );
                      previousPointerAngle = currentPointerAngle;
                      unwrappedPointerAngle += pointerDelta;
                      const rawRotation =
                        startRotation +
                        (unwrappedPointerAngle - startPointerAngle);
                      const nextRotation =
                        spinSnapEnabled
                          ? Math.round(rawRotation / Math.max(1, snapStep)) *
                            Math.max(1, snapStep)
                          : rawRotation;
                      latestRotation = Math.round(nextRotation);
                      onUpdate({ rotation: latestRotation }, true);
                     };
                     const cleanupPointerGesture = () => {
                       pointerGesture.release();
      onGuidesEnd?.();
                       window.removeEventListener("pointermove", onMove);
                      window.removeEventListener("pointerup", onUp);
                      window.removeEventListener("pointercancel", onCancel);
                      document.body.style.userSelect = "";
                      document.body.style.cursor = "";
                      if (
                        activePointerGestureCleanupRef.current ===
                        cleanupPointerGesture
                      ) {
                        activePointerGestureCleanupRef.current = null;
                      }
                    };
                    const commitRotation = () => {
                      onUpdate({ rotation: normalizeAngle(latestRotation) }, false);
                    };
                     const onUp = (upEvent: PointerEvent) => {
                       if (!pointerGesture.matches(upEvent)) return;
                       cleanupPointerGesture();
                       commitRotation();
                     };
                     const onCancel = (cancelEvent: PointerEvent) => {
                       if (!pointerGesture.matches(cancelEvent)) return;
                       cleanupPointerGesture();
                      commitRotation();
                    };
                    activePointerGestureCleanupRef.current = cleanupPointerGesture;
                    window.addEventListener("pointermove", onMove);
                    window.addEventListener("pointerup", onUp);
                    window.addEventListener("pointercancel", onCancel);
                  }}
                >
                  <RotateCw className="h-4 w-4 stroke-[2.5]" />
                </button>
                <div className="absolute top-[-91px] left-1/2 -translate-x-1/2 w-[1px] h-[91px] bg-blue-500 z-40 block pointer-events-none" />
              </>
            )}

            {/* Corners */}
            {(!isBoardInteraction ||
              activeTool === "select" ||
              isBoardResizeEnabled) && (
              <>
                {(["nw","ne","sw","se","n","s","w","e"] as const)
                  .filter(dir => dir.length === 2 || showEdgeResizeHandles)
                  .map(dir => <div key={dir} data-resize-handle={dir}
                    className={`absolute touch-none bg-white border border-blue-600 cursor-${dir}-resize z-50`}
                    style={{
                      width:handleSize,height:handleSize,borderWidth:1/Math.max(.01,zoomRef.current),
                      left:dir.includes('w')?'0%':dir.includes('e')?'100%':'50%',
                      top:dir.includes('n')?'0%':dir.includes('s')?'100%':'50%',
                      transform:'translate(-50%, -50%)',cursor:`${dir}-resize`,
                    }}
                    onPointerDown={event=>handleResizePointerDown(event,dir)}
                  />)}
              </>
            )}
          </>
        )}
      </div>
    </motion.div>
    {interactionPreviewPortal}
    {boardHandlePortal}
    </>
  );
}

// Scene geometry and pointer callbacks both affect rendering/interaction.
// Default comparison keeps those dependencies instead of silently ignoring them.
const MemoizedBoardElementNode = React.memo(BoardElementNode);

const ContentEditableText = ({
  content,
  onUpdate,
  className,
  style,
  placeholder,
  allowEditing = true,
  maxHeight,
  autoFocus,
  onJumpToTarget,
  onTextSelect,
  activeTool,
  onLinkEdit,
  element,
  ariaLabel,
}: any) => {
  const ref = useRef<HTMLDivElement>(null);
  const isComposing = useRef(false);
  const onUpdateRef = useRef(onUpdate);
  const pendingContentRef = useRef<string | null>(null);
  const updateTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hasUncommittedHistoryRef = useRef(false);

  const commitPendingContent = (skipHistory = false) => {
    if (updateTimerRef.current) clearTimeout(updateTimerRef.current);
    updateTimerRef.current = null;
    const pending = pendingContentRef.current;
    pendingContentRef.current = null;
    const currentContent =
      pending ?? (ref.current ? sanitizeRichText(ref.current.innerHTML) : content);
    if (skipHistory) {
      if (pending !== null) onUpdateRef.current(currentContent, true);
      return;
    }
    if (hasUncommittedHistoryRef.current) {
      onUpdateRef.current(currentContent, false);
      hasUncommittedHistoryRef.current = false;
    }
  };

  const queueContentUpdate = (nextContent: string, immediate = false) => {
    if (pendingContentRef.current === nextContent) return;
    if (nextContent === content && pendingContentRef.current === null) return;
    hasUncommittedHistoryRef.current = true;
    pendingContentRef.current = nextContent;
    if (updateTimerRef.current) clearTimeout(updateTimerRef.current);
    if (immediate) {
      commitPendingContent(true);
      return;
    }
    updateTimerRef.current = setTimeout(() => commitPendingContent(true), 250);
  };

  useEffect(() => {
    onUpdateRef.current = onUpdate;
  }, [onUpdate]);

  useEffect(
    () => () => {
      if (updateTimerRef.current) clearTimeout(updateTimerRef.current);
    },
    [],
  );

  useEffect(() => {
    const sanitizedContent = sanitizeRichText(content || "");
    if (ref.current) replaceTextEditorHtml(ref.current, sanitizedContent);
    if (sanitizedContent !== (content || "")) {
      onUpdateRef.current(sanitizedContent);
    }
  }, [content]);

  useEffect(() => {
    if (autoFocus && ref.current && allowEditing) {
      setTimeout(() => {
        if (ref.current) {
          ref.current.focus();
          // Move cursor to the end
          const range = document.createRange();
          const sel = window.getSelection();
          if (sel) {
            range.selectNodeContents(ref.current);
            range.collapse(false);
            sel.removeAllRanges();
            sel.addRange(range);
          }
        }
      }, 50);
    }
  }, [autoFocus, allowEditing]);

  useEffect(() => {
    const el = ref.current;
    if (!el || !allowEditing) return;
    const observer = new MutationObserver(() => {
      if (isComposing.current) return;
      const sanitizedContent = sanitizeRichText(el.innerHTML);
      replaceTextEditorHtml(el, sanitizedContent);
      if (sanitizedContent !== content) {
        queueContentUpdate(sanitizedContent);
      }
    });
    observer.observe(el, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
    });
    return () => observer.disconnect();
  }, [content, allowEditing]);

  const adjustedMaxHeight = maxHeight ? Math.max(maxHeight, 48) : undefined;
  const canEditText =
    allowEditing &&
    activeTool !== "pan" &&
      (TEXT_TYPES.includes(activeTool ?? "") ||
      activeTool === "sticky" ||
      activeTool === "link" ||
      (element?.type === "section" &&
        (activeTool === "select" || activeTool === "section")));

  return (
    <div
      ref={ref}
      data-board-element-editor-id={element?.id}
      role={ariaLabel ? "textbox" : undefined}
      aria-label={ariaLabel}
      aria-multiline={ariaLabel ? false : undefined}
      contentEditable={
        canEditText &&
        (!element?.linkToId ||
          activeTool === "link" ||
          activeTool === "text")
      }
      suppressContentEditableWarning
      className={cn("content-editable-text [&_a]:cursor-pointer", className)}
      style={{
        ...style,
        height: "auto",
        minHeight: style?.minHeight || "100%",
        maxHeight: adjustedMaxHeight ? `${adjustedMaxHeight}px` : undefined,
        overflow: maxHeight ? "hidden" : undefined,
        overflowX: "hidden",
      }}
      onInput={(e) => {
        if (ref.current) ref.current.scrollTop = 0;
        if (isComposing.current) return;
        const sanitizedContent = sanitizeRichText(e.currentTarget.innerHTML);
        replaceTextEditorHtml(e.currentTarget, sanitizedContent);
        queueContentUpdate(sanitizedContent);
      }}
      onPaste={(event) => {
        event.preventDefault();
        const html = event.clipboardData.getData("text/html");
        if (html) {
          document.execCommand("insertHTML", false, sanitizeRichText(html));
        } else {
          document.execCommand(
            "insertText",
            false,
            event.clipboardData.getData("text/plain"),
          );
        }
      }}
      onScroll={() => {
        if (ref.current) ref.current.scrollTop = 0;
      }}
      onCompositionStart={() => (isComposing.current = true)}
      onCompositionEnd={(e) => {
        isComposing.current = false;
        if (ref.current) ref.current.scrollTop = 0;
        const sanitizedContent = sanitizeRichText(e.currentTarget.innerHTML);
        replaceTextEditorHtml(e.currentTarget, sanitizedContent);
        queueContentUpdate(sanitizedContent, true);
      }}
      onBlur={() => commitPendingContent(false)}
      onKeyDown={(e) => e.stopPropagation()}
      onMouseUp={() => {
        if (allowEditing && window.getSelection()) {
          const sel = window.getSelection();
          if (sel && !sel.isCollapsed && sel.rangeCount > 0) {
            onTextSelect && onTextSelect(sel.getRangeAt(0));
          }
        }
      }}
      onClick={(e) => {
        const target = e.target as HTMLElement;
        const anchor = target.closest("a");
        if (anchor) {
          const href = anchor.getAttribute("href");
          if (href && href.includes("#target-")) {
            e.preventDefault();
            e.stopPropagation();
            const targetId = href.split("#target-")[1];
            if (activeTool === "link") {
              if (onLinkEdit) onLinkEdit(targetId);
            } else {
              if (onJumpToTarget) onJumpToTarget(targetId);
            }
          }
        }
      }}
      onMouseDown={(e) => {
        const target = e.target as HTMLElement;
        const anchor = target.closest("a");
        if (anchor && anchor.getAttribute("href")?.includes("#target-")) {
          // Prevent board dragging or element selection when clicking a link
          e.stopPropagation();
          // In some browsers, clicking a link in contentEditable just focuses the text.
          // To ensure jump works immediately, we trigger the logic here if it's not the link tool.
          if (activeTool !== "link") {
            e.preventDefault();
            const targetId = anchor.getAttribute("href")?.split("#target-")[1];
            if (targetId && onJumpToTarget) {
              onJumpToTarget(targetId);
            }
          }
        }
      }}
      data-placeholder={placeholder}
    />
  );
};

function WebBrowserElement({
  element,
  onUpdate,
  allowEditing,
  allowContentEditing = false,
  isSelected,
  containerStyle,
}: {
  element: BoardElement;
  onUpdate: (u: Partial<BoardElement>) => void;
  allowEditing?: boolean;
  allowContentEditing?: boolean;
  isSelected?: boolean;
  containerStyle: React.CSSProperties;
}) {
  const [linkInputVal, setLinkInputVal] = useState("");
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState("");
  const [retryVersion, setRetryVersion] = useState(0);
  const [editingUrl, setEditingUrl] = useState(false);
  const [sessionCleared, setSessionCleared] = useState(false);
  const [configuredPartition, setConfiguredPartition] = useState('');
  const appliedPrivacyRef = useRef('');
  const webviewRef = useRef<any>(null);
  const settings = getWebSettings(element);
  const normalizedContent = normalizeWebUrl(element.content);
  const isElectron = hasDesktopWebRuntime();
  const browserSource = getBrowserWebSource(normalizedContent);

  const partition = getWebPartition(element);
  const privacyIdentity = `${partition}:${settings.adBlock}:${settings.cookieBlocker}:${settings.popupBlocker}`;
  const frameIdentity = isElectron ? `${partition}-${settings.deviceMode}` : `${normalizedContent}:${settings.popupBlocker}`;
  useEffect(() => { setLoadState("loading"); setLoadError(""); }, [frameIdentity, retryVersion, editingUrl]);

  useEffect(() => {
    if (isElectron || !normalizedContent || editingUrl || browserSource.requiresDesktop || loadState !== "loading") return;
    const timeout = window.setTimeout(() => {
      setLoadState("error");
      setLoadError("This page did not load in the embedded browser. Retry or open it in your browser.");
    }, 15000);
    return () => window.clearTimeout(timeout);
  }, [isElectron, frameIdentity, retryVersion, editingUrl, browserSource.requiresDesktop, loadState]);

  useEffect(() => {
    if (!normalizedContent || !isElectron) return;
    let current = true;
    configureElectronWebSession(element, normalizedContent).then(configured => {
      if (!current) return;
      if (!configured) {
        setLoadState('error'); setLoadError('Could not apply the Web settings. Please retry.');
        return;
      }
      setConfiguredPartition(partition);
      if (appliedPrivacyRef.current && appliedPrivacyRef.current !== privacyIdentity) {
        try { webviewRef.current?.reload?.(); } catch { /* The new guest may still be attaching. */ }
      }
      appliedPrivacyRef.current = privacyIdentity;
    });
    return () => { current = false; };
  }, [
    normalizedContent,
    isElectron,
    element.id,
    element.webSessionId,
    element.webRememberSession,
    element.webAdBlock,
    element.webCookieBlocker,
    element.webPopupBlocker,
    retryVersion,
  ]);

  const applyUrl = (rawUrl: string) => {
    const url = normalizeWebUrl(rawUrl);
    if (!url) { setLoadError("Enter a valid http or https address."); return; }
    onUpdate({
      content: url,
      mediaKind: "web",
      webSessionId: element.webSessionId || element.id,
      webRememberSession: element.webRememberSession !== false,
      webDeviceMode: settings.deviceMode,
      webAdBlock: settings.adBlock,
      webCookieBlocker: settings.cookieBlocker,
      webPopupBlocker: settings.popupBlocker,
    });
    setLinkInputVal("");
    setEditingUrl(false);
  };

  return (
    <div
      className="bg-slate-100 flex flex-col items-center justify-center text-slate-500 gap-3 shadow-lg relative overflow-hidden group"
      style={{
        ...containerStyle,
        width: Math.max(
          element.size?.width || WEB_DEFAULT_SIZE.width,
          MIN_WEB_SIZE.width,
        ),
        height: Math.max(
          element.size?.height || WEB_DEFAULT_SIZE.height,
          MIN_WEB_SIZE.height,
        ),
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onDrop={(e) => {
        e.preventDefault();
        e.stopPropagation();
        const url =
          e.dataTransfer.getData("text/uri-list") ||
          e.dataTransfer.getData("text/plain");
        if (url) applyUrl(url);
      }}
    >
      {normalizedContent && !editingUrl ? (
        isElectron ? configuredPartition !== partition ? null : (
          <NativeWebView
            key={`${partition}-${settings.deviceMode}-${retryVersion}`}
            elementId={element.id} src={normalizedContent} partition={partition}
            deviceMode={settings.deviceMode} interactive={!allowEditing} guestRef={webviewRef}
            onReady={() => { setLoadState('ready'); setLoadError(''); }}
            onLoading={() => setLoadState(current => current === 'ready' ? current : 'loading')}
            onError={message => { setLoadState('error'); setLoadError(message); }}
            onNavigate={url => {
              configureElectronWebSession(element, url);
              if (normalizeWebUrl(url) !== normalizedContent) onUpdate({ content: url });
            }}
          />
        ) : browserSource.requiresDesktop ? (
          <div onPointerDown={event => event.stopPropagation()} className="px-5 text-center text-xs text-slate-600"><Globe2 className="mx-auto mb-2 h-7 w-7" /><p>This YouTube page is available in the desktop app or your browser.</p><a href={normalizedContent} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block rounded-lg bg-white px-3 py-2 font-bold text-blue-600 pointer-events-auto">Open YouTube</a></div>
        ) : (
          <iframe
            ref={webviewRef}
            key={`${retryVersion}-${settings.popupBlocker}`}
            src={browserSource.url}
            title={browserSource.youtube ? "YouTube player" : "Web page"}
            referrerPolicy="strict-origin-when-cross-origin"
            allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
            allowFullScreen
            onLoad={() => { setLoadState("ready"); setLoadError(""); }}
            onError={() => { setLoadState("error"); setLoadError("The page could not be loaded here."); }}
            className={cn(
              "w-full h-full bg-white",
              allowEditing ? "pointer-events-none" : "pointer-events-auto",
            )}
            frameBorder="0"
            scrolling="auto"
            sandbox={cn(
              "allow-forms allow-scripts allow-same-origin allow-downloads",
              !settings.popupBlocker && "allow-popups allow-popups-to-escape-sandbox",
            )}
          />
        )
      ) : (
        <div className="w-full h-full min-w-[240px] min-h-[140px] flex flex-col items-center justify-center gap-2 px-4 py-3 text-center">
          <Globe2 className="w-7 h-7 text-slate-500 pointer-events-none" />
          <div className="flex flex-col items-center gap-2 w-full">
            <input
              type="text"
              disabled={!allowEditing && !allowContentEditing}
              placeholder="Paste web link..."
              value={linkInputVal}
              onChange={(e) => setLinkInputVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") applyUrl(linkInputVal);
              }}
              onPointerDown={(e) => e.stopPropagation()}
              className={cn(
                "bg-white border border-slate-300 text-slate-700 px-3 py-1.5 rounded-lg text-xs font-semibold hover:bg-white focus:bg-white focus:outline-none transition-colors w-full max-w-[230px] text-center shadow-sm placeholder:text-slate-400 placeholder:font-semibold",
                allowEditing || allowContentEditing ? "pointer-events-auto" : "pointer-events-none",
              )}
            />
            {loadError && <p role="alert" className="text-xs text-red-600">{loadError}</p>}
          </div>
        </div>
      )}

      {normalizedContent && !editingUrl && !browserSource.requiresDesktop && loadState === "loading" && !loadError && <div role="status" className="pointer-events-none absolute bottom-2 left-2 rounded bg-white/90 px-2 py-1 text-[10px] text-slate-500">Loading page…</div>}
      {normalizedContent && !editingUrl && !!loadError && <div onPointerDown={event => event.stopPropagation()} className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-slate-50 p-4 text-center"><p role="alert" className="text-xs text-slate-600">{loadError}</p><button type="button" onClick={() => setRetryVersion(v => v + 1)} className="rounded-lg border bg-white px-3 py-1 text-xs font-bold pointer-events-auto">Retry</button><a href={normalizedContent} target="_blank" rel="noopener noreferrer" className="text-xs font-semibold text-blue-600 pointer-events-auto">Open in browser</a></div>}

      {normalizedContent && isSelected && (
        <div className="absolute top-2 right-2 z-30 flex max-w-[calc(100%-1rem)] items-center justify-end gap-1 overflow-hidden opacity-0 transition-opacity group-hover:opacity-100">
          {!isElectron && <a href={normalizedContent} target="_blank" rel="noopener noreferrer" onPointerDown={event => event.stopPropagation()} title="Open in browser" aria-label="Open in browser" className="flex h-7 w-7 items-center justify-center rounded-md bg-white text-slate-900 shadow-sm ring-1 ring-black/10 pointer-events-auto"><ArrowUpRight className="h-3.5 w-3.5" /></a>}
          <button type="button" title="Edit web address" aria-label="Edit web address" onPointerDown={event => { event.preventDefault(); event.stopPropagation(); setLinkInputVal(normalizedContent); setEditingUrl(true); }} className="h-7 rounded-md bg-white px-2 text-[10px] font-bold text-slate-900 shadow-sm ring-1 ring-black/10 pointer-events-auto">URL</button>
          {isElectron && (
            <button
              className="h-7 shrink-0 rounded-md bg-white px-2 text-[10px] font-bold text-slate-900 shadow-sm ring-1 ring-black/10 hover:bg-blue-50 pointer-events-auto"
              onPointerDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
                clearElectronWebSession(element).then((cleared) => {
                  if (!cleared) return;
                  setSessionCleared(true);
                  window.setTimeout(() => setSessionCleared(false), 1200);
                  try {
                    webviewRef.current?.reloadIgnoringCache?.();
                  } catch {}
                });
              }}
              title="Clear Web Session"
            >
              {sessionCleared ? "Cleared" : "Clear"}
            </button>
          )}
          <button
            className="h-7 shrink-0 rounded-md bg-white px-2 text-[10px] font-bold text-slate-900 shadow-sm ring-1 ring-black/10 hover:bg-blue-50 pointer-events-auto"
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              try {
                if (isElectron) {
                  webviewRef.current?.reload?.();
                } else if (webviewRef.current) {
                  setRetryVersion(version => version + 1);
                }
              } catch {}
            }}
            title="Reload"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

function ElementVisuals({
  element,
  onUpdate,
  isSelected,
  allowEditing = true,
  allowContentEditing = false,
  activeTool,
  showGrid,
  gridColor,
  gridSize,
  gridThickness,
  onJumpToTarget,
  onLinkEdit,
  onTextSelect,
  elements=[],
  renderGroupMembers=true,
}: {
  element: BoardElement;
  onUpdate: (u: Partial<BoardElement>, skipHistory?: boolean) => void;
  isSelected?: boolean;
  allowEditing?: boolean;
  allowContentEditing?: boolean;
  activeTool?: string;
  showGrid?: boolean;
  gridColor?: string;
  gridSize?: number;
  gridThickness?: number;
  elements?: BoardElement[];
  renderGroupMembers?: boolean;
  onJumpToTarget?: (id: string) => void;
  onLinkEdit?: (targetId: string) => void;
  onTextSelect?: (range: Range, elementId: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isVideoPlaying, setIsVideoPlaying] = useState(false);
  const [videoDuration, setVideoDuration] = useState(0);
  const [videoCurrentTime, setVideoCurrentTime] = useState(0);
  const [isAudioPlaying, setIsAudioPlaying] = useState(false);
  const [audioDuration, setAudioDuration] = useState(0);
  const [audioCurrentTime, setAudioCurrentTime] = useState(0);

  const toggleVideoPlayback = (e?: React.PointerEvent | React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => {});
    } else {
      video.pause();
    }
  };

  const seekVideo = (percent: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration) || video.duration <= 0) {
      return;
    }
    video.currentTime = Math.max(0, Math.min(video.duration, video.duration * percent));
  };

  const toggleAudioPlayback = (e?: React.PointerEvent | React.MouseEvent) => {
    e?.preventDefault();
    e?.stopPropagation();
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      audio.play().catch(() => {});
    } else {
      audio.pause();
    }
  };

  const seekAudio = (percent: number) => {
    const audio = audioRef.current;
    if (!audio || !Number.isFinite(audio.duration) || audio.duration <= 0) {
      return;
    }
    audio.currentTime = Math.max(0, Math.min(audio.duration, audio.duration * percent));
  };

  const formatVideoTime = (seconds: number) => {
    if (!Number.isFinite(seconds) || seconds <= 0) return "0:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60)
      .toString()
      .padStart(2, "0");
    return `${mins}:${secs}`;
  };

  const {
    type,
    content,
    color,
    size,
    borderWidth,
    borderColor,
    textColor,
    textAlign,
    borderRadius,
  } = element;

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = element.mediaPlaybackRate || 1;
      videoRef.current.volume = Math.max(
        0,
        Math.min(1, element.mediaVolume ?? 1),
      );
    }
    if (audioRef.current) {
      audioRef.current.playbackRate = element.mediaPlaybackRate || 1;
      audioRef.current.volume = Math.max(
        0,
        Math.min(1, element.mediaVolume ?? 1),
      );
    }
  }, [content, element.mediaPlaybackRate, element.mediaVolume]);

  const containerStyle = {
    ...(size ? { width: size.width, height: size.height } : {}),
    borderWidth: borderWidth ? `${borderWidth}px` : undefined,
    borderStyle: borderWidth ? "solid" : undefined,
    borderColor: borderColor || "#000000",
    backgroundColor: color || undefined,
    borderRadius: borderRadius !== undefined ? `${borderRadius}px` : undefined,
  };

  const textStyle = {
    color: textColor || undefined,
    textAlign: textAlign || undefined,
  };

  switch (type) {
    case "draw": {
      if (!element.points || element.points.length === 0) return null;
      let mw = 1;
      let mh = 1;
      mw = Math.max(1, Math.max(...element.points.map((p) => p.x)));
      mh = Math.max(1, Math.max(...element.points.map((p) => p.y)));

      return (
        <svg
          style={{
            ...containerStyle,
            width: size?.width || 100,
            height: size?.height || 100,
            borderWidth: undefined,
            borderStyle: undefined,
            borderColor: undefined,
            backgroundColor: "transparent",
          }}
          className="overflow-visible"
          viewBox={`0 0 ${mw} ${mh}`}
          preserveAspectRatio="none"
        >
          <path
            d={getSvgPathFromPoints(
              element.points,
              element.isSmooth,
              element.drawingAssistSmoothStrength ?? 5,
            )}
            fill="none"
            stroke={borderColor || "#000000"}
            strokeWidth={borderWidth || 4}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
          />
        </svg>
      );
    }
    case "line": {
      const w = size?.width || 100;
      const h = size?.height || 40;
      const bw = borderWidth || 4;
      return (
        <div
          className="relative pointer-events-none"
          style={{
            ...containerStyle,
            borderWidth: undefined,
            borderStyle: undefined,
            borderColor: undefined,
            backgroundColor: "transparent",
          }}
        >
          {allowEditing && (
            <div
              className="absolute left-0 top-1/2 -translate-y-1/2 pointer-events-auto"
              style={{
                width: w,
                height: Math.max(4, bw),
                cursor: "move",
              }}
            />
          )}
          <svg
            width={w}
            height={h}
            className="pointer-events-none"
            style={{ overflow: "visible", cursor: allowEditing ? "move" : "default" }}
          >
            <line
              x1="0"
              y1={h / 2}
              x2={w}
              y2={h / 2}
              stroke={borderColor || "#000"}
              strokeWidth={bw}
              strokeLinecap="round"
              pointerEvents={allowEditing ? "stroke" : "none"}
            />
          </svg>
        </div>
      );
    }
    case "arrow": {
      const w = size?.width || 100;
      const h = size?.height || 40;
      const bw = Math.max(1, borderWidth || 4);
      const hw = Math.min(w * 0.4, h / 2);
      // Removed rotation from here since the wrapper handles it!
      return (
        <div
          style={{
            ...containerStyle,
            borderWidth: undefined,
            borderStyle: undefined,
            borderColor: undefined,
            backgroundColor: "transparent",
          }}
        >
          <svg
            width={Math.max(1, w)}
            height={Math.max(1, h)}
            style={{ overflow: "visible" }}
          >
            <path
              d={`M 0 ${h / 2} L ${w} ${h / 2} M ${w - hw * 1.5} ${h / 2 - hw} L ${w} ${h / 2} L ${w - hw * 1.5} ${h / 2 + hw}`}
              stroke={borderColor || "#000"}
              strokeWidth={bw}
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </div>
      );
    }
    case "rectangle":
      return (
        <div
          style={{ backgroundColor: color || "#ffffff", ...containerStyle }}
          className={cn(
            "flex flex-col overflow-hidden bg-white/50 shadow-sm min-w-[5px] min-h-[5px]",
            !borderWidth && "border-2 border-gray-800",
          )}
        />
      );
    case "h1":
    case "h2":
    case "h3":
    case "bullet-list":
    case "numbered-list":
    case "text": {
      const defaultFSize =
        type === "h1" ? 36 : type === "h2" ? 24 : type === "h3" ? 18 : 16;
      const textScale = getTextScale(element);
      const layoutSize = size ? { width: size.width / textScale, height: size.height / textScale } : undefined;
      const fSize = element.fontSize || defaultFSize;
      const lh = Math.round(fSize * 1.5);

      let wrapperClass = "relative flex overflow-hidden";
      let taClass =
        "text-base bg-transparent border-none outline-none resize-none w-full h-full prose prose-sm max-w-none focus:outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-gray-400 cursor-text break-words";

      if (type === "h1") {
        taClass += " font-bold text-4xl";
      } else if (type === "h2") {
        taClass += " font-bold text-2xl";
      } else if (type === "h3") {
        taClass += " font-bold text-lg";
      }

      let textMaxHeight: number | undefined = layoutSize?.height;

      const hasBorder = borderWidth !== undefined && borderWidth > 0;
      return (
        <div data-text-scale-shell={textScale} style={{ width: size?.width, height: size?.height }}>
        <div
          className={cn(
            wrapperClass,
            isSelected && !hasBorder
              ? "border-[1.5px] border-blue-500 bg-blue-500/10"
              : "",
          )}
          style={{
            minWidth: 20,
            minHeight: 20,
            width: layoutSize?.width,
            height: layoutSize?.height,
            transform: `scale(${textScale})`,
            transformOrigin: "0 0",
            backgroundColor:
              color === "transparent" ? "transparent" : color || "transparent",
            borderWidth: hasBorder
              ? `${borderWidth}px`
              : isSelected
                ? "1.5px"
                : "1.5px",
            borderStyle: hasBorder ? "solid" : isSelected ? "dashed" : "solid",
            borderColor: hasBorder
              ? borderColor || "#1e293b"
              : isSelected
                ? "rgba(59, 130, 246, 0.5)"
                : "transparent",
            borderRadius: borderRadius ? `${borderRadius}px` : undefined,
          }}
        >
          <ContentEditableText
            element={element}
            content={typeof content === "string" ? content : ""}
            onUpdate={(c: string, skipHistory?: boolean) =>
              onUpdate({ content: c }, skipHistory)
            }
            allowEditing={allowEditing}
            maxHeight={textMaxHeight}
            onJumpToTarget={onJumpToTarget}
            onLinkEdit={onLinkEdit}
            activeTool={activeTool}
            onTextSelect={(range) =>
              onTextSelect && onTextSelect(range, element.id)
            }
            className={cn(
              taClass,
              element.textSnapToGrid &&
                (element.textLinesMode === "everywhere"
                  ? "text-lines-everywhere"
                  : "text-lines-blocks"),
              allowEditing ? "pointer-events-auto" : "pointer-events-none",
              "[&_h1]:text-4xl [&_h1]:font-bold [&_h1]:my-0 [&_h1]:leading-[1.5] [&_h2]:text-2xl [&_h2]:font-bold [&_h2]:my-0 [&_h2]:leading-[1.5] [&_p]:leading-[1.5] [&_li]:leading-[1.5] [&_div]:leading-[1.5] [&_ul]:leading-[1.5] [&_ol]:leading-[1.5] [&_blockquote]:leading-[1.5] [&_ul]:list-disc [&_ul]:list-inside [&_ul]:pl-1 [&_ul]:ml-0 [&_ul]:my-0 [&_ol]:list-decimal [&_ol]:list-inside [&_ol]:pl-1 [&_ol]:ml-0 [&_ol]:my-0 [&_p]:my-0",
            )}
            style={{
              ...textStyle,
              color: textStyle.color || "#000000",
              lineHeight: `${lh}px`,
              fontSize: element.fontSize ? `${element.fontSize}px` : undefined,
              minHeight: `${lh}px`,
              "--text-line-color": element.borderColor || "#9ca3af",
            } as React.CSSProperties}
            placeholder=""
            autoFocus={
              allowEditing &&
              isTextToolActive(activeTool) &&
              (!content || content === "")
            }
          />
        </div>
        </div>
      );
    }
    case "sticky":
      return (
        <div
          style={{
            backgroundColor: color || "#fef3c7",
            minWidth: 50,
            ...containerStyle,
          }}
          className="shadow-lg p-5 flex flex-col text-sm border-black/5 overflow-hidden"
        >
          <ContentEditableText
            element={element}
            content={typeof content === "string" ? content : ""}
            onUpdate={(c: string, skipHistory?: boolean) =>
              onUpdate({ content: c }, skipHistory)
            }
            allowEditing={allowEditing}
            maxHeight={size?.height ? size.height - 40 : undefined}
            onJumpToTarget={onJumpToTarget}
            onLinkEdit={onLinkEdit}
            activeTool={activeTool}
            onTextSelect={(range) =>
              onTextSelect && onTextSelect(range, element.id)
            }
            className={cn(
              "flex-1 w-full h-full bg-transparent border-none outline-none resize-none font-medium leading-relaxed prose prose-sm max-w-none focus:outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-black/30 cursor-text [&_h1]:text-2xl [&_h1]:font-bold [&_h1]:my-0 [&_h2]:text-xl [&_h2]:font-bold [&_h2]:my-0 [&_ul]:list-disc [&_ul]:list-inside [&_ul]:pl-1 [&_ul]:ml-0 [&_ul]:my-0 [&_ol]:list-decimal [&_ol]:list-inside [&_ol]:pl-1 [&_ol]:ml-0 [&_ol]:my-0 [&_p]:my-0",
              allowEditing ? "pointer-events-auto" : "pointer-events-none",
            )}
            style={{
              ...textStyle,
              color: textStyle.color || "#000000",
              minHeight: 110,
            }}
            placeholder="Sticky note..."
            autoFocus={
              allowEditing &&
              isTextToolActive(activeTool) &&
              (!content || content === "")
            }
          />
        </div>
      );
    case "ellipse":
      return (
        <div
          style={{ backgroundColor: color || "#ffffff", ...containerStyle }}
          className={cn(
            "rounded-full flex flex-col overflow-hidden bg-white/50 shadow-sm min-w-[5px] min-h-[5px]",
            !borderWidth && "border-2 border-gray-800",
          )}
        />
      );
    case "triangle":
      return (
        <div
          style={
            size
              ? { width: size.width, height: size.height }
              : { width: "100%", height: "100%" }
          }
          className="relative min-w-[5px] min-h-[5px]"
        >
          <svg
            width="100%"
            height="100%"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 overflow-visible pointer-events-none"
          >
            <polygon
              points="50,0 100,100 0,100"
              fill={color || "#ffffff"}
              stroke={borderColor || "#000000"}
              strokeWidth={borderWidth || 0}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </div>
      );
    case "board":
      return (
        <div data-board-surface="true" className="relative"
          style={{ width: size?.width ?? 100, height: size?.height ?? 40, ...boardSurfaceStyle(element, { showGrid, gridColor, gridSize, gridThickness }) }} />
      );
    case "layer":
      return null;
    case "group": {
      if(!renderGroupMembers)return <div style={{width:size?.width??100,height:size?.height??40}} />;
      const hierarchy=createElementHierarchy(elements);
      const children=elements.filter(child=>hierarchy.isDescendantOf(child.id,element.id)).map(child=>localGroupElement(child,element));
      const localHierarchy=createElementHierarchy(children);
      return <div className="relative pointer-events-none" style={{width:size?.width??100,height:size?.height??40}}>
        {children.filter(child=>child.type!=='layer'&&!child.isEraser&&localHierarchy.isVisible(child.id,true)).sort(localHierarchy.compare).map((child,index)=><div key={child.id} className="absolute pointer-events-none"
          style={{left:child.position.x,top:child.position.y,width:child.size?.width,height:child.size?.height,zIndex:index+1,opacity:(child.opacity??100)/100,transform:`rotate(${child.rotation??0}deg)`,clipPath:getSectionClipPath(child,children)}}>
          <ElementVisuals element={child} elements={children} onUpdate={()=>{}} allowEditing={false}/>
        </div>)}
      </div>;
    }
    case "section": {
      return (
        <div
          style={{ backgroundColor: color || "transparent", ...containerStyle }}
          className={cn(
            "relative flex flex-col overflow-hidden shadow-sm min-w-[5px] min-h-[5px]",
            !borderWidth && "border-2 border-gray-800",
          )}
        >
          <ContentEditableText
            element={element}
            content={typeof content === "string" ? content : ""}
            onUpdate={(nextContent: string, skipHistory?: boolean) =>
              onUpdate({ content: nextContent }, skipHistory)
            }
            allowEditing={allowEditing}
            maxHeight={size?.height}
            onJumpToTarget={onJumpToTarget}
            onLinkEdit={onLinkEdit}
            activeTool={activeTool}
            className={cn(
              "h-full w-full overflow-auto bg-transparent p-2 text-sm outline-none",
              allowEditing ? "pointer-events-auto" : "pointer-events-none",
            )}
            style={{ color: textColor || "#0f172a" }}
            placeholder=""
            autoFocus={false}
          />
        </div>
      );
    }
    case "checklist":
      return (
        <div
          className="bg-white shadow-xl ring-4 ring-blue-500/5 p-6 overflow-hidden"
          style={{
            minWidth: 100,
            minHeight: 50,
            borderRadius: containerStyle.borderRadius || "16px",
            ...containerStyle,
            backgroundColor: color || "#ffffff",
          }}
        >
          <div className="flex items-center gap-2 mb-3 text-gray-400">
            <CheckSquare className="w-4 h-4" />
            <span
              className="text-xs font-semibold uppercase tracking-wider"
              style={{ color: textStyle.color }}
            >
              Checklist
            </span>
          </div>
          <ContentEditableText
            element={element}
            content={typeof content === "string" ? content : ""}
            onUpdate={(c: string, skipHistory?: boolean) =>
              onUpdate({ content: c }, skipHistory)
            }
            allowEditing={allowEditing}
            maxHeight={size?.height ? size.height - 84 : 200 - 84}
            onJumpToTarget={onJumpToTarget}
            onLinkEdit={onLinkEdit}
            activeTool={activeTool}
            onTextSelect={(range) =>
              onTextSelect && onTextSelect(range, element.id)
            }
            className={cn(
              "w-full h-[calc(100%-32px)] text-sm bg-transparent border-none outline-none resize-none leading-relaxed prose prose-sm max-w-none focus:outline-none empty:before:content-[attr(data-placeholder)] empty:before:text-gray-400 cursor-text [&_h1]:text-xl [&_h1]:font-bold [&_h1]:my-0 [&_h2]:text-lg [&_h2]:font-bold [&_h2]:my-0 [&_ul]:list-disc [&_ul]:list-inside [&_ul]:pl-1 [&_ul]:ml-0 [&_ul]:my-0 [&_ol]:list-decimal [&_ol]:list-inside [&_ol]:pl-1 [&_ol]:ml-0 [&_ol]:my-0 [&_p]:my-0",
              allowEditing ? "pointer-events-auto" : "pointer-events-none",
            )}
            style={{ ...textStyle, color: textStyle.color || "#374151" }}
            placeholder="- Item 1\n- Item 2"
          />
        </div>
      );
    case "blank":
      return (
        <div
          className="flex flex-col items-center justify-center text-gray-500 gap-2 overflow-hidden border-2 border-dashed border-gray-900 bg-gray-50/50 relative group"
          style={{
            width: size?.width || 200,
            height: size?.height || 200,
            ...containerStyle,
          }}
        >
          <SquareDashed className="w-8 h-8 opacity-50" />
        </div>
      );
    case "image":
      return (
        <div
          className="bg-gray-100 flex flex-col items-center justify-center text-gray-400 gap-2 shadow-sm relative group overflow-hidden"
          style={{
            width: size?.width || 256,
            height: size?.height || 192,
            ...containerStyle,
            backgroundColor: content
              ? "transparent"
              : containerStyle.backgroundColor,
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={(e) => {
            const file = e.dataTransfer.files?.[0];
            const fileMime = file ? inferFileMime(file) : "";
            if (file && fileMime.startsWith("image/")) {
              e.preventDefault();e.stopPropagation();
              handleImageUpload(file, (dataUrl, imgW, imgH) => {
                onUpdate({
                  content: dataUrl,
                  size: getScaledMediaSize(imgW, imgH),
                  crop: undefined,
                });
              });
            }
          }}
        >
          {content ? (
            <>
              <img
                src={content}
                alt="Board image"
                className={cn(
                  "absolute pointer-events-none",
                  element.keepRatio === false ? "object-fill" : "object-cover",
                )}
                style={{
                  left: 0,
                  top: 0,
                  width: "100%",
                  height: "100%",
                  borderRadius: containerStyle.borderRadius,
                }}
              />
              {isSelected && allowEditing && (
                <div
                  className="absolute inset-0 bg-black/40 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{
                    transform: `scaleX(${element.flipX ? -1 : 1}) scaleY(${element.flipY ? -1 : 1})`,
                    borderRadius: containerStyle.borderRadius,
                  }}
                >
                  <label
                    className="bg-white text-black px-3 py-1.5 rounded-md text-xs font-semibold cursor-pointer pointer-events-auto shadow-sm"
                    style={{
                      transform: `rotate(-${element.rotation || 0}deg)`,
                    }}
                  >
                    Replace
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) {
                          handleImageUpload(file, (dataUrl, imgW, imgH) =>
                            onUpdate({
                              content: dataUrl,
                              size: getScaledMediaSize(imgW, imgH),
                              crop: undefined,
                            }),
                          );
                        }
                      }}
                    />
                  </label>
                </div>
              )}
            </>
          ) : (
            <>
              <ImageIcon className="w-8 h-8 opacity-50 pointer-events-none" />
              <div className="flex flex-col items-center gap-2 w-full px-4">
                <input
                  type="text"
                  placeholder="Paste image URL..."
                  onChange={(e) => onUpdate({ content: e.target.value })}
                  onPointerDown={(e) => e.stopPropagation()}
                  className={cn(
                    "text-sm font-medium bg-transparent border-none text-center outline-none w-full text-gray-700",
                    allowEditing
                      ? "pointer-events-auto"
                      : "pointer-events-none",
                  )}
                />
                <span className="text-[10px] font-bold uppercase opacity-40">
                  or
                </span>
                <label
                  className={cn(
                    "bg-white/60 border border-gray-300 text-gray-600 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer hover:bg-white transition-colors w-[80%] text-center shadow-sm",
                    allowEditing
                      ? "pointer-events-auto"
                      : "pointer-events-none",
                  )}
                >
                  Choose File
                  <input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        handleImageUpload(file, (dataUrl, imgW, imgH) =>
                          onUpdate({
                            content: dataUrl,
                            size: getScaledMediaSize(imgW, imgH),
                            crop: undefined,
                          }),
                        );
                      }
                    }}
                  />
                </label>
              </div>
            </>
          )}
        </div>
      );
    case "media": {
      const mime = inferMediaMime(content, element.mediaMime);
      const isImage = mime.startsWith("image/") || mime === "image/url";
      const isAudio = mime.startsWith("audio/") || mime === "audio/url";
      const isVideo = mime.startsWith("video/") || mime === "video/url";
      const readMediaFile = (file: File) => {
        const fileMime = inferFileMime(file);
        if (!isSupportedMediaMime(fileMime)) return;
        try {
          assertFileSize(file.size, MAX_MEDIA_FILE_BYTES, "Media file");
        } catch (error) {
          alert(error instanceof Error ? error.message : "Media file is too large.");
          return;
        }
        if (fileMime.startsWith("image/")) {
          handleImageUpload(file, (dataUrl, imgW, imgH) => {
            onUpdate({
              content: dataUrl,
              // handleImageUpload may transcode large/non-PNG images to WebP;
              // persist the MIME of the bytes we actually store so archive
              // export/import can reconstruct them reliably.
              mediaMime: inferMediaMime(dataUrl, fileMime),
              mediaKind: "media",
              keepRatio: true,
              crop: undefined,
              size: getScaledMediaSize(imgW, imgH),
            });
          });
          return;
        }

        const reader = new FileReader();
        reader.onload = (ev) =>
          onUpdate({
            content: ev.target?.result as string,
            mediaMime: fileMime,
            mediaKind: "media",
            keepRatio: fileMime.startsWith("audio/") ? false : true,
            crop: undefined,
            size: fileMime.startsWith("audio/")
              ? AUDIO_DEFAULT_SIZE
              : MEDIA_DEFAULT_SIZE,
          });
        reader.readAsDataURL(file);
      };
      const videoCropMetrics = isVideo
        ? getCropRenderMetrics(size, element.crop)
        : null;
      const videoProgress =
        videoDuration > 0 ? Math.max(0, Math.min(1, videoCurrentTime / videoDuration)) : 0;
      const audioProgress =
        audioDuration > 0 ? Math.max(0, Math.min(1, audioCurrentTime / audioDuration)) : 0;
      const mediaWidth = content
        ? size?.width || MEDIA_DEFAULT_SIZE.width
        : Math.max(size?.width || MEDIA_DEFAULT_SIZE.width, MIN_MEDIA_SIZE.width);
      const mediaHeight = content
        ? size?.height || MEDIA_DEFAULT_SIZE.height
        : Math.max(size?.height || MEDIA_DEFAULT_SIZE.height, MIN_MEDIA_SIZE.height);

      return (
        <div
          className={cn(
            "flex flex-col items-center justify-center relative overflow-hidden group",
            content && (isAudio || isImage || isVideo)
              ? "bg-transparent text-slate-700 shadow-none"
              : "bg-slate-100 text-slate-600 shadow-sm",
          )}
          style={{
            ...containerStyle,
            width: mediaWidth,
            height: mediaHeight,
            backgroundColor:
              content && (isAudio || isImage || isVideo)
                ? "transparent"
                : containerStyle.backgroundColor,
            borderRadius: containerStyle.borderRadius,
          }}
          onDragOver={(e) => {
            e.preventDefault();
            e.stopPropagation();
          }}
          onDrop={(e) => {
            const file = e.dataTransfer.files?.[0];
            if (
              file &&
              isSupportedMediaMime(inferFileMime(file))
            ) {
              e.preventDefault();e.stopPropagation();
              readMediaFile(file);
            }
          }}
        >
          {content && isImage ? (
            <img
              src={content}
              alt="Media"
              className={cn(
                "absolute pointer-events-none",
                element.keepRatio === false ? "object-fill" : "object-cover",
              )}
              style={{
                left: 0,
                top: 0,
                width: "100%",
                height: "100%",
                borderRadius: containerStyle.borderRadius,
              }}
            />
          ) : content && isVideo ? (
            <div className="w-full h-full bg-transparent relative overflow-hidden">
              <div
                className="absolute"
                style={
                  videoCropMetrics
                    ? {
                        left: videoCropMetrics.offsetX,
                        top: videoCropMetrics.offsetY,
                        width: videoCropMetrics.contentWidth,
                        height: videoCropMetrics.contentHeight,
                      }
                    : { inset: 0 }
                }
              >
                <video
                  ref={videoRef}
                  src={content}
                  controls={false}
                  loop={!!element.mediaLoop}
                  playsInline
                  preload="auto"
                  className="w-full h-full object-fill bg-transparent pointer-events-none"
                  style={{ borderRadius: containerStyle.borderRadius }}
                  onPlay={() => setIsVideoPlaying(true)}
                  onPause={() => setIsVideoPlaying(false)}
                  onLoadedMetadata={(e) =>
                    setVideoDuration(e.currentTarget.duration || 0)
                  }
                  onTimeUpdate={(e) =>
                    setVideoCurrentTime(e.currentTarget.currentTime || 0)
                  }
                  onEnded={() => setIsVideoPlaying(false)}
                />
              </div>

              <button
                className={cn(
                  "absolute left-1/2 top-1/2 z-20 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/90 text-slate-900 shadow-lg ring-1 ring-black/10 transition-opacity hover:bg-white",
                  isVideoPlaying
                    ? "opacity-0 group-hover:opacity-100"
                    : "opacity-100",
                )}
                onPointerDown={toggleVideoPlayback}
                title={isVideoPlaying ? "Pause" : "Play"}
              >
                {isVideoPlaying ? (
                  <Pause className="h-5 w-5 fill-current" />
                ) : (
                  <Play className="ml-0.5 h-5 w-5 fill-current" />
                )}
              </button>

              {!element.mediaControlsHidden && (
                <div
                  className="absolute inset-x-2 bottom-2 z-20 flex min-w-0 items-center gap-2 rounded-lg bg-white/90 px-2 py-1.5 text-slate-900 opacity-0 shadow-lg ring-1 ring-black/10 backdrop-blur transition-opacity group-hover:opacity-100"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                >
                  <button
                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md hover:bg-slate-200"
                    onPointerDown={toggleVideoPlayback}
                    title={isVideoPlaying ? "Pause" : "Play"}
                  >
                    {isVideoPlaying ? (
                      <Pause className="h-4 w-4 fill-current" />
                    ) : (
                      <Play className="ml-0.5 h-4 w-4 fill-current" />
                    )}
                  </button>
                  <div
                    className="h-2 min-w-8 flex-1 cursor-pointer rounded-full bg-slate-300"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      const rect = e.currentTarget.getBoundingClientRect();
                      seekVideo((e.clientX - rect.left) / rect.width);
                    }}
                    title="Seek"
                  >
                    <div
                      className="h-full rounded-full bg-blue-600"
                      style={{ width: `${videoProgress * 100}%` }}
                    />
                  </div>
                  <span className="hidden min-[220px]:block shrink-0 whitespace-nowrap text-[10px] font-bold tabular-nums text-slate-600">
                    {formatVideoTime(videoCurrentTime)} /{" "}
                    {formatVideoTime(videoDuration)}
                  </span>
                </div>
              )}
            </div>
          ) : content && isAudio ? (
            <div className="w-full h-full bg-transparent text-slate-900 flex items-center justify-center px-2">
              <audio
                ref={audioRef}
                src={content}
                preload="metadata"
                className="hidden"
                onPlay={() => setIsAudioPlaying(true)}
                onPause={() => setIsAudioPlaying(false)}
                onLoadedMetadata={(e) =>
                  setAudioDuration(e.currentTarget.duration || 0)
                }
                onTimeUpdate={(e) =>
                  setAudioCurrentTime(e.currentTarget.currentTime || 0)
                }
                onEnded={() => setIsAudioPlaying(false)}
              />
              <div
                className="pointer-events-auto flex w-full min-w-0 items-center gap-2 rounded-xl bg-white/90 px-2.5 py-2 text-slate-900 shadow-lg ring-1 ring-black/10 backdrop-blur"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 hover:bg-slate-200"
                  onPointerDown={toggleAudioPlayback}
                  title={isAudioPlaying ? "Pause" : "Play"}
                >
                  {isAudioPlaying ? (
                    <Pause className="h-4 w-4 fill-current" />
                  ) : (
                    <Play className="ml-0.5 h-4 w-4 fill-current" />
                  )}
                </button>
                <Music className="h-4 w-4 shrink-0 text-blue-500" />
                <div
                  className="h-2 min-w-8 flex-1 cursor-pointer rounded-full bg-slate-300"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    const rect = e.currentTarget.getBoundingClientRect();
                    seekAudio((e.clientX - rect.left) / rect.width);
                  }}
                  title="Seek"
                >
                  <div
                    className="h-full rounded-full bg-blue-600"
                    style={{ width: `${audioProgress * 100}%` }}
                  />
                </div>
                <span className="hidden min-[230px]:block shrink-0 whitespace-nowrap text-[10px] font-bold tabular-nums text-slate-600">
                  {formatVideoTime(audioCurrentTime)} /{" "}
                  {formatVideoTime(audioDuration)}
                </span>
                <button
                  className="h-7 shrink-0 rounded-md bg-slate-100 px-2 text-[10px] font-bold text-slate-700 hover:bg-slate-200"
                  onPointerDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onUpdate({
                      mediaPlaybackRate: getNextVideoPlaybackRate(
                        element.mediaPlaybackRate,
                      ),
                    });
                  }}
                  title="Playback Speed"
                >
                  {(element.mediaPlaybackRate || 1).toString()}x
                </button>
                <Volume2 className="h-4 w-4 shrink-0 text-slate-500" />
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.05"
                  value={element.mediaVolume ?? 1}
                  className="w-14 accent-blue-600"
                  onPointerDown={(e) => e.stopPropagation()}
                  onChange={(e) =>
                    onUpdate({ mediaVolume: Number(e.target.value) })
                  }
                  title="Volume"
                />
              </div>
            </div>
          ) : (
            <div className="w-full h-full min-w-[180px] min-h-[96px] flex flex-col items-center justify-center gap-2 px-4 py-3 text-center bg-slate-50">
              <div className="flex items-center gap-2 text-slate-500">
                <ImageIcon className="w-4 h-4" />
                <Music className="w-4 h-4" />
                <Film className="w-4 h-4" />
              </div>
              <label
                className={cn(
                  "bg-white text-gray-900 border border-white/30 px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer hover:bg-blue-50 transition-colors w-full max-w-[210px] text-center shadow-sm",
                  "border-slate-300 hover:border-blue-400",
                  allowEditing ? "pointer-events-auto" : "pointer-events-none",
                )}
                onPointerDown={(e) => e.stopPropagation()}
              >
                  Choose Media
                <input
                  type="file"
                  accept="image/*,.gif,video/*,.mp4,audio/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) readMediaFile(file);
                  }}
                />
              </label>
              <span className="text-[10px] font-bold uppercase text-slate-500">
                Drop file here
              </span>
            </div>
          )}
          {content && isSelected && allowEditing && (
            <div className="absolute top-2 right-2 z-30 flex max-w-[calc(100%-1rem)] items-center justify-end gap-1 overflow-hidden opacity-0 transition-opacity group-hover:opacity-100">
              {isVideo && (
                <>
                  <button
                    className="h-7 shrink-0 rounded-md bg-white px-2 text-[10px] font-bold text-slate-900 shadow-sm ring-1 ring-black/10 hover:bg-blue-50 pointer-events-auto"
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onUpdate({
                        mediaPlaybackRate: getNextVideoPlaybackRate(
                          element.mediaPlaybackRate,
                        ),
                      });
                    }}
                    title="Playback Speed"
                  >
                    {(element.mediaPlaybackRate || 1).toString()}x
                  </button>
                  <button
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-white text-slate-900 shadow-sm ring-1 ring-black/10 hover:bg-blue-50 pointer-events-auto",
                      element.mediaLoop && "bg-blue-100 text-blue-700",
                    )}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onUpdate({ mediaLoop: !element.mediaLoop });
                    }}
                    title="Loop"
                  >
                    <Repeat2 className="h-4 w-4" />
                  </button>
                  <div className="flex h-7 shrink-0 items-center gap-1 rounded-md bg-white px-2 text-slate-900 shadow-sm ring-1 ring-black/10 pointer-events-auto">
                    <Volume2 className="h-3.5 w-3.5 text-slate-500" />
                    <input
                      type="range"
                      min="0"
                      max="1"
                      step="0.05"
                      value={element.mediaVolume ?? 1}
                      className="w-14 accent-blue-600"
                      onPointerDown={(e) => e.stopPropagation()}
                      onChange={(e) =>
                        onUpdate({ mediaVolume: Number(e.target.value) })
                      }
                      title="Volume"
                    />
                  </div>
                </>
              )}
              <label
                className="shrink-0 bg-white text-black px-2.5 py-1 rounded-md text-[11px] font-bold cursor-pointer pointer-events-auto shadow-sm"
                onPointerDown={(e) => e.stopPropagation()}
              >
                Replace
                <input
                  type="file"
                  accept="image/*,.gif,video/*,.mp4,audio/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) readMediaFile(file);
                  }}
                />
              </label>
            </div>
          )}
        </div>
      );
    }
    case "embed": {
      return (
        <WebBrowserElement
          allowContentEditing={allowContentEditing}
          element={element}
          onUpdate={onUpdate}
          allowEditing={allowEditing}
          isSelected={isSelected}
          containerStyle={containerStyle}
        />
      );
    }
    case "table":
      return <SpreadsheetElement element={element} onUpdate={onUpdate} isSelected={isSelected} allowEditing={allowEditing||allowContentEditing}/>;
    case "diamond":
      return (
        <div
          style={
            size
              ? { width: size.width, height: size.height }
              : { width: "100%", height: "100%" }
          }
          className="relative min-w-[5px] min-h-[5px]"
        >
          <svg
            width="100%"
            height="100%"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 overflow-visible pointer-events-none"
          >
            <polygon
              points="50,0 100,50 50,100 0,50"
              fill={color || "#ffffff"}
              stroke={borderColor || "#000000"}
              strokeWidth={borderWidth || 0}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </div>
      );
    case "hexagon":
      return (
        <div
          style={
            size
              ? { width: size.width, height: size.height }
              : { width: "100%", height: "100%" }
          }
          className="relative min-w-[5px] min-h-[5px]"
        >
          <svg
            width="100%"
            height="100%"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            className="absolute inset-0 overflow-visible pointer-events-none"
          >
            <polygon
              points="25,0 75,0 100,50 75,100 25,100 0,50"
              fill={color || "#ffffff"}
              stroke={borderColor || "#000000"}
              strokeWidth={borderWidth || 0}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </div>
      );
    default:
      return (
        <div className="p-4 bg-red-100 text-red-800 rounded">
          Unsupported Type
        </div>
      );
  }
}
