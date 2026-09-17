import JSZip, { type JSZipObject } from "jszip";

import type { BoardElement, Page } from "../../types";
import {
  assertFileSize,
  assertValidBoard,
  getArchiveDeclaredSize,
  getArchiveEntryDeclaredSize,
  MAX_ARCHIVE_ASSET_BYTES,
  MAX_ARCHIVE_UNCOMPRESSED_BYTES,
  MAX_BOARD_FILE_BYTES,
  MAX_BOARD_JSON_BYTES,
} from "../../../shared/board-data.js";
import {
  assertSafeAssetPath,
  bytesToBase64,
  mimeFromAssetPath,
  readZipEntryBytes,
} from "../../../shared/board-package-stream.js";
import { repairLegacyBoard } from "../../../shared/board-migration.js";
import { assertSafeZipDirectory } from "../../../shared/zip-preflight.js";

export { mimeFromAssetPath } from "../../../shared/board-package-stream.js";

/** Shared portable export used by both the workspace and Save as File. */
export async function createBoardArchive(page: Page): Promise<Uint8Array> {
  assertValidBoard(page);
  const zip = new JSZip();
  const elements = page.elements.map(element => {
    if ((element.type !== 'image' && element.type !== 'media') || typeof element.content !== 'string') return element;
    const data = element.content.match(/^data:([^;]+);base64,(.+)$/);
    if (!data) return element;
    const assetPath = `assets/${element.id}.${extensionFromMime(data[1])}`;
    zip.file(assetPath, data[2], { base64: true });
    return { ...element, mediaMime: element.type === 'media' ? element.mediaMime || data[1] : element.mediaMime, content: assetPath };
  });
  zip.file('board.json', JSON.stringify({ ...page, version: page.version || 3, elements }, null, 2));
  return zip.generateAsync({ type: 'uint8array' });
}

export async function downloadBoardArchive(page: Page, name = page.title): Promise<void> {
  const bytes = await createBoardArchive(page);
  const copy = new Uint8Array(bytes.length);
  copy.set(bytes);
  const url = URL.createObjectURL(new Blob([copy.buffer], { type: 'application/zip' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `${(name || 'Untitled board').replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/\s+/g, '_').replace(/[. ]+$/, '') || 'noteboard'}_noteboard.zip`;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export interface BoardPackageLimits {
  boardFileBytes: number;
  expandedArchiveBytes: number;
  boardJsonBytes: number;
  assetBytes: number;
}

export const DEFAULT_BOARD_PACKAGE_LIMITS: BoardPackageLimits = {
  boardFileBytes: MAX_BOARD_FILE_BYTES,
  expandedArchiveBytes: MAX_ARCHIVE_UNCOMPRESSED_BYTES,
  boardJsonBytes: MAX_BOARD_JSON_BYTES,
  assetBytes: MAX_ARCHIVE_ASSET_BYTES,
};

export type BoardPackageStage = "opening" | "board" | "assets";

export interface BoardPackageProgress {
  stage: BoardPackageStage;
  percent: number;
}

export interface ReadBoardPackageOptions {
  createBoardId?: () => string;
  limits?: BoardPackageLimits;
  isCancelled?: () => boolean;
  onProgress?: (progress: BoardPackageProgress) => void;
}

export type BoardPackageData = Page | BoardElement[];

interface ExpandedArchiveBudget {
  used: number;
  limit: number;
}

export class BoardPackageCancelledError extends Error {
  constructor() {
    super("Board package import was cancelled.");
    this.name = "BoardPackageCancelledError";
  }
}

const assertNotCancelled = (options: ReadBoardPackageOptions) => {
  if (options.isCancelled?.()) throw new BoardPackageCancelledError();
};

const inputByteLength = (input: Blob | ArrayBuffer | Uint8Array | string) => {
  if (typeof input === "string") return new TextEncoder().encode(input).byteLength;
  if (input instanceof ArrayBuffer) return input.byteLength;
  if (ArrayBuffer.isView(input)) return input.byteLength;
  return input.size;
};

export const extensionFromMime = (mime: string) => {
  if (mime === "image/jpeg") return "jpg";
  if (mime === "image/svg+xml") return "svg";
  if (mime === "audio/mpeg") return "mp3";
  return mime.split("/")[1]?.replace(/[^a-z0-9]/gi, "") || "bin";
};

const withoutSpreadsheetIdentity = (element: BoardElement): BoardElement => ({
  ...element,
  sheetCell: undefined,
});

const prepareBoardPackageData = (
  value: unknown,
  options: ReadBoardPackageOptions,
): BoardPackageData => {
  if (Array.isArray(value)) {
    const rawElements = value.map((element) =>
      withoutSpreadsheetIdentity(element as BoardElement),
    );
    const repaired = repairLegacyBoard({
      id: "board-package-elements",
      title: "Imported elements",
      elements: rawElements,
    });
    assertValidBoard(repaired);
    const elements = repaired.elements as BoardElement[];
    return elements;
  }

  if (!value || typeof value !== "object") {
    throw new Error("Invalid board package format.");
  }
  const source = value as Partial<Page>;
  const candidate = repairLegacyBoard({
    ...source,
    version: source.version || 1,
    id: options.createBoardId?.() ?? source.id,
    elements: Array.isArray(source.elements) ? [...source.elements] : source.elements,
  });
  assertValidBoard(candidate);
  return candidate as Page;
};

const packageElements = (data: BoardPackageData) =>
  Array.isArray(data) ? data : data.elements;

const withElements = (
  data: BoardPackageData,
  elements: BoardElement[],
): BoardPackageData => (Array.isArray(data) ? elements : { ...data, elements });

const restorePackagedAssets = async (
  data: BoardPackageData,
  zip: JSZip,
  archiveBudget: ExpandedArchiveBudget,
  options: ReadBoardPackageOptions,
) => {
  const limits = options.limits ?? DEFAULT_BOARD_PACKAGE_LIMITS;
  const referencedPaths = [
    ...new Set(
      packageElements(data)
        .map((element) => element.content)
        .filter((content): content is string =>
          typeof content === "string" && content.startsWith("assets/"),
        ),
    ),
  ];
  const encodedAssets = new Map<string, string>();

  for (let index = 0; index < referencedPaths.length; index += 1) {
    assertNotCancelled(options);
    const path = referencedPaths[index];
    assertSafeAssetPath(path);
    const asset = zip.file(path);
    if (!asset) throw new Error(`Board package asset is missing: ${path}`);
    assertFileSize(
      getArchiveEntryDeclaredSize(asset),
      limits.assetBytes,
      "Board asset",
    );
    const bytes = await readZipEntryBytes(
      asset,
      limits.assetBytes,
      "Board asset",
      archiveBudget,
      () => assertNotCancelled(options),
      (percent) => {
      options.onProgress?.({
        stage: "assets",
        percent: referencedPaths.length
            ? ((index + percent / 100) / referencedPaths.length) * 100
          : 100,
      });
      },
    );
    encodedAssets.set(path, bytesToBase64(bytes));
  }

  const elements = packageElements(data).map((element) => {
    const path = element.content;
    if (typeof path !== "string" || !path.startsWith("assets/")) return element;
    const encoded = encodedAssets.get(path);
    if (encoded === undefined) throw new Error(`Board package asset is missing: ${path}`);
    const mime = element.mediaMime || mimeFromAssetPath(path);
    return {
      ...element,
      content: `data:${mime};base64,${encoded}`,
      ...(element.type === "media" && !element.mediaMime ? { mediaMime: mime } : {}),
    };
  });

  return withElements(data, elements);
};

const parseBoardJson = (text: string, options: ReadBoardPackageOptions) => {
  try {
    return prepareBoardPackageData(JSON.parse(text), options);
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("Board JSON is invalid.");
    throw error;
  }
};

const assertArchiveEntrySize = (
  entry: JSZipObject,
  limit: number,
  label: string,
) => assertFileSize(getArchiveEntryDeclaredSize(entry), limit, label);

export const readBoardArchive = async (
  input: Blob | ArrayBuffer | Uint8Array | string,
  options: ReadBoardPackageOptions = {},
): Promise<BoardPackageData> => {
  const limits = options.limits ?? DEFAULT_BOARD_PACKAGE_LIMITS;
  assertFileSize(inputByteLength(input), limits.boardFileBytes, "Board file");
  assertNotCancelled(options);
  options.onProgress?.({ stage: "opening", percent: 0 });
  const archiveInput =
    input instanceof Blob
      ? new Uint8Array(await input.arrayBuffer())
      : typeof input === "string"
        ? new TextEncoder().encode(input)
        : input;
  assertNotCancelled(options);
  assertSafeZipDirectory(archiveInput);
  const zip = await JSZip.loadAsync(archiveInput);
  assertFileSize(
    getArchiveDeclaredSize(zip.files),
    limits.expandedArchiveBytes,
    "Expanded board package",
  );
  const jsonFile = zip.file("board.json");
  if (!jsonFile) throw new Error("Invalid board package (missing board.json).");
  assertArchiveEntrySize(jsonFile, limits.boardJsonBytes, "board.json");
  const archiveBudget: ExpandedArchiveBudget = {
    used: 0,
    limit: limits.expandedArchiveBytes,
  };
  const jsonBytes = await readZipEntryBytes(
    jsonFile,
    limits.boardJsonBytes,
    "board.json",
    archiveBudget,
    () => assertNotCancelled(options),
    (percent) => options.onProgress?.({ stage: "board", percent }),
  );
  const jsonText = new TextDecoder().decode(jsonBytes);
  assertNotCancelled(options);
  const parsed = parseBoardJson(jsonText, options);
  const restored = await restorePackagedAssets(
    parsed,
    zip,
    archiveBudget,
    options,
  );
  assertNotCancelled(options);
  if (!Array.isArray(restored)) assertValidBoard(restored);
  return restored;
};

export const readBoardPackageFile = async (
  file: File,
  options: ReadBoardPackageOptions = {},
): Promise<BoardPackageData> => {
  const limits = options.limits ?? DEFAULT_BOARD_PACKAGE_LIMITS;
  assertFileSize(file.size, limits.boardFileBytes, "Board file");
  const lowerName = file.name.toLowerCase();
  if (lowerName.endsWith(".zip")) return readBoardArchive(file, options);
  if (!lowerName.endsWith(".json")) {
    throw new Error("Only Noteboard JSON and ZIP files can be imported here.");
  }
  assertNotCancelled(options);
  assertFileSize(file.size, limits.boardJsonBytes, "Board JSON");
  options.onProgress?.({ stage: "board", percent: 0 });
  const text = await file.text();
  assertNotCancelled(options);
  assertFileSize(
    new TextEncoder().encode(text).byteLength,
    limits.boardJsonBytes,
    "Board JSON",
  );
  options.onProgress?.({ stage: "board", percent: 100 });
  return parseBoardJson(text, options);
};

export const getBoardPackageElements = (data: BoardPackageData) => [
  ...packageElements(data),
];
