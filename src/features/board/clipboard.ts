import type { BoardElement, SectionSheet } from "../../types";
import {
  assertValidBoard,
  MAX_BOARD_FILE_BYTES,
} from "../../../shared/board-data.js";
import { selectedBounds } from "./selection";
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
}

export interface ClipboardRegion { x: number; y: number; w: number; h: number }

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
    const files = value.files.map(file => new File([Uint8Array.from(atob(file.base64), char => char.charCodeAt(0))], file.name, {type: file.type}));
    if (value.image && !files.length) files.push(new File([Uint8Array.from(atob(value.image.slice(value.image.indexOf(',')+1)), char=>char.charCodeAt(0))], "clipboard.png", {type:"image/png"}));
    return {text:value.text,html:value.html,files};
  }
  const items = await navigator.clipboard.read();
  const result: ClipboardContents = {text:"",html:"",files:[]};
  for (const item of items) for (const type of item.types) {
    const blob = await item.getType(type);
    if (type === "text/plain") result.text = await blob.text();
    else if (type === "text/html") result.html = await blob.text();
    else if (/^(image|audio|video)\//.test(type)) result.files.push(new File([blob],"clipboard",{type}));
  }
  return result;
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
