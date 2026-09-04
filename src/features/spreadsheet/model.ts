import type { BoardElement } from "../../types";
import {
  createDefaultSectionSheetAutomations,
  DEFAULT_SECTION_SHEET_SHORTCUTS,
  type SectionSheet,
  type SectionSheetAutomationId,
  type SectionSheetCellMeta,
} from "./types";

const MIN_CELL_WIDTH = 72;
const MIN_CELL_HEIGHT = 36;
const DEFAULT_CELL_WIDTH = 120;
const DEFAULT_CELL_HEIGHT = 48;
const MAX_FORMULA_LENGTH = 10_000;
const MAX_FORMULA_TOKENS = 2_000;
const MAX_FORMULA_RANGE_CELLS = 10_000;
const MAX_FORMULA_OPERATIONS = 10_000;
const MAX_FORMULA_DEPENDENCY_DEPTH = 256;
const MAX_SHEET_EVALUATION_OPERATIONS = 250_000;

export interface SectionSheetOperationBudget {
  remaining: number;
}

type OperationBudget = SectionSheetOperationBudget;

export const createSectionSheetOperationBudget = (
  limit = MAX_SHEET_EVALUATION_OPERATIONS,
): SectionSheetOperationBudget => ({
  remaining: Math.max(0, Math.floor(limit)),
});

const reserveOperations = (
  count: number,
  ...budgets: OperationBudget[]
) => {
  if (
    !Number.isSafeInteger(count) ||
    count < 0 ||
    budgets.some((budget) => budget.remaining < count)
  ) {
    return false;
  }
  budgets.forEach((budget) => {
    budget.remaining -= count;
  });
  return true;
};

export interface SheetBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface CreateSectionSheetOptions {
  sectionIds: readonly string[];
  layout: "rows" | "columns" | "grid";
  rows?: number;
  columns?: number;
  bounds?: SheetBounds;
  parentId?: string;
  name?: string;
  createId?: () => string;
  now?: () => number;
}

export interface SectionSheetResult {
  elements: BoardElement[];
  sheet: SectionSheet;
  createdCellIds: string[];
  warnings: string[];
}

export interface SectionSheetEvaluation {
  values: Record<string, string | number>;
  errors: Record<string, string>;
}

const defaultCreateId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const createUniqueId = (
  prefix: string,
  createId: () => string,
  used: Set<string>,
) => {
  const seed = `${prefix}-${createId()}`;
  let candidate = seed;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${seed}-${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
};

const clampDimension = (value: number | undefined, fallback: number) =>
  Math.max(1, Math.min(1000, Math.round(value ?? fallback)));

const columnIndexToLabel = (index: number) => {
  let value = index + 1;
  let label = "";
  while (value > 0) {
    const remainder = (value - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    value = Math.floor((value - 1) / 26);
  }
  return label;
};

const columnLabelToIndex = (label: string) => {
  let result = 0;
  for (const character of label.toUpperCase()) {
    result = result * 26 + character.charCodeAt(0) - 64;
    if (!Number.isSafeInteger(result)) return undefined;
  }
  return result - 1;
};

export const getSectionSheetAddress = (row: number, column: number) =>
  `${columnIndexToLabel(column)}${row + 1}`;

const parseAddress = (address: string) => {
  const match = /^([A-Z]+)(\d+)$/i.exec(address.trim());
  if (!match) return undefined;
  const column = columnLabelToIndex(match[1]);
  const rowNumber = Number(match[2]);
  if (
    column === undefined ||
    !Number.isSafeInteger(column) ||
    column < 0 ||
    !Number.isSafeInteger(rowNumber) ||
    rowNumber < 1
  ) {
    return undefined;
  }
  return {
    column,
    row: rowNumber - 1,
  };
};

const getDimensions = (count: number, options: CreateSectionSheetOptions) => {
  if (options.rows || options.columns) {
    const rows = clampDimension(options.rows, 1);
    const columns = clampDimension(
      options.columns,
      Math.max(1, Math.ceil(count / rows)),
    );
    return {
      rows: Math.max(rows, Math.ceil(Math.max(1, count) / columns)),
      columns,
    };
  }
  if (options.layout === "rows") return { rows: 1, columns: Math.max(1, count) };
  if (options.layout === "columns") return { rows: Math.max(1, count), columns: 1 };
  const columns = Math.max(1, Math.ceil(Math.sqrt(Math.max(1, count))));
  return { rows: Math.ceil(Math.max(1, count) / columns), columns };
};

const getSourceBounds = (
  sections: readonly BoardElement[],
  dimensions: { rows: number; columns: number },
  explicit?: SheetBounds,
): SheetBounds => {
  if (explicit) {
    return {
      x: explicit.x,
      y: explicit.y,
      width: Math.max(MIN_CELL_WIDTH * dimensions.columns, explicit.width),
      height: Math.max(MIN_CELL_HEIGHT * dimensions.rows, explicit.height),
    };
  }
  if (sections.length === 0) {
    return {
      x: 0,
      y: 0,
      width: DEFAULT_CELL_WIDTH * dimensions.columns,
      height: DEFAULT_CELL_HEIGHT * dimensions.rows,
    };
  }

  const minX = Math.min(...sections.map((section) => section.position.x));
  const minY = Math.min(...sections.map((section) => section.position.y));
  if (sections.length === 1) {
    return {
      x: minX,
      y: minY,
      width: Math.max(
        MIN_CELL_WIDTH,
        sections[0].size?.width ?? DEFAULT_CELL_WIDTH,
      ) * dimensions.columns,
      height: Math.max(
        MIN_CELL_HEIGHT,
        sections[0].size?.height ?? DEFAULT_CELL_HEIGHT,
      ) * dimensions.rows,
    };
  }
  const maxX = Math.max(
    ...sections.map(
      (section) => section.position.x + (section.size?.width ?? DEFAULT_CELL_WIDTH),
    ),
  );
  const maxY = Math.max(
    ...sections.map(
      (section) => section.position.y + (section.size?.height ?? DEFAULT_CELL_HEIGHT),
    ),
  );
  return {
    x: minX,
    y: minY,
    width: Math.max(MIN_CELL_WIDTH * dimensions.columns, maxX - minX),
    height: Math.max(MIN_CELL_HEIGHT * dimensions.rows, maxY - minY),
  };
};

const stripCellIdentity = (template: BoardElement | undefined) => {
  if (!template) {
    return {
      type: "section" as const,
      content: "",
      color: "#ffffff",
      borderColor: "#cbd5e1",
      borderWidth: 1,
      textColor: "#0f172a",
      zIndex: 1,
    };
  }
  const {
    id: _id,
    position: _position,
    size: _size,
    content: _content,
    zIndex: _zIndex,
    parentId: _parentId,
    linkToId: _linkToId,
    isLinkTarget: _isLinkTarget,
    linkTargetName: _linkTargetName,
    name: _name,
    sheetCell: _sheetCell,
    ...visual
  } = template;
  return { ...visual, type: "section" as const, content: "", zIndex: 1 };
};

const createCellMeta = (
  sheetId: string,
  rowId: string,
  columnId: string,
  row: number,
  column: number,
): SectionSheetCellMeta => ({
  sheetId,
  rowId,
  columnId,
  address: getSectionSheetAddress(row, column),
  valueType: "auto",
});

export const createSectionSheetFromSections = (
  elements: readonly BoardElement[],
  options: CreateSectionSheetOptions,
): SectionSheetResult => {
  const createId = options.createId ?? defaultCreateId;
  const now = options.now ?? Date.now;
  const uniqueIds = [...new Set(options.sectionIds)];
  if (uniqueIds.length !== options.sectionIds.length) {
    throw new Error("A Section can only appear once in a spreadsheet.");
  }
  const byId = new Map(elements.map((element) => [element.id, element]));
  const sourceSections = uniqueIds.map((id) => {
    const element = byId.get(id);
    if (!element || element.type !== "section") {
      throw new Error(`Spreadsheet cell ${id} must reference a Section.`);
    }
    if (element.isLocked) throw new Error(`Section ${id} is locked.`);
    if (element.sheetCell) throw new Error(`Section ${id} already belongs to a sheet.`);
    return element;
  });
  const sortedSections = [...sourceSections].sort(
    (left, right) =>
      left.position.y - right.position.y || left.position.x - right.position.x,
  );
  const sourceParents = new Set(
    sortedSections.map((section) => section.parentId ?? ""),
  );
  if (sourceParents.size > 1) {
    throw new Error(
      "Sections in one spreadsheet must share the same layer or board.",
    );
  }
  const commonParentId = sortedSections[0]?.parentId ?? options.parentId;
  const dimensions = getDimensions(sortedSections.length, options);
  const bounds = getSourceBounds(sortedSections, dimensions, options.bounds);
  const cellWidth = Math.max(MIN_CELL_WIDTH, bounds.width / dimensions.columns);
  const cellHeight = Math.max(MIN_CELL_HEIGHT, bounds.height / dimensions.rows);
  const sheetId = `sheet-${createId()}`;
  const rowOrder = Array.from(
    { length: dimensions.rows },
    () => `row-${createId()}`,
  );
  const columnOrder = Array.from(
    { length: dimensions.columns },
    () => `column-${createId()}`,
  );
  const rows = Object.fromEntries(
    rowOrder.map((id) => [id, { id, height: cellHeight }]),
  );
  const columns = Object.fromEntries(
    columnOrder.map((id) => [id, { id, width: cellWidth }]),
  );
  const template = sortedSections[0];
  const templateVisuals = stripCellIdentity(template);
  const maxZIndex = Math.max(0, ...elements.map((element) => element.zIndex ?? 0));
  const updates = new Map<string, BoardElement>();
  const additions: BoardElement[] = [];
  const createdCellIds: string[] = [];
  const cellIds: string[][] = [];
  const capacity = dimensions.rows * dimensions.columns;

  for (let index = 0; index < capacity; index += 1) {
    const row = Math.floor(index / dimensions.columns);
    const column = index % dimensions.columns;
    const existing = sortedSections[index];
    const id = existing?.id ?? `section-${createId()}`;
    const cell: BoardElement = {
      ...(existing ?? templateVisuals),
      id,
      type: "section",
      content: existing?.content ?? "",
      position: {
        x: bounds.x + column * cellWidth,
        y: bounds.y + row * cellHeight,
      },
      size: { width: cellWidth, height: cellHeight },
      zIndex: existing?.zIndex ?? maxZIndex + index + 1,
      parentId: existing?.parentId ?? commonParentId,
      sheetCell: createCellMeta(
        sheetId,
        rowOrder[row],
        columnOrder[column],
        row,
        column,
      ),
    };
    if (existing) updates.set(id, cell);
    else {
      additions.push(cell);
      createdCellIds.push(id);
    }
    if (!cellIds[row]) cellIds[row] = [];
    cellIds[row][column] = id;
  }

  const timestamp = now();
  const sheet: SectionSheet = {
    id: sheetId,
    version: 1,
    name: options.name?.trim() || "Section Spreadsheet",
    rowOrder,
    columnOrder,
    rows,
    columns,
    cellIds,
    headerRows: 1,
    headerColumns: 0,
    showHeaders: true,
    shortcuts: { ...DEFAULT_SECTION_SHEET_SHORTCUTS },
    automations: createDefaultSectionSheetAutomations(
      () => `automation-${createId()}`,
    ),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  const nextElements = [
    ...elements.map((element) => updates.get(element.id) ?? element),
    ...additions,
  ];

  return {
    elements: recalculateSectionSheetElements(nextElements, sheet),
    sheet,
    createdCellIds,
    warnings: [],
  };
};

const getSheetCells = (elements: readonly BoardElement[], sheet: SectionSheet) => {
  const byId = new Map(elements.map((element) => [element.id, element]));
  return sheet.cellIds.map((row) => row.map((id) => byId.get(id)));
};

const getSheetOrigin = (elements: readonly BoardElement[], sheet: SectionSheet) => {
  const cells = getSheetCells(elements, sheet).flat().filter(Boolean) as BoardElement[];
  return {
    x: cells.length ? Math.min(...cells.map((cell) => cell.position.x)) : 0,
    y: cells.length ? Math.min(...cells.map((cell) => cell.position.y)) : 0,
  };
};

export const layoutSectionSheet = (
  elements: readonly BoardElement[],
  sheet: SectionSheet,
) => {
  const origin = getSheetOrigin(elements, sheet);
  const locations = new Map<
    string,
    { row: number; column: number; x: number; y: number; width: number; height: number }
  >();
  let y = origin.y;
  sheet.rowOrder.forEach((rowId, row) => {
    let x = origin.x;
    const height = sheet.rows[rowId]?.height ?? DEFAULT_CELL_HEIGHT;
    sheet.columnOrder.forEach((columnId, column) => {
      const width = sheet.columns[columnId]?.width ?? DEFAULT_CELL_WIDTH;
      const id = sheet.cellIds[row]?.[column];
      if (id) locations.set(id, { row, column, x, y, width, height });
      x += width;
    });
    y += height;
  });

  return elements.map((element) => {
    const location = locations.get(element.id);
    if (!location || !element.sheetCell) return element;
    return {
      ...element,
      position: { x: location.x, y: location.y },
      size: { width: location.width, height: location.height },
      sheetCell: {
        ...element.sheetCell,
        sheetId: sheet.id,
        rowId: sheet.rowOrder[location.row],
        columnId: sheet.columnOrder[location.column],
        address: getSectionSheetAddress(location.row, location.column),
      },
    };
  });
};

export const updateSectionSheetCellGeometry = (
  elements: readonly BoardElement[],
  sheet: SectionSheet,
  cellId: string,
  updates: Partial<BoardElement>,
) => {
  const selectedCell = elements.find((element) => element.id === cellId);
  if (selectedCell?.sheetCell?.sheetId !== sheet.id) {
    throw new Error("Spreadsheet geometry can only be updated from one of its cells.");
  }

  const nextWidth = updates.size?.width;
  const nextHeight = updates.size?.height;
  const columnId = selectedCell.sheetCell.columnId;
  const rowId = selectedCell.sheetCell.rowId;
  const columnIndex = sheet.columnOrder.indexOf(columnId);
  const rowIndex = sheet.rowOrder.indexOf(rowId);
  const desiredPosition = updates.position;
  const deltaX = Number.isFinite(desiredPosition?.x)
    ? Number(desiredPosition?.x) - selectedCell.position.x
    : 0;
  const deltaY = Number.isFinite(desiredPosition?.y)
    ? Number(desiredPosition?.y) - selectedCell.position.y
    : 0;
  const isWidthResize = Number.isFinite(nextWidth) && Number(nextWidth) > 0;
  const isHeightResize = Number.isFinite(nextHeight) && Number(nextHeight) > 0;
  let nextColumns = isWidthResize
    ? {
        ...sheet.columns,
        [columnId]: {
          ...sheet.columns[columnId],
          id: columnId,
          width: Math.max(MIN_CELL_WIDTH, Number(nextWidth)),
        },
      }
    : sheet.columns;
  let nextRows = isHeightResize
    ? {
        ...sheet.rows,
        [rowId]: {
          ...sheet.rows[rowId],
          id: rowId,
          height: Math.max(MIN_CELL_HEIGHT, Number(nextHeight)),
        },
      }
    : sheet.rows;

  // A west/north resize of an interior cell moves a shared boundary. Grow the
  // preceding column/row instead of translating the whole spreadsheet.
  if (isWidthResize && deltaX !== 0 && columnIndex > 0) {
    const previousColumnId = sheet.columnOrder[columnIndex - 1];
    const previousWidth = sheet.columns[previousColumnId].width;
    const selectedWidth = sheet.columns[columnId].width;
    const appliedDeltaX = Math.min(
      selectedWidth - MIN_CELL_WIDTH,
      Math.max(MIN_CELL_WIDTH - previousWidth, deltaX),
    );
    nextColumns = {
      ...nextColumns,
      [previousColumnId]: {
        ...sheet.columns[previousColumnId],
        id: previousColumnId,
        width: previousWidth + appliedDeltaX,
      },
      [columnId]: {
        ...sheet.columns[columnId],
        id: columnId,
        width: selectedWidth - appliedDeltaX,
      },
    };
  }
  if (isHeightResize && deltaY !== 0 && rowIndex > 0) {
    const previousRowId = sheet.rowOrder[rowIndex - 1];
    const previousHeight = sheet.rows[previousRowId].height;
    const selectedHeight = sheet.rows[rowId].height;
    const appliedDeltaY = Math.min(
      selectedHeight - MIN_CELL_HEIGHT,
      Math.max(MIN_CELL_HEIGHT - previousHeight, deltaY),
    );
    nextRows = {
      ...nextRows,
      [previousRowId]: {
        ...sheet.rows[previousRowId],
        id: previousRowId,
        height: previousHeight + appliedDeltaY,
      },
      [rowId]: {
        ...sheet.rows[rowId],
        id: rowId,
        height: selectedHeight - appliedDeltaY,
      },
    };
  }
  const nextSheet: SectionSheet = {
    ...sheet,
    rows: nextRows,
    columns: nextColumns,
    updatedAt: Date.now(),
  };
  const { position: _position, size: _size, ...nonGeometryUpdates } = updates;
  const isWestBoundaryResize =
    isWidthResize &&
    columnIndex === 0 &&
    deltaX !== 0 &&
    (Math.abs(Number(nextWidth) - (sheet.columns[columnId].width - deltaX)) < 1 ||
      (Number(nextWidth) < MIN_CELL_WIDTH && deltaX > 0));
  const isNorthBoundaryResize =
    isHeightResize &&
    rowIndex === 0 &&
    deltaY !== 0 &&
    (Math.abs(Number(nextHeight) - (sheet.rows[rowId].height - deltaY)) < 1 ||
      (Number(nextHeight) < MIN_CELL_HEIGHT && deltaY > 0));
  const translationX = !isWidthResize
    ? deltaX
    : isWestBoundaryResize
      ? sheet.columns[columnId].width - nextColumns[columnId].width
      : columnIndex === 0
        ? deltaX
        : 0;
  const translationY = !isHeightResize
    ? deltaY
    : isNorthBoundaryResize
      ? sheet.rows[rowId].height - nextRows[rowId].height
      : rowIndex === 0
        ? deltaY
        : 0;
  const translated = elements.map((element) => {
    if (element.sheetCell?.sheetId !== sheet.id) {
      return element.id === cellId ? { ...element, ...nonGeometryUpdates } : element;
    }
    return {
      ...element,
      ...(element.id === cellId ? nonGeometryUpdates : {}),
      position: {
        x: element.position.x + translationX,
        y: element.position.y + translationY,
      },
    };
  });

  return {
    elements: recalculateSectionSheetElements(
      layoutSectionSheet(translated, nextSheet),
      nextSheet,
    ),
    sheet: nextSheet,
  };
};

const cloneSheetCell = (
  template: BoardElement | undefined,
  id: string,
  sheetId: string,
  rowId: string,
  columnId: string,
  row: number,
  column: number,
  zIndex: number,
): BoardElement => ({
  ...stripCellIdentity(template),
  id,
  type: "section",
  content: "",
  position: { x: 0, y: 0 },
  size: { width: DEFAULT_CELL_WIDTH, height: DEFAULT_CELL_HEIGHT },
  zIndex,
  parentId: template?.parentId,
  sheetCell: createCellMeta(sheetId, rowId, columnId, row, column),
});

export const appendSectionSheetRow = (
  elements: readonly BoardElement[],
  sheet: SectionSheet,
  createId: () => string = defaultCreateId,
): SectionSheetResult => {
  const usedRowIds = new Set(sheet.rowOrder);
  const usedElementIds = new Set(elements.map((element) => element.id));
  const rowId = createUniqueId("row", createId, usedRowIds);
  const rowIndex = sheet.rowOrder.length;
  const byId = new Map(elements.map((element) => [element.id, element]));
  const template = byId.get(sheet.cellIds[Math.max(0, rowIndex - 1)]?.[0]);
  const maxZIndex = Math.max(0, ...elements.map((element) => element.zIndex ?? 0));
  const newCells = sheet.columnOrder.map((columnId, column) =>
    cloneSheetCell(
      template,
      createUniqueId("section", createId, usedElementIds),
      sheet.id,
      rowId,
      columnId,
      rowIndex,
      column,
      maxZIndex + column + 1,
    ),
  );
  const height = sheet.rows[sheet.rowOrder.at(-1) ?? ""]?.height ?? DEFAULT_CELL_HEIGHT;
  const nextSheet: SectionSheet = {
    ...sheet,
    rowOrder: [...sheet.rowOrder, rowId],
    rows: { ...sheet.rows, [rowId]: { id: rowId, height } },
    cellIds: [...sheet.cellIds.map((row) => [...row]), newCells.map((cell) => cell.id)],
    updatedAt: Date.now(),
  };
  const nextElements = recalculateSectionSheetElements(
    layoutSectionSheet([...elements, ...newCells], nextSheet),
    nextSheet,
  );
  return {
    elements: nextElements,
    sheet: nextSheet,
    createdCellIds: newCells.map((cell) => cell.id),
    warnings: [],
  };
};

export const appendSectionSheetColumn = (
  elements: readonly BoardElement[],
  sheet: SectionSheet,
  createId: () => string = defaultCreateId,
): SectionSheetResult => {
  const usedColumnIds = new Set(sheet.columnOrder);
  const usedElementIds = new Set(elements.map((element) => element.id));
  const columnId = createUniqueId("column", createId, usedColumnIds);
  const columnIndex = sheet.columnOrder.length;
  const byId = new Map(elements.map((element) => [element.id, element]));
  const maxZIndex = Math.max(0, ...elements.map((element) => element.zIndex ?? 0));
  const newCells = sheet.rowOrder.map((rowId, row) => {
    const template = byId.get(sheet.cellIds[row]?.[Math.max(0, columnIndex - 1)]);
    return cloneSheetCell(
      template,
      createUniqueId("section", createId, usedElementIds),
      sheet.id,
      rowId,
      columnId,
      row,
      columnIndex,
      maxZIndex + row + 1,
    );
  });
  const width =
    sheet.columns[sheet.columnOrder.at(-1) ?? ""]?.width ?? DEFAULT_CELL_WIDTH;
  const nextSheet: SectionSheet = {
    ...sheet,
    columnOrder: [...sheet.columnOrder, columnId],
    columns: { ...sheet.columns, [columnId]: { id: columnId, width } },
    cellIds: sheet.cellIds.map((row, index) => [...row, newCells[index].id]),
    updatedAt: Date.now(),
  };
  const nextElements = recalculateSectionSheetElements(
    layoutSectionSheet([...elements, ...newCells], nextSheet),
    nextSheet,
  );
  return {
    elements: nextElements,
    sheet: nextSheet,
    createdCellIds: newCells.map((cell) => cell.id),
    warnings: [],
  };
};

const plainContent = (content: string) =>
  content
    .replace(/<br\s*\/?\s*>/gi, "\n")
    .replace(/<\/(div|p|li)>/gi, "\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .trim();

const asLiteral = (content: string): string | number => {
  const value = plainContent(content);
  if (/^-?(?:\d+\.?\d*|\.\d+)$/.test(value)) {
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? numericValue : "#NUM!";
  }
  return value;
};

const isFormulaError = (value: string | number) =>
  typeof value === "string" && value.startsWith("#");

const evaluateSectionSheetFromIndex = (
  byId: ReadonlyMap<string, BoardElement>,
  sheet: SectionSheet,
  sharedBudget?: SectionSheetOperationBudget,
): SectionSheetEvaluation => {
  const addressToElement = new Map<string, BoardElement>();
  sheet.cellIds.forEach((row, rowIndex) => {
    row.forEach((id, columnIndex) => {
      const element = byId.get(id);
      if (element) addressToElement.set(getSectionSheetAddress(rowIndex, columnIndex), element);
    });
  });
  const values: Record<string, string | number> = {};
  const errors: Record<string, string> = {};
  const active = new Set<string>();
  const sheetBudget = createSectionSheetOperationBudget();
  const evaluationBudgets = sharedBudget
    ? [sheetBudget, sharedBudget]
    : [sheetBudget];

  const expandRange = (
    range: string,
    formulaBudget: OperationBudget,
  ): ExpandedFormulaRange => {
    const rangeParts = range.split(":");
    if (rangeParts.length !== 2) {
      return { addresses: [], error: "#REF!" };
    }
    const [startText, endText] = rangeParts;
    const start = parseAddress(startText);
    const end = parseAddress(endText);
    if (
      !start ||
      !end ||
      start.row >= sheet.rowOrder.length ||
      end.row >= sheet.rowOrder.length ||
      start.column >= sheet.columnOrder.length ||
      end.column >= sheet.columnOrder.length
    ) {
      return { addresses: [], error: "#REF!" };
    }
    const rowCount = Math.abs(end.row - start.row) + 1;
    const columnCount = Math.abs(end.column - start.column) + 1;
    if (rowCount * columnCount > MAX_FORMULA_RANGE_CELLS) {
      return { addresses: [], error: "#LIMIT!" };
    }
    const operationCount = rowCount * columnCount;
    if (!reserveOperations(operationCount, formulaBudget, ...evaluationBudgets)) {
      return { addresses: [], error: "#LIMIT!" };
    }
    const addresses: string[] = [];
    for (let row = Math.min(start.row, end.row); row <= Math.max(start.row, end.row); row += 1) {
      for (
        let column = Math.min(start.column, end.column);
        column <= Math.max(start.column, end.column);
        column += 1
      ) {
        addresses.push(getSectionSheetAddress(row, column));
      }
    }
    return { addresses };
  };

  const evaluateAddress = (address: string): string | number => {
    const normalizedAddress = address.toUpperCase();
    if (Object.hasOwn(values, normalizedAddress)) return values[normalizedAddress];
    if (active.has(normalizedAddress)) return "#CIRCULAR!";
    if (active.size >= MAX_FORMULA_DEPENDENCY_DEPTH) return "#LIMIT!";
    const element = addressToElement.get(normalizedAddress);
    if (!element) {
      return "#REF!";
    }
    if (!reserveOperations(1, ...evaluationBudgets)) {
      values[normalizedAddress] = "#LIMIT!";
      errors[normalizedAddress] = "#LIMIT!";
      return "#LIMIT!";
    }
    active.add(normalizedAddress);
    const content = plainContent(element.content ?? "");
    let result: string | number;
    if (!content.startsWith("=")) {
      result = asLiteral(content);
    } else {
      result = evaluateFormula(
        content.slice(1),
        evaluateAddress,
        expandRange,
        evaluationBudgets,
      );
    }
    active.delete(normalizedAddress);
    values[normalizedAddress] = result;
    if (isFormulaError(result)) errors[normalizedAddress] = String(result);
    return result;
  };

  addressToElement.forEach((_element, address) => evaluateAddress(address));
  return { values, errors };
};

export const evaluateSectionSheet = (
  elements: readonly BoardElement[],
  sheet: SectionSheet,
  sharedBudget?: SectionSheetOperationBudget,
): SectionSheetEvaluation =>
  evaluateSectionSheetFromIndex(
    new Map(elements.map((element) => [element.id, element])),
    sheet,
    sharedBudget,
  );

interface ExpandedFormulaRange {
  addresses: string[];
  error?: "#REF!" | "#LIMIT!";
}

const evaluateFormula = (
  source: string,
  evaluateAddress: (address: string) => string | number,
  expandRange: (
    range: string,
    formulaBudget: OperationBudget,
  ) => ExpandedFormulaRange,
  evaluationBudgets: OperationBudget[],
): string | number => {
  if (source.length > MAX_FORMULA_LENGTH) return "#LIMIT!";
  const formulaBudget: OperationBudget = {
    remaining: MAX_FORMULA_OPERATIONS,
  };
  const formula = source.trim().toUpperCase();
  const directReference = /^([A-Z]+\d+)$/.exec(formula);
  if (directReference) {
    if (!reserveOperations(1, formulaBudget, ...evaluationBudgets)) return "#LIMIT!";
    return evaluateAddress(directReference[1]);
  }
  const functionMatch = /^(SUM|AVERAGE)\((.*)\)$/.exec(formula);
  if (functionMatch) {
    const addresses: string[] = [];
    let hasInvalidArgument = false;
    for (const part of functionMatch[2].split(",")) {
      const trimmed = part.trim();
      if (trimmed.includes(":")) {
        const expanded = expandRange(trimmed, formulaBudget);
        if (expanded.error) return expanded.error;
        if (!expanded.addresses.length) hasInvalidArgument = true;
        addresses.push(...expanded.addresses);
      } else if (/^[A-Z]+\d+$/.test(trimmed)) {
        if (!reserveOperations(1, formulaBudget, ...evaluationBudgets)) return "#LIMIT!";
        addresses.push(trimmed);
      } else if (trimmed) {
        hasInvalidArgument = true;
      }
    }
    if (hasInvalidArgument) return "#REF!";
    const evaluated = addresses.map(evaluateAddress);
    const error = evaluated.find(isFormulaError);
    if (error !== undefined) return error;
    const numeric = evaluated.filter((value): value is number => typeof value === "number");
    const total = numeric.reduce((sum, value) => sum + value, 0);
    if (!Number.isFinite(total)) return "#NUM!";
    if (functionMatch[1] === "SUM") return total;
    return numeric.length ? total / numeric.length : 0;
  }

  const compact = formula.replace(/\s+/g, "");
  const tokens = compact.match(/[A-Z]+\d+|(?:\d+\.?\d*|\.\d+)|[()+\-*/]/g) ?? [];
  if (tokens.join("") !== compact) return "#FORMULA!";
  if (tokens.length > MAX_FORMULA_TOKENS) return "#LIMIT!";
  if (!reserveOperations(tokens.length, formulaBudget, ...evaluationBudgets)) {
    return "#LIMIT!";
  }
  const output: Array<string | number> = [];
  const operators: string[] = [];
  const precedence: Record<string, number> = {
    "+": 1,
    "-": 1,
    "*": 2,
    "/": 2,
    "u-": 3,
  };
  let expectsValue = true;
  let parenthesisDepth = 0;

  for (const token of tokens) {
    if (/^(?:\d+\.?\d*|\.\d+)$/.test(token)) {
      if (!expectsValue) return "#FORMULA!";
      const numericValue = Number(token);
      if (!Number.isFinite(numericValue)) return "#NUM!";
      output.push(numericValue);
      expectsValue = false;
      continue;
    }
    if (/^[A-Z]+\d+$/.test(token)) {
      if (!expectsValue) return "#FORMULA!";
      output.push(token);
      expectsValue = false;
      continue;
    }
    if (token === "(") {
      if (!expectsValue) return "#FORMULA!";
      operators.push(token);
      parenthesisDepth += 1;
      continue;
    }
    if (token === ")") {
      if (expectsValue || parenthesisDepth === 0) return "#FORMULA!";
      while (operators.length && operators.at(-1) !== "(") output.push(operators.pop()!);
      operators.pop();
      parenthesisDepth -= 1;
      expectsValue = false;
      continue;
    }
    const operator = token === "-" && expectsValue ? "u-" : token;
    if (expectsValue && operator !== "u-") return "#FORMULA!";
    while (
      operators.length &&
      operators.at(-1) !== "(" &&
      (precedence[operators.at(-1)!] > precedence[operator] ||
        (operator !== "u-" &&
          precedence[operators.at(-1)!] === precedence[operator]))
    ) {
      output.push(operators.pop()!);
    }
    operators.push(operator);
    expectsValue = true;
  }
  if (expectsValue || parenthesisDepth !== 0) return "#FORMULA!";
  while (operators.length) output.push(operators.pop()!);

  const stack: Array<string | number> = [];
  for (const token of output) {
    if (typeof token === "number") {
      stack.push(token);
      continue;
    }
    if (/^[A-Z]+\d+$/.test(token)) {
      const value = evaluateAddress(token);
      if (isFormulaError(value)) return value;
      stack.push(typeof value === "number" ? value : Number(value) || 0);
      continue;
    }
    if (token === "u-") {
      if (stack.length < 1) return "#FORMULA!";
      const operand = Number(stack.pop());
      if (!Number.isFinite(operand)) return "#NUM!";
      stack.push(-operand);
      continue;
    }
    if (stack.length < 2) return "#FORMULA!";
    const right = Number(stack.pop());
    const left = Number(stack.pop());
    let result: number;
    if (token === "+") result = left + right;
    else if (token === "-") result = left - right;
    else if (token === "*") result = left * right;
    else if (token === "/") {
      if (right === 0) return "#DIV/0!";
      result = left / right;
    } else return "#FORMULA!";
    if (!Number.isFinite(result)) return "#NUM!";
    stack.push(result);
  }
  return stack.length === 1 ? stack[0] : "#FORMULA!";
};

export const recalculateSectionSheetElements = (
  elements: readonly BoardElement[],
  sheet: SectionSheet,
  sharedBudget?: SectionSheetOperationBudget,
) => recalculateSectionSheetsElements(elements, [sheet], sharedBudget);

export const recalculateSectionSheetsElements = (
  elements: readonly BoardElement[],
  sheets: readonly SectionSheet[],
  sharedBudget?: SectionSheetOperationBudget,
) => {
  if (!sheets.length) return [...elements];
  const byId = new Map(elements.map((element) => [element.id, element]));
  const updates = new Map<string, BoardElement>();

  sheets.forEach((sheet) => {
    const evaluation = evaluateSectionSheetFromIndex(byId, sheet, sharedBudget);
    sheet.cellIds.forEach((row, rowIndex) => {
      row.forEach((cellId, columnIndex) => {
        const element = updates.get(cellId) ?? byId.get(cellId);
        if (!element?.sheetCell || element.sheetCell.sheetId !== sheet.id) return;
        const address = getSectionSheetAddress(rowIndex, columnIndex);
        updates.set(cellId, {
          ...element,
          sheetCell: {
            ...element.sheetCell,
            computedValue: evaluation.values[address],
            error: evaluation.errors[address],
          },
        });
      });
    });
  });

  return elements.map((element) => updates.get(element.id) ?? element);
};

export const runSectionSheetAutomation = (
  elements: readonly BoardElement[],
  sheet: SectionSheet,
  action: SectionSheetAutomationId,
): { elements: BoardElement[]; sheet: SectionSheet } => {
  const updates = new Map<string, string>();
  const byId = new Map(elements.map((element) => [element.id, element]));
  let nextSheet: SectionSheet = { ...sheet, updatedAt: Date.now() };

  if (action === "fill-down") {
    sheet.columnOrder.forEach((_columnId, column) => {
      const source = byId.get(sheet.cellIds[0]?.[column])?.content ?? "";
      sheet.cellIds.slice(1).forEach((row) => updates.set(row[column], source));
    });
  } else if (action === "fill-right") {
    sheet.cellIds.forEach((row) => {
      const source = byId.get(row[0])?.content ?? "";
      row.slice(1).forEach((id) => updates.set(id, source));
    });
  } else if (action === "series") {
    const firstId = sheet.cellIds.flat()[0];
    const startingValue = Number(plainContent(byId.get(firstId)?.content ?? "0"));
    const safeStart = Number.isFinite(startingValue) ? startingValue : 0;
    sheet.cellIds.flat().forEach((id, index) => updates.set(id, String(safeStart + index)));
  } else if (action === "auto-fit") {
    const rows = { ...sheet.rows };
    const columns = { ...sheet.columns };
    sheet.rowOrder.forEach((rowId, row) => {
      const longestLines = Math.max(
        1,
        ...sheet.cellIds[row].map((id) => plainContent(byId.get(id)?.content ?? "").split("\n").length),
      );
      rows[rowId] = { ...rows[rowId], height: Math.min(160, Math.max(MIN_CELL_HEIGHT, 20 + longestLines * 18)) };
    });
    sheet.columnOrder.forEach((columnId, column) => {
      const longest = Math.max(
        4,
        ...sheet.cellIds.map((row) => plainContent(byId.get(row[column])?.content ?? "").length),
      );
      columns[columnId] = { ...columns[columnId], width: Math.min(360, Math.max(MIN_CELL_WIDTH, 28 + longest * 7)) };
    });
    nextSheet = { ...nextSheet, rows, columns };
  }

  const contentUpdated = elements.map((element) =>
    updates.has(element.id) ? { ...element, content: updates.get(element.id)! } : element,
  );
  const laidOut = action === "auto-fit" ? layoutSectionSheet(contentUpdated, nextSheet) : contentUpdated;
  return {
    elements: recalculateSectionSheetElements(laidOut, nextSheet),
    sheet: nextSheet,
  };
};

export const validateSectionSheet = (
  elements: readonly BoardElement[],
  sheet: SectionSheet,
) => {
  const errors: string[] = [];
  if (sheet.version !== 1) errors.push("Unsupported spreadsheet version.");
  if (!sheet.rowOrder.length || !sheet.columnOrder.length) {
    errors.push("A spreadsheet needs at least one row and one column.");
  }
  if (sheet.cellIds.length !== sheet.rowOrder.length) {
    errors.push("Spreadsheet row count does not match cell rows.");
  }
  const flatIds = sheet.cellIds.flat();
  if (flatIds.length !== sheet.rowOrder.length * sheet.columnOrder.length) {
    errors.push("Spreadsheet dimensions do not match its cells.");
  }
  if (new Set(flatIds).size !== flatIds.length) {
    errors.push("A Section cannot occupy more than one spreadsheet address.");
  }
  const byId = new Map(elements.map((element) => [element.id, element]));
  sheet.cellIds.forEach((row, rowIndex) => {
    row.forEach((id, columnIndex) => {
      const element = byId.get(id);
      if (!element || element.type !== "section") {
        errors.push(`Cell ${getSectionSheetAddress(rowIndex, columnIndex)} is not a Section.`);
        return;
      }
      if (
        element.sheetCell?.sheetId !== sheet.id ||
        element.sheetCell.rowId !== sheet.rowOrder[rowIndex] ||
        element.sheetCell.columnId !== sheet.columnOrder[columnIndex]
      ) {
        errors.push(`Cell ${getSectionSheetAddress(rowIndex, columnIndex)} has invalid metadata.`);
      }
    });
  });
  return errors;
};

export const detachSectionSheetCells = (
  elements: readonly BoardElement[],
  sheetIds: ReadonlySet<string>,
) =>
  elements.map<BoardElement>((element) => {
    if (!element.sheetCell || !sheetIds.has(element.sheetCell.sheetId)) {
      return element;
    }
    const { sheetCell, ...detachedElement } = element;
    const isFormula = plainContent(element.content ?? "").startsWith("=");
    const frozenValue = sheetCell.error ?? sheetCell.computedValue;
    return {
      ...detachedElement,
      content:
        isFormula && frozenValue !== undefined
          ? String(frozenValue)
          : element.content,
    } as BoardElement;
  });

export const reconcileSectionSheetsAfterDeletion = (
  elements: readonly BoardElement[],
  sectionSheets: readonly SectionSheet[],
  removedElementIds: ReadonlySet<string>,
) => {
  const survivingElementIds = new Set(elements.map((element) => element.id));
  const detachedSheetIds = new Set(
    sectionSheets
      .filter((sheet) =>
        sheet.cellIds
          .flat()
          .some(
            (cellId) =>
              removedElementIds.has(cellId) || !survivingElementIds.has(cellId),
          ),
      )
      .map((sheet) => sheet.id),
  );

  if (detachedSheetIds.size === 0) {
    return {
      elements: [...elements],
      sectionSheets: [...sectionSheets],
      detachedSheetIds,
    };
  }

  return {
    elements: detachSectionSheetCells(elements, detachedSheetIds),
    sectionSheets: sectionSheets.filter(
      (sheet) => !detachedSheetIds.has(sheet.id),
    ),
    detachedSheetIds,
  };
};

export const getAdjacentSectionSheetCellId = (
  sheet: SectionSheet,
  cellId: string,
  direction: "left" | "right" | "up" | "down" | "next" | "previous",
) => {
  let row = -1;
  let column = -1;
  sheet.cellIds.some((candidateRow, rowIndex) => {
    const columnIndex = candidateRow.indexOf(cellId);
    if (columnIndex === -1) return false;
    row = rowIndex;
    column = columnIndex;
    return true;
  });
  if (row < 0 || column < 0) return undefined;
  if (direction === "left") column -= 1;
  if (direction === "right") column += 1;
  if (direction === "up") row -= 1;
  if (direction === "down") row += 1;
  if (direction === "next") {
    column += 1;
    if (column >= sheet.columnOrder.length) {
      column = 0;
      row += 1;
    }
  }
  if (direction === "previous") {
    column -= 1;
    if (column < 0) {
      column = sheet.columnOrder.length - 1;
      row -= 1;
    }
  }
  if (row < 0 || row >= sheet.rowOrder.length || column < 0 || column >= sheet.columnOrder.length) {
    return undefined;
  }
  return sheet.cellIds[row]?.[column];
};
