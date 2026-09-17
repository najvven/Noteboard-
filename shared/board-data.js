export const MAX_BOARD_ELEMENTS = 100_000;
export const MAX_BOARD_DIMENSION = 1_000_000;
export const CURRENT_BOARD_VERSION = 3;
export const MAX_SECTION_SHEETS = 10_000;
export const MAX_BOARD_FILE_BYTES = 128 * 1024 * 1024;
export const MAX_ARCHIVE_UNCOMPRESSED_BYTES = 128 * 1024 * 1024;
export const MAX_BOARD_JSON_BYTES = 8 * 1024 * 1024;
export const MAX_ARCHIVE_ASSET_BYTES = 32 * 1024 * 1024;
// Media is embedded as base64 in board JSON. Keep one file comfortably below
// the 128 MB board-read boundary after the roughly 4/3 encoding expansion.
export const MAX_MEDIA_FILE_BYTES = 64 * 1024 * 1024;

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
  const id = String(value ?? "").replace(/[^a-zA-Z0-9_-]/g, "");
  if (!id) throw new Error("Board id is missing or invalid.");
  return id;
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
    if (element.textScale !== undefined && (!Number.isFinite(element.textScale) || element.textScale <= 0 || element.textScale > MAX_BOARD_DIMENSION)) {
      throw new Error('Board text scale is invalid.');
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
