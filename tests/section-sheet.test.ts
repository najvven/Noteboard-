import assert from "node:assert/strict";
import test from "node:test";

import type { BoardElement } from "../src/types.ts";
import {
  appendSectionSheetColumn,
  appendSectionSheetRow,
  createSectionSheetFromSections,
  createSectionSheetOperationBudget,
  detachSectionSheetCells,
  evaluateSectionSheet,
  getAdjacentSectionSheetCellId,
  getSectionSheetAddress,
  reconcileSectionSheetsAfterDeletion,
  recalculateSectionSheetElements,
  runSectionSheetAutomation,
  updateSectionSheetCellGeometry,
  validateSectionSheet,
} from "../src/features/spreadsheet/model.ts";

const makeSection = (
  id: string,
  x: number,
  y: number,
  content = "",
): BoardElement => ({
  id,
  type: "section",
  position: { x, y },
  size: { width: 120, height: 48 },
  content,
  color: "#ffffff",
  borderColor: "#cbd5e1",
  borderWidth: 1,
  zIndex: 1,
});

const sequentialIds = () => {
  let index = 0;
  return () => `generated-${++index}`;
};

test("multiple Sections become a deterministic row-major sheet without losing ids or styles", () => {
  const elements = [
    makeSection("c", 150, 80, "3"),
    makeSection("a", 10, 10, "1"),
    makeSection("d", 150, 10, "2"),
    makeSection("b", 10, 80, "4"),
  ];
  const original = structuredClone(elements);

  const result = createSectionSheetFromSections(elements, {
    sectionIds: elements.map((element) => element.id),
    layout: "grid",
    rows: 2,
    columns: 2,
    createId: sequentialIds(),
  });

  assert.deepEqual(elements, original);
  assert.deepEqual(result.sheet.rowOrder.length, 2);
  assert.deepEqual(result.sheet.columnOrder.length, 2);
  assert.deepEqual(
    result.sheet.cellIds,
    [
      ["a", "d"],
      ["b", "c"],
    ],
  );
  assert.deepEqual(
    result.elements.filter((element) => element.sheetCell).map((element) => element.id).sort(),
    ["a", "b", "c", "d"],
  );
  assert.equal(result.elements.find((element) => element.id === "a")?.color, "#ffffff");
  assert.deepEqual(validateSectionSheet(result.elements, result.sheet), []);
});

test("one Section can seed a 2 by 3 spreadsheet preset", () => {
  const source = makeSection("source", 20, 30, "Header");

  const result = createSectionSheetFromSections([source], {
    sectionIds: [source.id],
    layout: "grid",
    rows: 2,
    columns: 3,
    createId: sequentialIds(),
  });

  assert.equal(result.sheet.cellIds.flat().length, 6);
  assert.equal(result.sheet.cellIds[0][0], source.id);
  assert.equal(new Set(result.sheet.cellIds.flat()).size, 6);
  assert.equal(result.elements.length, 6);
  assert.equal(result.elements.find((element) => element.id === source.id)?.content, "Header");
});

test("row and column commands are immutable and keep sheet addresses valid", () => {
  const initial = createSectionSheetFromSections([], {
    sectionIds: [],
    layout: "grid",
    rows: 2,
    columns: 2,
    bounds: { x: 0, y: 0, width: 240, height: 96 },
    createId: sequentialIds(),
  });
  const initialSnapshot = structuredClone(initial);
  const withRow = appendSectionSheetRow(initial.elements, initial.sheet, sequentialIds());
  const withColumn = appendSectionSheetColumn(
    withRow.elements,
    withRow.sheet,
    sequentialIds(),
  );

  assert.deepEqual(initial, initialSnapshot);
  assert.equal(withColumn.sheet.rowOrder.length, 3);
  assert.equal(withColumn.sheet.columnOrder.length, 3);
  assert.equal(withColumn.sheet.cellIds.flat().length, 9);
  assert.deepEqual(validateSectionSheet(withColumn.elements, withColumn.sheet), []);
});

test("cell resize and move update sheet geometry for the whole grid", () => {
  const initial = createSectionSheetFromSections([], {
    sectionIds: [],
    layout: "grid",
    rows: 2,
    columns: 2,
    createId: sequentialIds(),
  });
  const original = structuredClone(initial);
  const [[a1, b1], [a2]] = initial.sheet.cellIds;

  const updated = updateSectionSheetCellGeometry(
    initial.elements,
    initial.sheet,
    a1,
    { position: { x: 50, y: 60 }, size: { width: 200, height: 70 } },
  );

  assert.equal(updated.sheet.columns[updated.sheet.columnOrder[0]].width, 200);
  assert.equal(updated.sheet.rows[updated.sheet.rowOrder[0]].height, 70);
  assert.deepEqual(updated.elements.find((element) => element.id === a1)?.position, { x: 50, y: 60 });
  assert.deepEqual(updated.elements.find((element) => element.id === b1)?.position, { x: 250, y: 60 });
  assert.deepEqual(updated.elements.find((element) => element.id === a2)?.position, { x: 50, y: 130 });
  assert.deepEqual(initial, original);

  const appended = appendSectionSheetRow(updated.elements, updated.sheet, sequentialIds());
  const appendedFirstCell = appended.elements.find(
    (element) => element.id === appended.sheet.cellIds.at(-1)?.[0],
  );
  assert.equal(appendedFirstCell?.size?.width, 200);
});

test("resizing an interior spreadsheet boundary keeps the sheet origin fixed", () => {
  const initial = createSectionSheetFromSections([], {
    sectionIds: [],
    layout: "grid",
    rows: 2,
    columns: 2,
    bounds: { x: 0, y: 0, width: 240, height: 96 },
    createId: sequentialIds(),
  });
  const [[a1, b1], [a2]] = initial.sheet.cellIds;
  const b1Element = initial.elements.find((element) => element.id === b1)!;
  const a2Element = initial.elements.find((element) => element.id === a2)!;

  const columnBoundary = updateSectionSheetCellGeometry(
    initial.elements,
    initial.sheet,
    b1,
    {
      position: { x: b1Element.position.x + 20, y: b1Element.position.y },
      size: { width: b1Element.size!.width - 20, height: b1Element.size!.height },
    },
  );
  const columnA = columnBoundary.sheet.columns[columnBoundary.sheet.columnOrder[0]];
  assert.equal(columnA.width, 140);
  assert.deepEqual(
    columnBoundary.elements.find((element) => element.id === a1)?.position,
    { x: 0, y: 0 },
  );
  assert.deepEqual(
    columnBoundary.elements.find((element) => element.id === b1)?.position,
    { x: 140, y: 0 },
  );

  const rowBoundary = updateSectionSheetCellGeometry(
    initial.elements,
    initial.sheet,
    a2,
    {
      position: { x: a2Element.position.x, y: a2Element.position.y + 10 },
      size: { width: a2Element.size!.width, height: a2Element.size!.height - 10 },
    },
  );
  const firstRow = rowBoundary.sheet.rows[rowBoundary.sheet.rowOrder[0]];
  assert.equal(firstRow.height, 58);
  assert.deepEqual(
    rowBoundary.elements.find((element) => element.id === a1)?.position,
    { x: 0, y: 0 },
  );
  assert.deepEqual(
    rowBoundary.elements.find((element) => element.id === a2)?.position,
    { x: 0, y: 58 },
  );
});

test("interior spreadsheet boundaries preserve the outer edge at minimum size", () => {
  const initial = createSectionSheetFromSections([], {
    sectionIds: [],
    layout: "grid",
    rows: 2,
    columns: 2,
    bounds: { x: 0, y: 0, width: 240, height: 96 },
    createId: sequentialIds(),
  });
  const [[, b1], [a2]] = initial.sheet.cellIds;
  const b1Element = initial.elements.find((element) => element.id === b1)!;
  const a2Element = initial.elements.find((element) => element.id === a2)!;

  const columns = updateSectionSheetCellGeometry(
    initial.elements,
    initial.sheet,
    b1,
    {
      position: { x: b1Element.position.x - 100, y: b1Element.position.y },
      size: { width: b1Element.size!.width + 100, height: b1Element.size!.height },
    },
  );
  const [firstColumnId, secondColumnId] = columns.sheet.columnOrder;
  assert.equal(columns.sheet.columns[firstColumnId].width, 72);
  assert.equal(columns.sheet.columns[secondColumnId].width, 168);
  const placedB1 = columns.elements.find((element) => element.id === b1)!;
  assert.equal(placedB1.position.x + placedB1.size!.width, 240);

  const rows = updateSectionSheetCellGeometry(
    initial.elements,
    initial.sheet,
    a2,
    {
      position: { x: a2Element.position.x, y: a2Element.position.y - 100 },
      size: { width: a2Element.size!.width, height: a2Element.size!.height + 100 },
    },
  );
  const [firstRowId, secondRowId] = rows.sheet.rowOrder;
  assert.equal(rows.sheet.rows[firstRowId].height, 36);
  assert.equal(rows.sheet.rows[secondRowId].height, 60);
  const placedA2 = rows.elements.find((element) => element.id === a2)!;
  assert.equal(placedA2.position.y + placedA2.size!.height, 96);
});

test("outer spreadsheet boundaries preserve the opposite edge at minimum size", () => {
  const initial = createSectionSheetFromSections([], {
    sectionIds: [],
    layout: "rows",
    rows: 1,
    columns: 1,
    bounds: { x: 0, y: 0, width: 120, height: 48 },
    createId: sequentialIds(),
  });
  const cellId = initial.sheet.cellIds[0][0];
  const resized = updateSectionSheetCellGeometry(
    initial.elements,
    initial.sheet,
    cellId,
    { position: { x: 100, y: 100 }, size: { width: 20, height: 10 } },
  );
  const cell = resized.elements.find((element) => element.id === cellId)!;

  assert.deepEqual(cell.position, { x: 48, y: 12 });
  assert.deepEqual(cell.size, { width: 72, height: 36 });
  assert.deepEqual(
    { right: cell.position.x + cell.size!.width, bottom: cell.position.y + cell.size!.height },
    { right: 120, bottom: 48 },
  );
});

test("new spreadsheet cells inherit the common source layer", () => {
  const source = {
    ...makeSection("layered-section", 0, 0, "Layered"),
    parentId: "layer-a",
  };
  const initial = createSectionSheetFromSections([source], {
    sectionIds: [source.id],
    layout: "grid",
    rows: 2,
    columns: 2,
    createId: sequentialIds(),
  });
  const withRow = appendSectionSheetRow(
    initial.elements,
    initial.sheet,
    sequentialIds(),
  );
  const withColumn = appendSectionSheetColumn(
    withRow.elements,
    withRow.sheet,
    sequentialIds(),
  );

  assert.ok(
    withColumn.sheet.cellIds
      .flat()
      .every(
        (id) =>
          withColumn.elements.find((element) => element.id === id)?.parentId ===
          "layer-a",
      ),
  );
});

test("spreadsheet conversion rejects Sections from different parents", () => {
  const first = { ...makeSection("first", 0, 0), parentId: "layer-a" };
  const second = { ...makeSection("second", 120, 0), parentId: "layer-b" };

  assert.throws(
    () =>
      createSectionSheetFromSections([first, second], {
        sectionIds: [first.id, second.id],
        layout: "rows",
      }),
    /same layer or board/i,
  );
});

test("a blank spreadsheet preset stays on its requested hierarchy surface", () => {
  const result = createSectionSheetFromSections([], {
    sectionIds: [],
    layout: "grid",
    rows: 2,
    columns: 2,
    parentId: "active-layer",
    createId: sequentialIds(),
  });

  assert.ok(
    result.elements.every((element) => element.parentId === "active-layer"),
  );
});

test("safe spreadsheet formulas support references, SUM, AVERAGE and circular errors", () => {
  const initial = createSectionSheetFromSections([], {
    sectionIds: [],
    layout: "rows",
    rows: 1,
    columns: 4,
    bounds: { x: 0, y: 0, width: 480, height: 48 },
    createId: sequentialIds(),
  });
  const ids = initial.sheet.cellIds[0];
  const elements = initial.elements.map((element) => {
    if (element.id === ids[0]) return { ...element, content: "2" };
    if (element.id === ids[1]) return { ...element, content: "4" };
    if (element.id === ids[2]) return { ...element, content: "=SUM(A1:B1)" };
    if (element.id === ids[3]) return { ...element, content: "=AVERAGE(A1:C1)" };
    return element;
  });

  const evaluated = evaluateSectionSheet(elements, initial.sheet);
  assert.equal(evaluated.values.A1, 2);
  assert.equal(evaluated.values.C1, 6);
  assert.equal(evaluated.values.D1, 4);

  const circular = elements.map((element) =>
    element.id === ids[0] ? { ...element, content: "=D1" } : element,
  );
  assert.match(String(evaluateSectionSheet(circular, initial.sheet).values.A1), /CIRCULAR/);
});

test("fill-down and series automations update cells in one immutable result", () => {
  const initial = createSectionSheetFromSections([], {
    sectionIds: [],
    layout: "grid",
    rows: 3,
    columns: 2,
    bounds: { x: 0, y: 0, width: 240, height: 144 },
    createId: sequentialIds(),
  });
  const firstId = initial.sheet.cellIds[0][0];
  const seeded = initial.elements.map((element) =>
    element.id === firstId ? { ...element, content: "10" } : element,
  );
  const snapshot = structuredClone(seeded);

  const filled = runSectionSheetAutomation(seeded, initial.sheet, "fill-down");
  const series = runSectionSheetAutomation(filled.elements, filled.sheet, "series");

  assert.deepEqual(seeded, snapshot);
  assert.equal(
    filled.elements.find((element) => element.id === initial.sheet.cellIds[2][0])?.content,
    "10",
  );
  assert.deepEqual(
    series.sheet.cellIds.flat().map(
      (id) => series.elements.find((element) => element.id === id)?.content,
    ),
    ["10", "11", "12", "13", "14", "15"],
  );
});

test("row, column and automatic grid layouts cover the available Section presets", () => {
  const elements = [
    makeSection("a", 0, 0),
    makeSection("b", 150, 0),
    makeSection("c", 300, 0),
  ];
  const row = createSectionSheetFromSections(elements, {
    sectionIds: elements.map((element) => element.id),
    layout: "rows",
    createId: sequentialIds(),
  });
  const column = createSectionSheetFromSections(elements, {
    sectionIds: elements.map((element) => element.id),
    layout: "columns",
    createId: sequentialIds(),
  });
  const grid = createSectionSheetFromSections(elements, {
    sectionIds: elements.map((element) => element.id),
    layout: "grid",
    createId: sequentialIds(),
  });

  assert.deepEqual([row.sheet.rowOrder.length, row.sheet.columnOrder.length], [1, 3]);
  assert.deepEqual([column.sheet.rowOrder.length, column.sheet.columnOrder.length], [3, 1]);
  assert.deepEqual([grid.sheet.rowOrder.length, grid.sheet.columnOrder.length], [2, 2]);
});

test("unsafe or ambiguous Section membership is rejected before conversion", () => {
  const locked = { ...makeSection("locked", 0, 0), isLocked: true };
  const text = { ...makeSection("text", 0, 0), type: "text" as const };
  const member = {
    ...makeSection("member", 0, 0),
    sheetCell: {
      sheetId: "sheet",
      rowId: "row",
      columnId: "column",
      address: "A1",
    },
  };

  assert.throws(() =>
    createSectionSheetFromSections([locked], {
      sectionIds: [locked.id],
      layout: "rows",
    }),
  );
  assert.throws(() =>
    createSectionSheetFromSections([text], {
      sectionIds: [text.id],
      layout: "rows",
    }),
  );
  assert.throws(() =>
    createSectionSheetFromSections([member], {
      sectionIds: [member.id],
      layout: "rows",
    }),
  );
  assert.throws(() =>
    createSectionSheetFromSections([makeSection("a", 0, 0)], {
      sectionIds: ["a", "a"],
      layout: "rows",
    }),
  );
});

test("auto-fit and fill-right automations resize and populate the sheet", () => {
  const initial = createSectionSheetFromSections([], {
    sectionIds: [],
    layout: "grid",
    rows: 2,
    columns: 2,
    createId: sequentialIds(),
  });
  const [a1, b1] = initial.sheet.cellIds[0];
  const seeded = initial.elements.map((element) => {
    if (element.id === a1) return { ...element, content: "A long heading value" };
    if (element.id === b1) return { ...element, content: "line 1\nline 2\nline 3" };
    return element;
  });

  const filled = runSectionSheetAutomation(seeded, initial.sheet, "fill-right");
  const fitted = runSectionSheetAutomation(filled.elements, filled.sheet, "auto-fit");

  assert.equal(
    filled.elements.find((element) => element.id === b1)?.content,
    "A long heading value",
  );
  assert.ok(fitted.sheet.columns[fitted.sheet.columnOrder[0]].width > 72);
  assert.ok(fitted.sheet.rows[fitted.sheet.rowOrder[0]].height >= 36);
});

test("formula evaluator reports invalid expressions and division by zero", () => {
  const initial = createSectionSheetFromSections([], {
    sectionIds: [],
    layout: "rows",
    rows: 1,
    columns: 4,
    createId: sequentialIds(),
  });
  const ids = initial.sheet.cellIds[0];
  const elements = initial.elements.map((element) => {
    if (element.id === ids[0]) return { ...element, content: "=10/0" };
    if (element.id === ids[1]) return { ...element, content: "=2+3*4" };
    if (element.id === ids[2]) return { ...element, content: "=SUM(A1:BAD)" };
    if (element.id === ids[3]) return { ...element, content: "=WHAT(A1)" };
    return element;
  });

  const result = evaluateSectionSheet(elements, initial.sheet);
  assert.equal(result.values.A1, "#DIV/0!");
  assert.equal(result.values.B1, 14);
  assert.match(String(result.values.C1), /^#/);
  assert.match(String(result.values.D1), /^#/);
});

test("formula parser rejects missing operands and supports unary minus safely", () => {
  const initial = createSectionSheetFromSections([], {
    sectionIds: [],
    layout: "rows",
    rows: 1,
    columns: 6,
    createId: sequentialIds(),
  });
  const formulas = ["=1+", "=+1", "=1+)", "=2*-3", `=${"9".repeat(9_000)}`, "9".repeat(9_000)];
  const elements = initial.elements.map((element, index) => ({
    ...element,
    content: formulas[index],
  }));

  const result = evaluateSectionSheet(elements, initial.sheet);
  assert.equal(result.values.A1, "#FORMULA!");
  assert.equal(result.values.B1, "#FORMULA!");
  assert.equal(result.values.C1, "#FORMULA!");
  assert.equal(result.values.D1, -6);
  assert.equal(result.values.E1, "#NUM!");
  assert.equal(result.values.F1, "#NUM!");
});

test("formula evaluation rejects work that could block the editor", () => {
  const initial = createSectionSheetFromSections([], {
    sectionIds: [],
    layout: "rows",
    rows: 1,
    columns: 2,
    createId: sequentialIds(),
  });
  const [formulaId, oversizedRangeId] = initial.sheet.cellIds[0];
  const elements = initial.elements.map((element) => {
    if (element.id === formulaId) {
      return { ...element, content: `=${new Array(1_201).fill("1").join("+")}` };
    }
    if (element.id === oversizedRangeId) {
      return { ...element, content: "=SUM(A1:ZZZ999999)" };
    }
    return element;
  });

  const result = evaluateSectionSheet(elements, initial.sheet);
  assert.equal(result.values.A1, "#LIMIT!");
  assert.equal(result.values.B1, "#REF!");
});

test("formula reference budgets are cumulative and malformed ranges are rejected", () => {
  const initial = createSectionSheetFromSections([], {
    sectionIds: [],
    layout: "grid",
    rows: 11,
    columns: 10,
    createId: sequentialIds(),
  });
  const cumulativeBudgetId = initial.sheet.cellIds[10][0];
  const malformedRangeId = initial.sheet.cellIds[10][1];
  const repeatedRange = new Array(101).fill("A1:J10").join(",");
  const elements = initial.elements.map((element) => {
    if (element.id === cumulativeBudgetId) {
      return { ...element, content: `=SUM(${repeatedRange})` };
    }
    if (element.id === malformedRangeId) {
      return { ...element, content: "=SUM(A1:B1:C2)" };
    }
    return element;
  });

  const result = evaluateSectionSheet(elements, initial.sheet);
  assert.equal(result.values.A11, "#LIMIT!");
  assert.equal(result.values.B11, "#REF!");
});

test("sheet evaluation has one global operation budget", () => {
  const initial = createSectionSheetFromSections([], {
    sectionIds: [],
    layout: "grid",
    rows: 260,
    columns: 10,
    createId: sequentialIds(),
  });
  const elements = initial.elements.map((element, index) => ({
    ...element,
    content: index < 100 ? "1" : "=SUM(A1:J10)",
  }));

  const result = evaluateSectionSheet(elements, initial.sheet);
  assert.equal(result.values.J260, "#LIMIT!");
});

test("one shared operation budget caps recalculation across multiple sheets", () => {
  const first = createSectionSheetFromSections([], {
    sectionIds: [],
    layout: "rows",
    rows: 1,
    columns: 2,
    createId: sequentialIds(),
  });
  const second = createSectionSheetFromSections([], {
    sectionIds: [],
    layout: "rows",
    rows: 1,
    columns: 2,
    createId: sequentialIds(),
  });
  const budget = createSectionSheetOperationBudget(2);
  recalculateSectionSheetElements(first.elements, first.sheet, budget);
  const recalculatedSecond = recalculateSectionSheetElements(
    second.elements,
    second.sheet,
    budget,
  );

  assert.equal(recalculatedSecond[0].sheetCell?.computedValue, "#LIMIT!");
  assert.equal(budget.remaining, 0);
});

test("formula evaluation caps deep dependency chains", () => {
  const initial = createSectionSheetFromSections([], {
    sectionIds: [],
    layout: "rows",
    rows: 1,
    columns: 300,
    createId: sequentialIds(),
  });
  const cellIds = initial.sheet.cellIds[0];
  const elements = initial.elements.map((element, index) => ({
    ...element,
    content:
      index === cellIds.length - 1
        ? "1"
        : `=${getSectionSheetAddress(0, index + 1)}`,
  }));

  const result = evaluateSectionSheet(elements, initial.sheet);
  assert.equal(result.values.A1, "#LIMIT!");
});

test("cell navigation supports arrows, tab wrapping and sheet boundaries", () => {
  const initial = createSectionSheetFromSections([], {
    sectionIds: [],
    layout: "grid",
    rows: 2,
    columns: 2,
    createId: sequentialIds(),
  });
  const [[a1, b1], [a2, b2]] = initial.sheet.cellIds;

  assert.equal(getAdjacentSectionSheetCellId(initial.sheet, a1, "right"), b1);
  assert.equal(getAdjacentSectionSheetCellId(initial.sheet, a1, "down"), a2);
  assert.equal(getAdjacentSectionSheetCellId(initial.sheet, b1, "next"), a2);
  assert.equal(getAdjacentSectionSheetCellId(initial.sheet, a2, "previous"), b1);
  assert.equal(getAdjacentSectionSheetCellId(initial.sheet, b2, "left"), a2);
  assert.equal(getAdjacentSectionSheetCellId(initial.sheet, b2, "up"), b1);
  assert.equal(getAdjacentSectionSheetCellId(initial.sheet, a1, "left"), undefined);
  assert.equal(getAdjacentSectionSheetCellId(initial.sheet, "missing", "next"), undefined);
});

test("sheet validation explains structural and metadata damage", () => {
  const initial = createSectionSheetFromSections([], {
    sectionIds: [],
    layout: "rows",
    rows: 1,
    columns: 2,
    createId: sequentialIds(),
  });
  const damaged = {
    ...initial.sheet,
    version: 2 as 1,
    rowOrder: [],
    cellIds: [[initial.sheet.cellIds[0][0], initial.sheet.cellIds[0][0]]],
  };
  const errors = validateSectionSheet(initial.elements, damaged);

  assert.ok(errors.some((error) => error.includes("version")));
  assert.ok(errors.some((error) => error.includes("row")));
  assert.ok(errors.some((error) => error.includes("more than one")));
});

test("deleting a container cannot leave dangling spreadsheet references", () => {
  const initial = createSectionSheetFromSections([], {
    sectionIds: [],
    layout: "rows",
    rows: 1,
    columns: 3,
    createId: sequentialIds(),
  });
  const [removedId, ...survivingIds] = initial.sheet.cellIds[0];
  const survivors = initial.elements.filter((element) => element.id !== removedId);

  const reconciled = reconcileSectionSheetsAfterDeletion(
    survivors,
    [initial.sheet],
    new Set([removedId]),
  );

  assert.deepEqual(reconciled.sectionSheets, []);
  assert.deepEqual(
    reconciled.elements
      .filter((element) => survivingIds.includes(element.id))
      .map((element) => element.sheetCell),
    [undefined, undefined],
  );
  assert.equal(reconciled.detachedSheetIds.has(initial.sheet.id), true);
  assert.equal(validateSectionSheet(reconciled.elements, initial.sheet).length > 0, true);
  assert.deepEqual(initial.sheet.cellIds[0], [removedId, ...survivingIds]);
});

test("detaching a spreadsheet freezes formulas into visible regular Section values", () => {
  const initial = createSectionSheetFromSections([], {
    sectionIds: [],
    layout: "rows",
    rows: 1,
    columns: 2,
    createId: sequentialIds(),
  });
  const [a1, b1] = initial.sheet.cellIds[0];
  const withFormula = recalculateSectionSheetElements(
    initial.elements.map((element) => {
      if (element.id === a1) return { ...element, content: "7" };
      if (element.id === b1) return { ...element, content: "=A1*2" };
      return element;
    }),
    initial.sheet,
  );

  const detached = detachSectionSheetCells(withFormula, new Set([initial.sheet.id]));

  assert.equal(detached.find((element) => element.id === a1)?.content, "7");
  assert.equal(detached.find((element) => element.id === b1)?.content, "14");
  assert.equal(detached.some((element) => element.sheetCell), false);
  assert.equal(withFormula.find((element) => element.id === b1)?.content, "=A1*2");
});
