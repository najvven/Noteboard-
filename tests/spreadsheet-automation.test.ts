import assert from "node:assert/strict";
import test from "node:test";

import {
  getSectionSheetAutomationShortcut,
  getTriggeredSectionSheetAutomations,
  runSectionSheetAutomationsForTrigger,
  updateSectionSheetAutomation,
  updateSectionSheetShortcut,
} from "../src/features/spreadsheet/automation";
import { createSectionSheetFromSections } from "../src/features/spreadsheet/model";

const sequentialIds = () => {
  let value = 0;
  return () => `automation-${++value}`;
};

test("disabled spreadsheet automations cannot resolve keyboard shortcuts", () => {
  const created = createSectionSheetFromSections([], {
    sectionIds: [],
    layout: "grid",
    rows: 2,
    columns: 2,
    createId: sequentialIds(),
  });
  const fillDown = created.sheet.automations.find(
    (automation) => automation.action === "fill-down",
  )!;
  const disabled = updateSectionSheetAutomation(created.sheet, fillDown.id, {
    enabled: false,
  });

  assert.equal(
    getSectionSheetAutomationShortcut(disabled, "fill-down"),
    undefined,
  );
});

test("shortcut settings update the matching automation immutably", () => {
  const created = createSectionSheetFromSections([], {
    sectionIds: [],
    layout: "grid",
    rows: 2,
    columns: 2,
    createId: sequentialIds(),
  });
  const snapshot = structuredClone(created.sheet);
  const updated = updateSectionSheetShortcut(
    created.sheet,
    "fillDown",
    "Ctrl+Alt+D",
  );

  assert.deepEqual(created.sheet, snapshot);
  assert.equal(updated.shortcuts.fillDown, "Ctrl+Alt+D");
  assert.equal(
    getSectionSheetAutomationShortcut(updated, "fill-down"),
    "Ctrl+Alt+D",
  );
});

test("cell-change trigger runs only enabled matching automations", () => {
  const created = createSectionSheetFromSections([], {
    sectionIds: [],
    layout: "grid",
    rows: 2,
    columns: 2,
    createId: sequentialIds(),
  });
  const [a1] = created.sheet.cellIds[0];
  const seeded = created.elements.map((element) =>
    element.id === a1 ? { ...element, content: "12" } : element,
  );
  const fillDown = created.sheet.automations.find(
    (automation) => automation.action === "fill-down",
  )!;
  const cellChangeSheet = updateSectionSheetAutomation(
    created.sheet,
    fillDown.id,
    { trigger: "cell-change", enabled: true },
  );
  const result = runSectionSheetAutomationsForTrigger(
    seeded,
    cellChangeSheet,
    "cell-change",
  );

  assert.equal(
    result.elements.find(
      (element) => element.id === cellChangeSheet.cellIds[1][0],
    )?.content,
    "12",
  );
});

test("duplicate automations execute each action at most once per trigger", () => {
  const created = createSectionSheetFromSections([], {
    sectionIds: [],
    layout: "grid",
    rows: 2,
    columns: 1,
    createId: sequentialIds(),
  });
  const [a1] = created.sheet.cellIds[0];
  const seeded = created.elements.map((element) =>
    element.id === a1 ? { ...element, content: "5" } : element,
  );
  const fillDown = created.sheet.automations.find(
    (automation) => automation.action === "fill-down",
  )!;
  const duplicated = {
    ...created.sheet,
    automations: [
      { ...fillDown, trigger: "cell-change" as const },
      { ...fillDown, id: "duplicate-fill", trigger: "cell-change" as const },
    ],
  };
  const result = runSectionSheetAutomationsForTrigger(
    seeded,
    duplicated,
    "cell-change",
  );

  assert.equal(
    getTriggeredSectionSheetAutomations(duplicated, "cell-change").length,
    1,
  );
  assert.equal(
    result.elements.find((element) => element.id === duplicated.cellIds[1][0])
      ?.content,
    "5",
  );
});
