import { createUniver, LocaleType, mergeLocales } from "@univerjs/presets";
import { UniverSheetsCoreWorkerPreset } from "@univerjs/preset-sheets-core/worker";
import { UniverSheetsFilterWorkerPreset } from "@univerjs/preset-sheets-filter/worker";
import coreEn from "@univerjs/preset-sheets-core/locales/en-US";
import filterEn from "@univerjs/preset-sheets-filter/locales/en-US";

createUniver({
  locale: LocaleType.EN_US,
  locales: { [LocaleType.EN_US]: mergeLocales(coreEn, filterEn) },
  presets: [UniverSheetsCoreWorkerPreset(), UniverSheetsFilterWorkerPreset()],
});
