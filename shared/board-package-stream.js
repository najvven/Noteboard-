import { assertFileSize } from "./board-data.js";

const SAFE_ASSET_PATH = /^assets\/[a-zA-Z0-9._/-]+$/;

export function assertSafeAssetPath(path) {
  if (
    !SAFE_ASSET_PATH.test(path) ||
    path.includes("\\") ||
    path.split("/").some((part) => part === ".." || part === "")
  ) {
    throw new Error("Board package asset path is invalid.");
  }
}

export function createZipEntryByteStream(entry) {
  if (!entry || typeof entry.internalStream !== "function") {
    throw new Error(
      "This JSZip version does not support bounded streaming imports.",
    );
  }
  const stream = entry.internalStream("uint8array");
  if (
    !stream ||
    typeof stream.on !== "function" ||
    typeof stream.pause !== "function" ||
    typeof stream.resume !== "function"
  ) {
    throw new Error("JSZip returned an invalid bounded import stream.");
  }
  return stream;
}

/** Count actual inflated ZIP bytes without retaining the inflated chunks. */
export async function assertZipExpansionWithinLimits(
  entries,
  { maxEntryBytes, maxArchiveBytes, archiveLabel = "Expanded archive" },
) {
  let archiveBytes = 0;
  for (const entry of entries) {
    if (entry.dir) continue;
    const stream = createZipEntryByteStream(entry);
    await new Promise((resolve, reject) => {
      let entryBytes = 0;
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        stream.pause();
        reject(error);
      };
      stream
        .on("data", (chunk) => {
          if (settled) return;
          try {
            entryBytes += chunk.byteLength;
            archiveBytes += chunk.byteLength;
            assertFileSize(entryBytes, maxEntryBytes, "ZIP entry");
            assertFileSize(archiveBytes, maxArchiveBytes, archiveLabel);
          } catch (error) {
            fail(error);
          }
        })
        .on("error", fail)
        .on("end", () => {
          if (settled) return;
          settled = true;
          resolve();
        })
        .resume();
    });
  }
  return archiveBytes;
}

export function assertCanonicalBase64(value, label = "Asset") {
  if (typeof value !== "string" || value.length % 4 !== 0) {
    throw new Error(`${label} contains invalid base64 data.`);
  }
  const padding = value.endsWith("==") ? 2 : value.endsWith("=") ? 1 : 0;
  const payloadLength = value.length - padding;
  if ((padding === 2 && payloadLength % 4 !== 2) || (padding === 1 && payloadLength % 4 !== 3))
    throw new Error(`${label} contains invalid base64 padding.`);
  for (let index = 0; index < payloadLength; index += 1) {
    if (base64Sextet(value.charCodeAt(index)) < 0)
      throw new Error(`${label} contains invalid base64 data.`);
  }
  for (let index = payloadLength; index < value.length; index += 1) {
    if (value.charCodeAt(index) !== 61)
      throw new Error(`${label} contains invalid base64 padding.`);
  }
  if (padding === 2 && (base64Sextet(value.charCodeAt(payloadLength - 1)) & 15)) {
    throw new Error(`${label} contains invalid base64 padding.`);
  }
  if (padding === 1 && (base64Sextet(value.charCodeAt(payloadLength - 1)) & 3)) {
    throw new Error(`${label} contains invalid base64 padding.`);
  }
  return (value.length / 4) * 3 - padding;
}

function base64Sextet(code) {
  if (code >= 65 && code <= 90) return code - 65;
  if (code >= 97 && code <= 122) return code - 97 + 26;
  if (code >= 48 && code <= 57) return code - 48 + 52;
  if (code === 43) return 62;
  if (code === 47) return 63;
  return -1;
}

export function readZipEntryBytes(
  entry,
  entryLimit,
  entryLabel,
  archiveBudget,
  assertActive = () => {},
  onProgress,
) {
  const stream = createZipEntryByteStream(entry);
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      stream.pause();
      reject(error);
    };

    stream
      .on("data", (chunk, metadata) => {
        if (settled) return;
        try {
          assertActive();
          const bytes = chunk;
          assertFileSize(total + bytes.byteLength, entryLimit, entryLabel);
          assertFileSize(
            archiveBudget.used + bytes.byteLength,
            archiveBudget.limit,
            "Expanded board package",
          );
          total += bytes.byteLength;
          archiveBudget.used += bytes.byteLength;
          chunks.push(bytes);
          onProgress?.(Number(metadata?.percent ?? 0));
        } catch (error) {
          fail(error);
        }
      })
      .on("error", fail)
      .on("end", () => {
        if (settled) return;
        settled = true;
        const output = new Uint8Array(total);
        let offset = 0;
        chunks.forEach((chunk) => {
          output.set(chunk, offset);
          offset += chunk.byteLength;
        });
        resolve(output);
      })
      .resume();
  });
}

export function bytesToBase64(bytes) {
  if (globalThis.Buffer) return globalThis.Buffer.from(bytes).toString("base64");
  const encoded = [];
  const chunkSize = 24_576;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize));
    encoded.push(btoa(String.fromCharCode(...chunk)));
  }
  return encoded.join("");
}

export function mimeFromAssetPath(
  path,
  fallback = "application/octet-stream",
) {
  const ext = path.split(".").pop()?.toLowerCase() || "";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "png") return "image/png";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "svg") return "image/svg+xml";
  if (ext === "mp4") return "video/mp4";
  if (ext === "webm") return "video/webm";
  if (ext === "ogg") return "video/ogg";
  if (ext === "mp3") return "audio/mpeg";
  if (ext === "wav") return "audio/wav";
  if (ext === "m4a") return "audio/mp4";
  return fallback;
}

export function restoredAssetMime(path, fallback) {
  const candidate = mimeFromAssetPath(path, fallback).split(";", 1)[0].trim();
  return /^[\w!#$&^_.+-]+\/[\w!#$&^_.+-]+$/i.test(candidate)
    ? candidate
    : "application/octet-stream";
}

/** Preflight the JSON size produced by restoring one or more shared ZIP assets. */
export function estimateRestoredBoardJsonBytes(data, assetInfoByPath, limit) {
  const sourceElements = Array.isArray(data) ? data : data?.elements;
  if (!Array.isArray(sourceElements)) throw new Error("Board elements are invalid.");
  const elements = sourceElements.map((element) => {
    const info = assetInfoByPath.get(element?.content);
    if (!info || element?.type !== "media") return element;
    return { ...element, mediaMime: info.mime };
  });
  const baseDocument = Array.isArray(data) ? elements : { ...data, elements };
  const baseJson = JSON.stringify(baseDocument);
  let bytes = new TextEncoder().encode(baseJson).byteLength;
  for (const element of sourceElements) {
    const path = element?.content;
    const info = assetInfoByPath.get(path);
    if (!info) continue;
    const prefix = `data:${info.mime};base64,`;
    const encodedContentLength = new TextEncoder().encode(JSON.stringify(prefix)).byteLength + Math.ceil(info.byteLength / 3) * 4;
    bytes += encodedContentLength - JSON.stringify(path).length;
    assertFileSize(bytes, limit, "Restored board JSON");
  }
  assertFileSize(bytes, limit, "Restored board JSON");
  return bytes;
}
