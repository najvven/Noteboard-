import type { BoardElement, SectionSheet } from "../../types";
import {
  assertValidBoard,
  MAX_BOARD_FILE_BYTES,
  MAX_MEDIA_FILE_BYTES,
} from "../../../shared/board-data.js";
import { selectedBounds, type SelectionArea } from "./selection";
import { getTextScale, isScalableText } from "./text-scaling";

export const BOARD_CLIPBOARD_TYPE = "application/x-noteboard-document+json";
export interface BoardClipboard {
  format: "noteboard/clipboard";
  version: 1;
  elements: BoardElement[];
  sectionSheets: SectionSheet[];
}

export interface ClipboardContents {
  text: string;
  html: string;
  files: File[];
  diagnostics?: ClipboardDiagnostic[];
}

export interface ClipboardDiagnostic {
  name: string;
  code: string;
  message: string;
}

export class ClipboardLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClipboardLimitError";
  }
}

export interface ClipboardBudget {
  maxMediaFileBytes: number;
  maxTotalBytes: number;
}

const DEFAULT_CLIPBOARD_BUDGET: ClipboardBudget = {
  maxMediaFileBytes: MAX_MEDIA_FILE_BYTES,
  maxTotalBytes: MAX_BOARD_FILE_BYTES,
};

interface ClipboardReadableItem {
  types: readonly string[];
  getType(type: string): Promise<Blob>;
}

const isClipboardMediaType = (type: string) => /^(image|audio|video)\//i.test(type);

export async function readBrowserClipboardItems(
  items: readonly ClipboardReadableItem[],
  budget: ClipboardBudget = DEFAULT_CLIPBOARD_BUDGET,
): Promise<ClipboardContents> {
  const result: ClipboardContents = { text: "", html: "", files: [] };
  const supportedBlobs: Array<{ type: string; normalizedType: string; blob: Blob }> = [];
  let totalBytes = 0;
  for (const item of items) for (const type of item.types) {
    const normalizedType = type.toLowerCase();
    if (normalizedType !== "text/plain" && normalizedType !== "text/html" &&
        !isClipboardMediaType(type)) continue;
    const blob = await item.getType(type);
    if (isClipboardMediaType(type) && blob.size > budget.maxMediaFileBytes) {
      throw new ClipboardLimitError("Clipboard media file exceeds the size limit.");
    }
    if (totalBytes + blob.size > budget.maxTotalBytes) {
      throw new ClipboardLimitError("Clipboard contents exceed the total size limit.");
    }
    totalBytes += blob.size;
    supportedBlobs.push({ type, normalizedType, blob });
  }
  // Inspect every supported Blob's declared size before decoding text or
  // constructing any File, so a late oversized item cannot follow a large
  // earlier conversion.
  for (const { type, normalizedType, blob } of supportedBlobs) {
    if (normalizedType === "text/plain") result.text = await blob.text();
    else if (normalizedType === "text/html") result.html = await blob.text();
    else result.files.push(new File([blob], "clipboard", { type }));
  }
  return result;
}

export function decodeNativeClipboardMedia(
  encoded: string,
  name: string,
  type: string,
  totalBytes = 0,
  budget: ClipboardBudget = DEFAULT_CLIPBOARD_BUDGET,
) {
  if (!isClipboardMediaType(type)) throw new Error("Unsupported clipboard media type.");
  const remainingBytes = Math.min(budget.maxMediaFileBytes, budget.maxTotalBytes - totalBytes);
  if (remainingBytes < 0 || encoded.length > 4 * Math.ceil(remainingBytes / 3)) {
    throw new ClipboardLimitError("Clipboard media exceeds the size limit.");
  }
  const binary = atob(encoded);
  if (binary.length > remainingBytes) throw new ClipboardLimitError("Clipboard media exceeds the size limit.");
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return { file: new File([bytes], name, { type }), totalBytes: totalBytes + bytes.byteLength };
}

export function getNativeClipboardTextBytes(
  text: string,
  html: string,
  budget: ClipboardBudget = DEFAULT_CLIPBOARD_BUDGET,
) {
  const encoder = new TextEncoder();
  const totalBytes = encoder.encode(text).byteLength + encoder.encode(html).byteLength;
  if (totalBytes > budget.maxTotalBytes) {
    throw new ClipboardLimitError("Clipboard contents exceed the total size limit.");
  }
  return totalBytes;
}

export type ClipboardRegion = SelectionArea;

export function boardClipboardFormats(elements: BoardElement[], sectionSheets: SectionSheet[]) {
  const payload: BoardClipboard = { format: "noteboard/clipboard", version: 1, elements, sectionSheets };
  const json = JSON.stringify(payload);
  if (new TextEncoder().encode(json).byteLength > MAX_BOARD_FILE_BYTES) throw new Error("Copied objects are too large.");
  return {
    json,
    html: `<span data-noteboard-clipboard="${encodeURIComponent(json)}">Noteboard objects</span>`,
    text: elements.map(element => element.name || element.type).join(", "),
  };
}

export function writeBoardClipboard(
  data: DataTransfer,
  elements: BoardElement[],
  sectionSheets: SectionSheet[],
) {
  let formats: ReturnType<typeof boardClipboardFormats>;
  try { formats = boardClipboardFormats(elements, sectionSheets); } catch { return false; }
  const {json, html, text} = formats;
  data.setData(BOARD_CLIPBOARD_TYPE, json);
  // HTML is a portable fallback for platforms that discard custom MIME types.
  data.setData(
    "text/html",
    html,
  );
  data.setData(
    "text/plain",
    text,
  );
  return true;
}

/** Buttons use the same system clipboard as Ctrl+V, with no internal fallback. */
export async function readCurrentClipboard(): Promise<ClipboardContents> {
  if (window.noteboardAPI?.readClipboard) {
    const value = await window.noteboardAPI.readClipboard();
    const files: File[] = [];
    const diagnostics: ClipboardDiagnostic[] = [...(value.fileErrors ?? [])];
    let totalBytes = getNativeClipboardTextBytes(value.text, value.html);
    for (const file of value.files) {
      if (!isClipboardMediaType(file.type)) {
        diagnostics.push({ name: file.name, code: 'UNSUPPORTED_MEDIA_TYPE', message: 'This clipboard item is not a supported image, audio, or video file.' });
        continue;
      }
      try {
        const decoded = decodeNativeClipboardMedia(file.base64, file.name, file.type, totalBytes);
        files.push(decoded.file);
        totalBytes = decoded.totalBytes;
      } catch (error) {
        diagnostics.push({
          name: file.name,
          code: error instanceof ClipboardLimitError ? 'CLIPBOARD_SIZE_LIMIT' : 'CLIPBOARD_DECODE_FAILED',
          message: error instanceof Error ? error.message : 'This clipboard file could not be decoded.',
        });
      }
    }
    if (value.image && !files.length) {
      const separator = value.image.indexOf(",");
      const encoded = separator >= 0 ? value.image.slice(separator + 1) : value.image;
      try {
        files.push(decodeNativeClipboardMedia(encoded, "clipboard.png", "image/png", totalBytes).file);
      } catch (error) {
        diagnostics.push({
          name: 'Clipboard image',
          code: error instanceof ClipboardLimitError ? 'CLIPBOARD_SIZE_LIMIT' : 'CLIPBOARD_DECODE_FAILED',
          message: error instanceof Error ? error.message : 'The clipboard image could not be decoded.',
        });
      }
    }
    return {text:value.text,html:value.html,files,...(diagnostics.length ? { diagnostics } : {})};
  }
  const items = await navigator.clipboard.read();
  return readBrowserClipboardItems(items);
}

export async function copyBoardToSystem(elements: BoardElement[], sheets: SectionSheet[]) {
  const formats = boardClipboardFormats(elements, sheets);
  if (window.noteboardAPI?.writeBoardClipboard) {
    if (!await window.noteboardAPI.writeBoardClipboard(formats.json)) throw new Error("Could not copy objects.");
  } else {
    await navigator.clipboard.write([new ClipboardItem({
      "text/plain":new Blob([formats.text],{type:"text/plain"}),
      "text/html":new Blob([formats.html],{type:"text/html"}),
    })]);
  }
}

/** Fit the complete editable group into the chosen region, preserving its layout. */
export function placeClipboardElements(elements: BoardElement[], region?: ClipboardRegion) {
  if (!region) return elements.map(element => ({...element,position:{x:element.position.x+20,y:element.position.y+20}}));
  const bounds = selectedBounds(elements, elements.filter(element => element.type !== "layer" && !element.isEraser).map(element => element.id));
  if (!bounds) return elements;
  const scale = Math.min(region.w / Math.max(1,bounds.width), region.h / Math.max(1,bounds.height));
  const origin = {x:region.x+(region.w-bounds.width*scale)/2,y:region.y+(region.h-bounds.height*scale)/2};
  return elements.map(element => ({
    ...element,
    position:{x:origin.x+(element.position.x-bounds.x)*scale,y:origin.y+(element.position.y-bounds.y)*scale},
    size:element.size ? {width:element.size.width*scale,height:element.size.height*scale} : undefined,
    points:element.points?.map(point=>({x:point.x*scale,y:point.y*scale})),
    borderWidth:element.borderWidth === undefined ? undefined : element.borderWidth*scale,
    ...(isScalableText(element.type) ? {textScale:getTextScale(element)*scale} : {}),
  }));
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
