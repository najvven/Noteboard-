import type { BoardElement } from "../../types";
import { runSectionSheetAutomation } from "./model";
import { SECTION_SHEET_COMMAND_BY_ACTION } from "./types";
import type {
  SectionSheet,
  SectionSheetAutomation,
  SectionSheetAutomationId,
  SectionSheetShortcutCommand,
} from "./types";

export const getSectionSheetAutomationShortcut = (
  sheet: SectionSheet,
  action: SectionSheetAutomationId,
) => {
  const automation = sheet.automations.find(
    (candidate) =>
      candidate.action === action &&
      candidate.enabled &&
      candidate.trigger === "shortcut",
  );
  if (!automation) return undefined;
  return sheet.shortcuts[SECTION_SHEET_COMMAND_BY_ACTION[action]];
};

export const updateSectionSheetAutomation = (
  sheet: SectionSheet,
  automationId: string,
  updates: Partial<
    Pick<SectionSheetAutomation, "enabled" | "trigger" | "shortcut">
  >,
): SectionSheet => ({
  ...sheet,
  automations: sheet.automations.map((automation) =>
    automation.id === automationId ? { ...automation, ...updates } : automation,
  ),
  updatedAt: Date.now(),
});

export const updateSectionSheetShortcut = (
  sheet: SectionSheet,
  command: SectionSheetShortcutCommand,
  shortcut: string,
): SectionSheet => {
  const action = (
    Object.entries(SECTION_SHEET_COMMAND_BY_ACTION) as Array<
      [SectionSheetAutomationId, SectionSheetShortcutCommand]
    >
  ).find(([, candidate]) => candidate === command)?.[0];
  return {
    ...sheet,
    shortcuts: { ...sheet.shortcuts, [command]: shortcut },
    automations: action
      ? sheet.automations.map((automation) =>
          automation.action === action
            ? { ...automation, shortcut }
            : automation,
        )
      : sheet.automations,
    updatedAt: Date.now(),
  };
};

export const runSectionSheetAutomationsForTrigger = (
  elements: readonly BoardElement[],
  sheet: SectionSheet,
  trigger: SectionSheetAutomation["trigger"],
) =>
  getTriggeredSectionSheetAutomations(sheet, trigger)
    .reduce(
      (document, automation) =>
        runSectionSheetAutomation(
          document.elements,
          document.sheet,
          automation.action,
        ),
      { elements: [...elements], sheet },
    );

export const getTriggeredSectionSheetAutomations = (
  sheet: SectionSheet,
  trigger: SectionSheetAutomation["trigger"],
) => {
  const actions = new Set<SectionSheetAutomationId>();
  return sheet.automations.filter((automation) => {
    if (
      !automation.enabled ||
      automation.trigger !== trigger ||
      actions.has(automation.action)
    ) {
      return false;
    }
    actions.add(automation.action);
    return true;
  });
};
