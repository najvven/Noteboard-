import { importSpreadsheet, exportSpreadsheet } from "./exchange";
self.onmessage = async ({ data }) => {
  try {
    const result =
      data.action === "import"
        ? await importSpreadsheet(data.bytes, data.name)
        : await exportSpreadsheet(data.document, data.format);
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({
      error:
        error instanceof Error
          ? error.message
          : "Could not process the spreadsheet file.",
    });
  }
};
