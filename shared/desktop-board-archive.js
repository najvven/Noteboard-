import JSZip from "jszip";

import {
  assertFileSize,
  assertValidBoard,
  getArchiveDeclaredSize,
  getArchiveEntryDeclaredSize,
  MAX_ARCHIVE_ASSET_BYTES,
  MAX_ARCHIVE_UNCOMPRESSED_BYTES,
  MAX_BOARD_FILE_BYTES,
  MAX_BOARD_JSON_BYTES,
} from "./board-data.js";
import {
  assertSafeAssetPath,
  bytesToBase64,
  estimateRestoredBoardJsonBytes,
  restoredAssetMime,
  readZipEntryBytes,
} from "./board-package-stream.js";
import { repairLegacyBoard } from "./board-migration.js";
import { assertSafeZipDirectory } from "./zip-preflight.js";

const isPackagedAssetElement = (element) =>
  element.type === "image" || element.type === "media";

export const DEFAULT_DESKTOP_ARCHIVE_LIMITS = {
  boardFileBytes: MAX_BOARD_FILE_BYTES,
  expandedArchiveBytes: MAX_ARCHIVE_UNCOMPRESSED_BYTES,
  boardJsonBytes: MAX_BOARD_JSON_BYTES,
  assetBytes: MAX_ARCHIVE_ASSET_BYTES,
};

const inputByteLength = (input) =>
  typeof input === "string"
    ? new TextEncoder().encode(input).byteLength
    : input.byteLength ?? input.size;

const parseBoardJson = (bytes, fallbackId) => {
  let value;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error("Board JSON is invalid.");
    throw error;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Board JSON must contain a board object.");
  }
  const candidate = value.id || !fallbackId ? value : { ...value, id: fallbackId };
  const page = repairLegacyBoard(candidate);
  assertValidBoard(page);
  return page;
};

export async function loadDesktopBoardArchive(input, options = {}) {
  const limits = options.limits ?? DEFAULT_DESKTOP_ARCHIVE_LIMITS;
  assertFileSize(inputByteLength(input), limits.boardFileBytes, "Board package");
  assertSafeZipDirectory(input);
  const zip = await JSZip.loadAsync(input);
  assertFileSize(
    getArchiveDeclaredSize(zip.files),
    limits.expandedArchiveBytes,
    "Expanded board package",
  );
  const boardFile = zip.file("board.json");
  if (!boardFile) throw new Error("Invalid board package (missing board.json).");
  assertFileSize(
    getArchiveEntryDeclaredSize(boardFile),
    limits.boardJsonBytes,
    "board.json",
  );
  const archiveBudget = { used: 0, limit: limits.expandedArchiveBytes };
  const boardBytes = await readZipEntryBytes(
    boardFile,
    limits.boardJsonBytes,
    "board.json",
    archiveBudget,
  );
  const page = parseBoardJson(boardBytes, options.fallbackId);
  const referencedPaths = [
    ...new Set(
      page.elements
        .filter(isPackagedAssetElement)
        .map((element) => element.content)
        .filter(
          (content) =>
            typeof content === "string" && content.startsWith("assets/"),
        ),
    ),
  ];
  const sourceElementsByPath = new Map();
  for (const element of page.elements) {
    if (isPackagedAssetElement(element) && typeof element.content === "string" && element.content.startsWith("assets/"))
      sourceElementsByPath.set(element.content, element);
  }
  const assets = new Map();
  const assetInfoByPath = new Map();

  for (const assetPath of referencedPaths) {
    assertSafeAssetPath(assetPath);
    const entry = zip.file(assetPath);
    if (!entry) throw new Error(`Board package asset is missing: ${assetPath}`);
    assertFileSize(
      getArchiveEntryDeclaredSize(entry),
      limits.assetBytes,
      "Board asset",
    );
    const bytes = await readZipEntryBytes(
      entry,
      limits.assetBytes,
      "Board asset",
      archiveBudget,
    );
    const sourceElement = sourceElementsByPath.get(assetPath);
    const mime = restoredAssetMime(assetPath, sourceElement?.mediaMime || "application/octet-stream");
    assets.set(assetPath, bytes);
    assetInfoByPath.set(assetPath, { byteLength: bytes.byteLength, mime });
  }

  estimateRestoredBoardJsonBytes(page, assetInfoByPath, limits.boardJsonBytes);
  for (const [assetPath, bytes] of assets) assets.set(assetPath, bytesToBase64(bytes));

  const elements = page.elements.map((element) => {
    if (!isPackagedAssetElement(element)) return element;
    const assetPath = element.content;
    if (typeof assetPath !== "string" || !assetPath.startsWith("assets/")) {
      return element;
    }
    const encoded = assets.get(assetPath);
    if (encoded === undefined) {
      throw new Error(`Board package asset is missing: ${assetPath}`);
    }
    const mime = assetInfoByPath.get(assetPath)?.mime || restoredAssetMime(assetPath);
    return {
      ...element,
      content: `data:${mime};base64,${encoded}`,
      ...(element.type === "media" ? { mediaMime: mime } : {}),
    };
  });
  const restored = { ...page, elements };
  assertValidBoard(restored);
  return restored;
}
