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
