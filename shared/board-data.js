export const MAX_BOARD_ELEMENTS = 100_000;
export const MAX_BOARD_DIMENSION = 1_000_000;
export const CURRENT_BOARD_VERSION = 4;
export const MAX_SECTION_SHEETS = 10_000;
export const MAX_BOARD_FILE_BYTES = 128 * 1024 * 1024;
export const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 128 * 1024 * 1024;
// Portable board JSON supports the same documents as normal board storage.
// Total archive expansion remains bounded before any entry is read.
export const MAX_BOARD_JSON_BYTES = MAX_BOARD_FILE_BYTES;
// Media is embedded as base64 in board JSON. Keep one file comfortably below
// the 128 MB board-read boundary after the roughly 4/3 encoding expansion.
export const MAX_MEDIA_FILE_BYTES = 64 * 1024 * 1024;
export const MAX_ARCHIVE_ASSET_BYTES = MAX_MEDIA_FILE_BYTES;

const SAFE_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;
const SECTION_SHEET_ACTIONS = new Set(["auto-fit", "fill-down", "fill-right", "series"]);
const SECTION_SHEET_TRIGGERS = new Set(["manual", "shortcut", "cell-change"]);
const SECTION_SHEET_SHORTCUT_KEYS = new Set([
  "addRow",
  "addColumn",
  "fillDown",
  "fillRight",
  "autoFit",
  "series",
]);
const SECTION_SHEET_CELL_VALUE_TYPES = new Set([
  "auto",
  "text",
  "number",
  "date",
  "boolean",
]);
const MEDIA_KINDS = new Set(["media", "web"]);
const WEB_DEVICE_MODES = new Set(["desktop", "tablet", "phone"]);
const WEB_COOKIE_BLOCKERS = new Set(["off", "third-party", "all"]);

const isSafeId = (value) =>
  typeof value === "string" &&
  value.length > 0 &&
  value.length <= 200 &&
  SAFE_ID_PATTERN.test(value);

const columnIndexToLabel = (index) => {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
};

const sheetAddress = (row, column) => `${columnIndexToLabel(column)}${row + 1}`;

export function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return "0 MB";
  return `${Math.ceil(value / (1024 * 1024))} MB`;
}

export function assertFileSize(size, limit, label = "File") {
  if (!Number.isFinite(size) || size < 0) throw new Error(`${label} size is invalid.`);
  if (size > limit) {
    throw new Error(`${label} is too large. Maximum size is ${formatBytes(limit)}.`);
  }
}

export function getArchiveDeclaredSize(files) {
  return Object.values(files ?? {}).reduce((total, entry) => {
    if (!entry || entry.dir) return total;
    const declared = Number(entry._data?.uncompressedSize ?? 0);
    return total + (Number.isFinite(declared) && declared > 0 ? declared : 0);
  }, 0);
}

export function getArchiveEntryDeclaredSize(entry) {
  if (!entry || entry.dir) return 0;
  const declared = Number(entry._data?.uncompressedSize ?? 0);
  return Number.isFinite(declared) && declared > 0 ? declared : 0;
}

export function normalizeBoardId(value) {
  if (!isSafeId(value)) throw new Error("Board id is missing or invalid.");
  return value;
}

export function isSafeBoardWebLink(value) {
  if (typeof value !== "string" || value.length > 2_048) return false;
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
    const hostname = parsed.hostname.toLowerCase();
    return (
      hostname === "localhost" ||
      hostname.includes(".") ||
      /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname) ||
      hostname.includes(":")
    );
  } catch {
    return false;
  }
}

const isRecord = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const assertSettingsRecord = (value, label) => {
  if (!isRecord(value)) throw new Error(`${label} must be an object.`);
};

const assertOptionalSettingTypes = (settings, fields, label) => {
  for (const [field, type, maximumLength] of fields) {
    const value = settings[field];
    if (value === undefined) continue;
    if (
      typeof value !== type ||
      (type === "string" && value.length > maximumLength) ||
      (type === "number" && !Number.isFinite(value))
    ) {
      throw new Error(`${label}.${field} is invalid.`);
    }
  }
};

const assertSettingEnum = (settings, field, allowed, label) => {
  const value = settings[field];
  if (value !== undefined && !allowed.has(value)) {
    throw new Error(`${label}.${field} is invalid.`);
  }
};

const assertFiniteSettingProperties = (value, keys, label) => {
  for (const key of keys) {
    if (value[key] !== undefined && !Number.isFinite(value[key])) {
      throw new Error(`${label}.${key} is invalid.`);
    }
  }
};

const assertSettingsElementShape = (element, label, partial = false) => {
  assertSettingsRecord(element, label);
  if (!partial || element.id !== undefined) {
    if (!isSafeId(element.id)) throw new Error(`${label}.id is invalid.`);
  }
  if (!partial || element.type !== undefined) {
    if (typeof element.type !== "string" || !element.type || element.type.length > 50) {
      throw new Error(`${label}.type is invalid.`);
    }
  }
  if (!partial || element.position !== undefined) {
    assertSettingsRecord(element.position, `${label}.position`);
    if (
      !Number.isFinite(element.position.x) ||
      !Number.isFinite(element.position.y) ||
      Math.abs(element.position.x) > MAX_BOARD_DIMENSION ||
      Math.abs(element.position.y) > MAX_BOARD_DIMENSION
    ) {
      throw new Error(`${label}.position is invalid.`);
    }
  }
  if (element.size !== undefined) {
    assertSettingsRecord(element.size, `${label}.size`);
    if (
      !Number.isFinite(element.size.width) ||
      !Number.isFinite(element.size.height) ||
      element.size.width <= 0 ||
      element.size.height <= 0 ||
      element.size.width > MAX_BOARD_DIMENSION ||
      element.size.height > MAX_BOARD_DIMENSION
    ) {
      throw new Error(`${label}.size is invalid.`);
    }
  }
  if (element.content !== undefined && typeof element.content !== "string") {
    throw new Error(`${label}.content is invalid.`);
  }
  assertOptionalSettingTypes(
    element,
    [
      ["parentId", "string", 200],
      ["groupOriginalParentId", "string", 200],
      ["pixelFillBoardId", "string", 200],
      ["linkToId", "string", 2_048],
      ["color", "string", 200],
      ["borderColor", "string", 200],
      ["textColor", "string", 200],
      ["textLineColor", "string", 200],
      ["mediaMime", "string", 200],
      ["webSessionId", "string", 200],
      ["name", "string", 500],
      ["linkTargetName", "string", 500],
      ["zIndex", "number"],
      ["textScale", "number"],
      ["fontSize", "number"],
      ["fontWeight", "number"],
      ["lineHeight", "number"],
      ["borderWidth", "number"],
      ["textLineThickness", "number"],
      ["textLineSpacing", "number"],
      ["borderRadius", "number"],
      ["opacity", "number"],
      ["rotation", "number"],
      ["mediaPlaybackRate", "number"],
      ["mediaVolume", "number"],
      ["drawingAssistSmoothStrength", "number"],
      ["drawingAssistStrength", "number"],
      ["turnSnapDegrees", "number"],
      ["mediaKind", "string", 20],
      ["webDeviceMode", "string", 20],
      ["webCookieBlocker", "string", 30],
      ["previewMode", "string", 20],
      ["strokeLinejoin", "string", 20],
      ["sectionCollision", "string", 20],
      ["eraserShape", "string", 20],
      ["textLinesMode", "string", 20],
    ],
    label,
  );
  if (
    element.textScale !== undefined &&
    (element.textScale <= 0 || element.textScale > MAX_BOARD_DIMENSION)
  ) {
    throw new Error(`${label}.textScale is invalid.`);
  }
  if (
    element.textLineThickness !== undefined &&
    (element.textLineThickness < 0.25 || element.textLineThickness > 100)
  ) {
    throw new Error(`${label}.textLineThickness is invalid.`);
  }
  if (
    element.textLineSpacing !== undefined &&
    (element.textLineSpacing < 1 || element.textLineSpacing > MAX_BOARD_DIMENSION)
  ) {
    throw new Error(`${label}.textLineSpacing is invalid.`);
  }
  if (
    element.mediaPlaybackRate !== undefined &&
    (element.mediaPlaybackRate < 0.1 || element.mediaPlaybackRate > 16)
  ) {
    throw new Error(`${label}.mediaPlaybackRate is invalid.`);
  }
  if (
    element.mediaVolume !== undefined &&
    (element.mediaVolume < 0 || element.mediaVolume > 1)
  ) {
    throw new Error(`${label}.mediaVolume is invalid.`);
  }
  if (element.parentId !== undefined && !isSafeId(element.parentId)) {
    throw new Error(`${label}.parentId is invalid.`);
  }
  if (
    element.groupOriginalParentId !== undefined &&
    !isSafeId(element.groupOriginalParentId)
  ) {
    throw new Error(`${label}.groupOriginalParentId is invalid.`);
  }
  if (element.pixelFillBoardId !== undefined && !isSafeId(element.pixelFillBoardId)) {
    throw new Error(`${label}.pixelFillBoardId is invalid.`);
  }
  if (element.points !== undefined) {
    if (!Array.isArray(element.points) || element.points.length > 1_000_000) {
      throw new Error(`${label}.points is invalid.`);
    }
    for (const point of element.points) {
      if (
        !isRecord(point) ||
        !Number.isFinite(point.x) ||
        !Number.isFinite(point.y)
      ) {
        throw new Error(`${label}.points contains an invalid point.`);
      }
    }
  }
  for (const field of [
    "keepRatio",
    "textScaling",
    "textLineCapacityLimit",
    "mediaControlsHidden",
    "mediaLoop",
    "webRememberSession",
    "webAdBlock",
    "webPopupBlocker",
    "isSmooth",
    "drawingAssistSmooth",
    "drawingAssistGuess",
    "turnSnap",
    "flipX",
    "flipY",
    "isHidden",
    "isLocked",
    "isEraser",
    "isPixelFill",
    "isLinkTarget",
    "textSnapToGrid",
  ]) {
    if (element[field] !== undefined && typeof element[field] !== "boolean") {
      throw new Error(`${label}.${field} is invalid.`);
    }
  }
  if (
    element.crop !== undefined &&
    (!isRecord(element.crop) ||
      ["left", "top", "right", "bottom"].some(
        (key) => element.crop[key] !== undefined && !Number.isFinite(element.crop[key]),
      ))
  ) {
    throw new Error(`${label}.crop is invalid.`);
  }
  if (element.sheetCell !== undefined) {
    assertSettingsRecord(element.sheetCell, `${label}.sheetCell`);
    assertOptionalSettingTypes(
      element.sheetCell,
      [
        ["sheetId", "string", 200],
        ["rowId", "string", 200],
        ["columnId", "string", 200],
        ["address", "string", 100],
        ["valueType", "string", 20],
        ["error", "string", 100],
      ],
      `${label}.sheetCell`,
    );
    assertSettingEnum(
      element.sheetCell,
      "valueType",
      SECTION_SHEET_CELL_VALUE_TYPES,
      `${label}.sheetCell`,
    );
    if (
      element.sheetCell.computedValue !== undefined &&
      !(
        (typeof element.sheetCell.computedValue === "number" &&
          Number.isFinite(element.sheetCell.computedValue)) ||
        (typeof element.sheetCell.computedValue === "string" &&
          element.sheetCell.computedValue.length <= 1_000_000)
      )
    ) {
      throw new Error(`${label}.sheetCell.computedValue is invalid.`);
    }
  }
  assertSettingEnum(element, "mediaKind", MEDIA_KINDS, label);
  assertSettingEnum(element, "webDeviceMode", WEB_DEVICE_MODES, label);
  assertSettingEnum(element, "webCookieBlocker", WEB_COOKIE_BLOCKERS, label);
  assertSettingEnum(element, "previewMode", new Set(["box", "realistic"]), label);
  assertSettingEnum(element, "strokeLinejoin", new Set(["miter", "round"]), label);
  assertSettingEnum(element, "sectionCollision", new Set(["none", "block", "clip"]), label);
  assertSettingEnum(element, "eraserShape", new Set(["round", "square"]), label);
  assertSettingEnum(element, "textLinesMode", new Set(["everywhere", "text-only"]), label);
};

const assertEditorSettings = (settings) => {
  const label = "Board editor settings";
  assertSettingsRecord(settings, label);
  assertOptionalSettingTypes(
    settings,
    [
      ["activeTool", "string", 100],
      ["selectMode", "string", 100],
      ["keepToolActiveFallback", "string", 20],
      ["toolModeShortcut", "string", 100],
      ["previewShortcut", "string", 100],
      ["activeToolRatioShortcut", "string", 100],
      ["globalRatioShortcut", "string", 100],
      ["gridToggleShortcut", "string", 100],
      ["overlapShortcut", "string", 100],
      ["cropShortcut", "string", 100],
      ["scrollZoomShortcut", "string", 100],
      ["cutShortcut", "string", 100],
      ["fillToolColor", "string", 200],
      ["fillMode", "string", 20],
      ["smartGuideDensity", "string", 20],
      ["smartGuideAlignmentColor", "string", 200],
      ["smartGuideDistanceColor", "string", 200],
      ["smartGuideRatioColor", "string", 200],
      ["smartGuideAngleColor", "string", 200],
      ["eraserMode", "string", 20],
      ["eraserShape", "string", 20],
      ["spreadsheetMode", "string", 20],
      ["previewMode", "string", 20],
      ["overlapMode", "string", 20],
      ["spreadsheetCellWidth", "number"],
      ["spreadsheetCellHeight", "number"],
      ["selectionLockTime", "number"],
      ["spinSnapDegrees", "number"],
      ["eraserSize", "number"],
      ["scrollZoomSensitivity", "number"],
      ["clickZoomSensitivity", "number"],
    ],
    label,
  );
  for (const field of [
    "alwaysOnTop",
    "keepToolActive",
    "mediaPlaybackDisabled",
    "objectPresetsPanelAlwaysOnTop",
    "selectMinimumCell",
    "zoomToCursor",
    "keepBoardContentPosition",
    "proportionalScale",
    "altResizeCrops",
    "isSelectionLockEnabled",
    "enableObjectSnapping",
    "smartGuidesEnabled",
    "smartGuideAlignment",
    "smartGuideDistances",
    "smartGuideRatios",
    "smartGuideAngles",
    "autoSelectOnPlace",
    "switchToolAfterPlacing",
    "autoToolOnSelect",
    "spinSnapEnabled",
    "allowEditing",
    "allowMovingElementsInPan",
  ]) {
    if (settings[field] !== undefined && typeof settings[field] !== "boolean") {
      throw new Error(`${label}.${field} is invalid.`);
    }
  }
  assertSettingEnum(settings, "spreadsheetMode", new Set(["advanced", "simple"]), label);
  assertSettingEnum(settings, "keepToolActiveFallback", new Set(["select", "pan"]), label);
  assertSettingEnum(settings, "previewMode", new Set(["box", "realistic"]), label);
  assertSettingEnum(settings, "eraserMode", new Set(["element", "partial"]), label);
  assertSettingEnum(settings, "eraserShape", new Set(["round", "square"]), label);
  assertSettingEnum(settings, "overlapMode", new Set(["none", "partial", "full"]), label);
  assertSettingEnum(settings, "fillMode", new Set(["area", "object"]), label);
  assertSettingEnum(settings, "smartGuideDensity", new Set(["low", "mid", "high"]), label);

  if (settings.customSettingShortcuts !== undefined) {
    if (!Array.isArray(settings.customSettingShortcuts) || settings.customSettingShortcuts.length > 500) {
      throw new Error(`${label}.customSettingShortcuts is invalid.`);
    }
    settings.customSettingShortcuts.forEach((binding, index) => {
      const bindingLabel = `${label}.customSettingShortcuts[${index}]`;
      assertSettingsRecord(binding, bindingLabel);
      for (const [field, maximum] of [["id", 100], ["label", 200], ["category", 100], ["target", 300], ["shortcut", 100]]) {
        if (typeof binding[field] !== "string" || binding[field].length > maximum) {
          throw new Error(`${bindingLabel}.${field} is invalid.`);
        }
      }
    });
  }

  if (settings.toolbarLayout !== undefined) {
    const layout = settings.toolbarLayout;
    assertSettingsRecord(layout, `${label}.toolbarLayout`);
    for (const field of ["order", "more"]) {
      if (layout[field] === undefined) continue;
      if (
        !Array.isArray(layout[field]) ||
        layout[field].length > 500 ||
        layout[field].some((id) => typeof id !== "string" || id.length > 100)
      ) {
        throw new Error(`${label}.toolbarLayout.${field} is invalid.`);
      }
    }
    if (
      layout.general !== undefined &&
      (!Array.isArray(layout.general) ||
        layout.general.length > 500 ||
        layout.general.some((id) => typeof id !== "string" || id.length > 100))
    ) {
      throw new Error(`${label}.toolbarLayout.general is invalid.`);
    }
    if (layout.slots !== undefined) {
      assertSettingsRecord(layout.slots, `${label}.toolbarLayout.slots`);
      if (
        Object.entries(layout.slots).some(
          ([id, slot]) => id.length > 100 || !Number.isFinite(slot),
        )
      ) {
        throw new Error(`${label}.toolbarLayout.slots contains an invalid slot.`);
      }
    }
  }

  if (settings.customColors !== undefined) {
    assertSettingsRecord(settings.customColors, `${label}.customColors`);
    const entries = Object.entries(settings.customColors);
    if (
      entries.length > 100 ||
      entries.some(
        ([key, colors]) =>
          key.length > 100 ||
          !Array.isArray(colors) ||
          colors.length > 100 ||
          colors.some((color) => typeof color !== "string" || color.length > 200),
      )
    ) {
      throw new Error(`${label}.customColors is invalid.`);
    }
  }

  if (settings.pendingProps !== undefined) {
    assertSettingsElementShape(settings.pendingProps, `${label}.pendingProps`, true);
  }

  if (settings.toolMenuSettingsOverrides !== undefined) {
    const overrides = settings.toolMenuSettingsOverrides;
    assertSettingsRecord(overrides, `${label}.toolMenuSettingsOverrides`);
    for (const [toolId, override] of Object.entries(overrides)) {
      if (!toolId || toolId.length > 100) {
        throw new Error(`${label}.toolMenuSettingsOverrides has an invalid tool id.`);
      }
      assertSettingsRecord(override, `${label}.toolMenuSettingsOverrides.${toolId}`);
      for (const field of [
        "alwaysOnTop",
        "keepToolActive",
        "ratio",
        "allowEditing",
        "allowMoving",
        "pageInteractionWithSelect",
        "pageInteractionWithHand",
      ]) {
        if (override[field] !== undefined && typeof override[field] !== "boolean") {
          throw new Error(`${label}.toolMenuSettingsOverrides.${toolId}.${field} is invalid.`);
        }
      }
      assertSettingEnum(
        override,
        "previewMode",
        new Set(["box", "realistic"]),
        `${label}.toolMenuSettingsOverrides.${toolId}`,
      );
    }
  }

  if (settings.objectPresets !== undefined) {
    if (!Array.isArray(settings.objectPresets) || settings.objectPresets.length > 10_000) {
      throw new Error(`${label}.objectPresets is invalid.`);
    }
    for (const [index, preset] of settings.objectPresets.entries()) {
      const presetLabel = `${label}.objectPresets[${index}]`;
      assertSettingsRecord(preset, presetLabel);
      if (
        typeof preset.id !== "string" ||
        !preset.id ||
        preset.id.length > 200 ||
        typeof preset.name !== "string" ||
        preset.name.length > 500
      ) {
        throw new Error(`${presetLabel} identity is invalid.`);
      }
      if (preset.shortcut !== undefined && (typeof preset.shortcut !== "string" || preset.shortcut.length > 100)) {
        throw new Error(`${presetLabel}.shortcut is invalid.`);
      }
      if (preset.element !== undefined) {
        assertSettingsElementShape(preset.element, `${presetLabel}.element`);
      }
      if (preset.elements !== undefined) {
        if (!Array.isArray(preset.elements) || preset.elements.length > MAX_BOARD_ELEMENTS) {
          throw new Error(`${presetLabel}.elements is invalid.`);
        }
        preset.elements.forEach((element, elementIndex) =>
          assertSettingsElementShape(element, `${presetLabel}.elements[${elementIndex}]`),
        );
      }
    }
  }

  if (settings.objectDefaults !== undefined) {
    assertSettingsRecord(settings.objectDefaults, `${label}.objectDefaults`);
    for (const [type, defaults] of Object.entries(settings.objectDefaults)) {
      if (!type || type.length > 50) throw new Error(`${label}.objectDefaults has an invalid element type.`);
      assertSettingsElementShape(defaults, `${label}.objectDefaults.${type}`, true);
    }
  }
};

export function assertValidBoard(page) {
  if (!page || typeof page !== "object" || Array.isArray(page)) {
    throw new Error("Board must be an object.");
  }
  const normalizedId = normalizeBoardId(page.id);
  if (normalizedId !== page.id || String(page.id).length > 200) {
    throw new Error("Board id is invalid.");
  }
  if (typeof page.title !== "string" || page.title.length > 500) {
    throw new Error("Board title is invalid.");
  }
  if (!Array.isArray(page.elements)) throw new Error("Board elements are invalid.");
  if (page.updatedAt !== undefined && (!Number.isSafeInteger(page.updatedAt) || page.updatedAt < 0))
    throw new Error("Board revision is invalid.");
  if (page.editorSettings !== undefined) assertEditorSettings(page.editorSettings);
  if (page.recoveryOrigin !== undefined) {
    if (!page.recoveryOrigin || typeof page.recoveryOrigin !== "object" ||
        Array.isArray(page.recoveryOrigin)) {
      throw new Error("Board recovery origin is invalid.");
    }
    try { normalizeBoardId(page.recoveryOrigin.boardId); }
    catch { throw new Error("Board recovery origin id is invalid."); }
    if (!/^[a-f0-9]{64}$/.test(page.recoveryOrigin.snapshotHash ?? "")) {
      throw new Error("Board recovery origin hash is invalid.");
    }
  }
  if (page.version !== undefined) {
    if (!Number.isInteger(page.version) || page.version < 1) {
      throw new Error("Board version is invalid.");
    }
    if (page.version > CURRENT_BOARD_VERSION) {
      throw new Error(
        `Board version ${page.version} is newer than this version of Noteboard.`,
      );
    }
  }
  if (page.elements.length > MAX_BOARD_ELEMENTS) {
    throw new Error(`Board exceeds the ${MAX_BOARD_ELEMENTS} element limit.`);
  }

  for (const key of ["width", "height", "workspaceWidth", "workspaceHeight"]) {
    const value = page[key];
    if (value === undefined) continue;
    if (!Number.isFinite(value) || value <= 0 || value > MAX_BOARD_DIMENSION) {
      throw new Error(`Board ${key} is invalid.`);
    }
  }

  const elementIds = new Set();
  const elementsById = new Map();
  for (const element of page.elements) {
    if (!element || typeof element !== "object" || Array.isArray(element)) {
      throw new Error("Board element is invalid.");
    }
    if (
      typeof element.id !== "string" ||
      !SAFE_ID_PATTERN.test(element.id) ||
      element.id.length > 200
    ) {
      throw new Error("Board element id is invalid.");
    }
    if (elementIds.has(element.id)) {
      throw new Error("Board element ids must be unique.");
    }
    elementIds.add(element.id);
    elementsById.set(element.id, element);
    if (typeof element.type !== "string" || element.type.length > 50) {
      throw new Error("Board element type is invalid.");
    }
    if (
      !element.position ||
      !Number.isFinite(element.position.x) ||
      !Number.isFinite(element.position.y) ||
      Math.abs(element.position.x) > MAX_BOARD_DIMENSION ||
      Math.abs(element.position.y) > MAX_BOARD_DIMENSION
    ) {
      throw new Error("Board element position is invalid.");
    }
    if (
      element.size &&
      (!Number.isFinite(element.size.width) ||
        !Number.isFinite(element.size.height) ||
        element.size.width <= 0 ||
        element.size.height <= 0 ||
        element.size.width > MAX_BOARD_DIMENSION ||
        element.size.height > MAX_BOARD_DIMENSION)
    ) {
      throw new Error("Board element size is invalid.");
    }
    if (element.content !== undefined && typeof element.content !== "string") {
      throw new Error("Board element content is invalid.");
    }
    if(element.groupOriginalParentId!==undefined&&!isSafeId(element.groupOriginalParentId))throw new Error('Original group parent is invalid.');
    if(element.type==='group'&&!element.size)throw new Error('Merged group size is invalid.');
    if (element.textScale !== undefined && (!Number.isFinite(element.textScale) || element.textScale <= 0 || element.textScale > MAX_BOARD_DIMENSION)) {
      throw new Error('Board text scale is invalid.');
    }
    if (
      (element.textLineColor !== undefined &&
        (typeof element.textLineColor !== "string" || element.textLineColor.length > 200)) ||
      (element.textLineThickness !== undefined &&
        (!Number.isFinite(element.textLineThickness) ||
          element.textLineThickness < 0.25 || element.textLineThickness > 100)) ||
      (element.textLineSpacing !== undefined &&
        (!Number.isFinite(element.textLineSpacing) ||
          element.textLineSpacing < 1 || element.textLineSpacing > MAX_BOARD_DIMENSION))
    ) {
      throw new Error('Board text line settings are invalid.');
    }
    if (element.textScaling !== undefined && typeof element.textScaling !== 'boolean') {
      throw new Error('Board text scaling setting is invalid.');
    }
    if (
      element.previewMode !== undefined &&
      element.previewMode !== "box" &&
      element.previewMode !== "realistic"
    ) {
      throw new Error("Board element preview mode is invalid.");
    }
    if (
      (element.mediaMime !== undefined &&
        (typeof element.mediaMime !== "string" || element.mediaMime.length > 200)) ||
      (element.mediaKind !== undefined && !MEDIA_KINDS.has(element.mediaKind)) ||
      (element.webSessionId !== undefined &&
        (typeof element.webSessionId !== "string" || element.webSessionId.length > 200)) ||
      (element.webDeviceMode !== undefined &&
        !WEB_DEVICE_MODES.has(element.webDeviceMode)) ||
      (element.webCookieBlocker !== undefined &&
        !WEB_COOKIE_BLOCKERS.has(element.webCookieBlocker))
    ) {
      throw new Error("Board media or web element settings are invalid.");
    }
    for (const booleanField of [
      "keepRatio",
      "mediaControlsHidden",
      "mediaDisabled",
      "mediaLoop",
      "webRememberSession",
      "webAdBlock",
      "webPopupBlocker",
    ]) {
      if (
        element[booleanField] !== undefined &&
        typeof element[booleanField] !== "boolean"
      ) {
        throw new Error("Board media or web element settings are invalid.");
      }
    }
    if (
      (element.mediaPlaybackRate !== undefined &&
        (!Number.isFinite(element.mediaPlaybackRate) ||
          element.mediaPlaybackRate < 0.1 ||
          element.mediaPlaybackRate > 16)) ||
      (element.mediaVolume !== undefined &&
        (!Number.isFinite(element.mediaVolume) ||
          element.mediaVolume < 0 ||
          element.mediaVolume > 1))
    ) {
      throw new Error("Board media playback settings are invalid.");
    }
    if (element.zIndex !== undefined && !Number.isFinite(element.zIndex)) {
      throw new Error("Board element z-index is invalid.");
    }
    if (element.points !== undefined) {
      if (!Array.isArray(element.points) || element.points.length > 1_000_000) {
        throw new Error("Board drawing points are invalid.");
      }
      for (const point of element.points) {
        if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
          throw new Error("Board drawing point is invalid.");
        }
      }
    }
  }

  for (const element of page.elements) {
    if (element.parentId !== undefined) {
      if (!isSafeId(element.parentId) || !elementsById.has(element.parentId)) {
        throw new Error("Board element parent relationship is missing or invalid.");
      }
      if (element.parentId === element.id) {
        throw new Error("Board element hierarchy contains a cycle.");
      }
    }
    if (element.linkToId !== undefined) {
      if (typeof element.linkToId !== "string" || element.linkToId.length > 2_048) {
        throw new Error("Board element link relationship is invalid.");
      }
      const isWebLink = isSafeBoardWebLink(element.linkToId);
      if (!isWebLink && !elementsById.has(element.linkToId)) {
        throw new Error("Board element link relationship target is missing.");
      }
    }
  }

  const hierarchyState = new Map();
  for (const element of page.elements) {
    if (hierarchyState.get(element.id) === 2) continue;
    const chain = [];
    let current = element;
    while (current) {
      const state = hierarchyState.get(current.id);
      if (state === 1) {
        throw new Error("Board element hierarchy contains a cycle.");
      }
      if (state === 2) break;
      hierarchyState.set(current.id, 1);
      chain.push(current.id);
      current = current.parentId ? elementsById.get(current.parentId) : undefined;
    }
    chain.forEach((id) => hierarchyState.set(id, 2));
  }

  if (page.sectionSheets !== undefined) {
    if (
      !Array.isArray(page.sectionSheets) ||
      page.sectionSheets.length > MAX_SECTION_SHEETS
    ) {
      throw new Error("Board spreadsheets are invalid.");
    }
    const sheetIds = new Set();
    const spreadsheetCellIds = new Set();
    for (const sheet of page.sectionSheets) {
      if (
        !sheet ||
        sheet.version !== 1 ||
        !isSafeId(sheet.id) ||
        sheetIds.has(sheet.id) ||
        !Array.isArray(sheet.rowOrder) ||
        !Array.isArray(sheet.columnOrder) ||
        !Array.isArray(sheet.cellIds) ||
        sheet.cellIds.length !== sheet.rowOrder.length ||
        sheet.rowOrder.length < 1 ||
        sheet.columnOrder.length < 1 ||
        sheet.rowOrder.length > 1_000 ||
        sheet.columnOrder.length > 1_000 ||
        !sheet.rows ||
        typeof sheet.rows !== "object" ||
        Array.isArray(sheet.rows) ||
        !sheet.columns ||
        typeof sheet.columns !== "object" ||
        Array.isArray(sheet.columns)
      ) {
        throw new Error("Board spreadsheet is invalid.");
      }
      if (
        new Set(sheet.rowOrder).size !== sheet.rowOrder.length ||
        new Set(sheet.columnOrder).size !== sheet.columnOrder.length
      ) {
        throw new Error("Board spreadsheet row and column ids must be unique.");
      }
      for (const rowId of sheet.rowOrder) {
        const row = sheet.rows[rowId];
        if (
          !isSafeId(rowId) ||
          !row ||
          row.id !== rowId ||
          !Number.isFinite(row.height) ||
          row.height <= 0 ||
          row.height > MAX_BOARD_DIMENSION
        ) {
          throw new Error("Board spreadsheet row is invalid.");
        }
      }
      for (const columnId of sheet.columnOrder) {
        const column = sheet.columns[columnId];
        if (
          !isSafeId(columnId) ||
          !column ||
          column.id !== columnId ||
          !Number.isFinite(column.width) ||
          column.width <= 0 ||
          column.width > MAX_BOARD_DIMENSION
        ) {
          throw new Error("Board spreadsheet column is invalid.");
        }
      }
      if (sheet.shortcuts !== undefined) {
        if (!sheet.shortcuts || typeof sheet.shortcuts !== "object" || Array.isArray(sheet.shortcuts)) {
          throw new Error("Board spreadsheet shortcuts are invalid.");
        }
        for (const [command, shortcut] of Object.entries(sheet.shortcuts)) {
          if (
            !SECTION_SHEET_SHORTCUT_KEYS.has(command) ||
            typeof shortcut !== "string" ||
            shortcut.length > 100
          ) {
            throw new Error("Board spreadsheet shortcut is invalid.");
          }
        }
      }
      if (sheet.automations !== undefined) {
        if (!Array.isArray(sheet.automations) || sheet.automations.length > 1_000) {
          throw new Error("Board spreadsheet automations are invalid.");
        }
        for (const automation of sheet.automations) {
          if (
            !automation ||
            !isSafeId(automation.id) ||
            typeof automation.name !== "string" ||
            automation.name.length > 200 ||
            typeof automation.enabled !== "boolean" ||
            !SECTION_SHEET_TRIGGERS.has(automation.trigger) ||
            !SECTION_SHEET_ACTIONS.has(automation.action) ||
            (automation.shortcut !== undefined &&
              (typeof automation.shortcut !== "string" || automation.shortcut.length > 100))
          ) {
            throw new Error("Board spreadsheet automation is invalid.");
          }
        }
      }
      sheetIds.add(sheet.id);
      for (let rowIndex = 0; rowIndex < sheet.cellIds.length; rowIndex += 1) {
        const row = sheet.cellIds[rowIndex];
        if (!Array.isArray(row) || row.length !== sheet.columnOrder.length) {
          throw new Error("Board spreadsheet dimensions are invalid.");
        }
        for (let columnIndex = 0; columnIndex < row.length; columnIndex += 1) {
          const cellId = row[columnIndex];
          const cell = elementsById.get(cellId);
          if (
            typeof cellId !== "string" ||
            !cell ||
            cell.type !== "section" ||
            spreadsheetCellIds.has(cellId) ||
            !cell.sheetCell ||
            typeof cell.sheetCell !== "object" ||
            Array.isArray(cell.sheetCell) ||
            cell.sheetCell.sheetId !== sheet.id ||
            cell.sheetCell.rowId !== sheet.rowOrder[rowIndex] ||
            cell.sheetCell.columnId !== sheet.columnOrder[columnIndex] ||
            cell.sheetCell.address !== sheetAddress(rowIndex, columnIndex)
          ) {
            throw new Error("Board spreadsheet cell is invalid.");
          }
          if (
            (cell.sheetCell.valueType !== undefined &&
              !SECTION_SHEET_CELL_VALUE_TYPES.has(cell.sheetCell.valueType)) ||
            (cell.sheetCell.computedValue !== undefined &&
              !(
                (typeof cell.sheetCell.computedValue === "number" &&
                  Number.isFinite(cell.sheetCell.computedValue)) ||
                (typeof cell.sheetCell.computedValue === "string" &&
                  cell.sheetCell.computedValue.length <= 1_000_000)
              )) ||
            (cell.sheetCell.error !== undefined &&
              (typeof cell.sheetCell.error !== "string" ||
                cell.sheetCell.error.length > 100))
          ) {
            throw new Error("Board spreadsheet cell metadata is invalid.");
          }
          spreadsheetCellIds.add(cellId);
        }
      }
    }
    for (const element of page.elements) {
      if (element.sheetCell && !spreadsheetCellIds.has(element.id)) {
        throw new Error("Board spreadsheet cell metadata is orphaned.");
      }
    }
  } else if (page.elements.some((element) => element.sheetCell)) {
    throw new Error("Board spreadsheet cell metadata is orphaned.");
  }

  return page;
}
