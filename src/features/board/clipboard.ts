import type { BoardElement, SectionSheet } from "../../types";
import {
  assertValidBoard,
  MAX_BOARD_FILE_BYTES,
} from "../../../shared/board-data.js";

export const BOARD_CLIPBOARD_TYPE = "application/x-noteboard-document+json";
export interface BoardClipboard {
  format: "noteboard/clipboard";
  version: 1;
  elements: BoardElement[];
  sectionSheets: SectionSheet[];
}

export function writeBoardClipboard(
  data: DataTransfer,
  elements: BoardElement[],
  sectionSheets: SectionSheet[],
) {
  const payload: BoardClipboard = {
    format: "noteboard/clipboard",
    version: 1,
    elements,
    sectionSheets,
  };
  const json = JSON.stringify(payload);
  if (new TextEncoder().encode(json).byteLength > MAX_BOARD_FILE_BYTES)
    return false;
  data.setData(BOARD_CLIPBOARD_TYPE, json);
  // HTML is a portable fallback for platforms that discard custom MIME types.
  data.setData(
    "text/html",
    `<span data-noteboard-clipboard="${encodeURIComponent(json)}">Noteboard objects</span>`,
  );
  data.setData(
    "text/plain",
    elements.map((element) => element.name || element.type).join(", "),
  );
  return true;
}

export function readBoardClipboard(
  data: Pick<DataTransfer, "getData">,
): BoardClipboard | null {
  try {
    let json = data.getData(BOARD_CLIPBOARD_TYPE);
    if (!json) {
      const encoded = /\bdata-noteboard-clipboard="([^"]+)"/.exec(
        data.getData("text/html"),
      )?.[1];
      if (!encoded || encoded.length > MAX_BOARD_FILE_BYTES * 3) return null;
      json = decodeURIComponent(encoded);
    }
    if (json.length > MAX_BOARD_FILE_BYTES) return null;
    const value = JSON.parse(json) as BoardClipboard;
    if (
      value.format !== "noteboard/clipboard" ||
      value.version !== 1 ||
      !Array.isArray(value.elements) ||
      !Array.isArray(value.sectionSheets)
    )
      return null;
    assertValidBoard({
      id: "clipboard",
      title: "Clipboard",
      elements: value.elements,
      sectionSheets: value.sectionSheets,
    });
    return value;
  } catch {
    return null;
  }
}

export function isClipboardTextTarget(target: EventTarget | null) {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable ||
      Boolean(target.closest('input,textarea,[contenteditable="true"]')))
  );
}
