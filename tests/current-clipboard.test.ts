import assert from "node:assert/strict";
import test from "node:test";

import {
  ClipboardLimitError,
  decodeNativeClipboardMedia,
  getNativeClipboardTextBytes,
  readBrowserClipboardItems,
} from "../src/features/board/clipboard";
import { MAX_BOARD_FILE_BYTES, MAX_MEDIA_FILE_BYTES } from "../shared/board-data.js";

const fakeBlob = (reportedSize: number, content = "x") => {
  const blob = new Blob([content]) as Blob & { text: () => Promise<string>; arrayBuffer: () => Promise<ArrayBuffer> };
  Object.defineProperty(blob, "size", { value: reportedSize });
  let textCalls = 0;
  let arrayBufferCalls = 0;
  blob.text = async () => { textCalls += 1; return content; };
  blob.arrayBuffer = async () => { arrayBufferCalls += 1; return new ArrayBuffer(0); };
  return { blob, calls: () => ({ textCalls, arrayBufferCalls }) };
};

test("browser clipboard rejects an oversized media Blob before reading or wrapping it", async () => {
  const media = fakeBlob(MAX_MEDIA_FILE_BYTES + 1);
  const item = { types: ["image/png"], getType: async () => media.blob };
  await assert.rejects(readBrowserClipboardItems([item]), ClipboardLimitError);
  assert.deepEqual(media.calls(), { textCalls: 0, arrayBufferCalls: 0 });
});

test("browser clipboard enforces aggregate media bytes and skips unsupported MIME types before getType", async () => {
  const first = fakeBlob(4);
  const second = fakeBlob(4);
  const third = fakeBlob(3);
  const requested: string[] = [];
  const item = {
    types: ["application/pdf", "image/png", "audio/wav", "video/mp4"],
    getType: async (type: string) => {
      requested.push(type);
      return ({
        "image/png": first.blob,
        "audio/wav": second.blob,
        "video/mp4": third.blob,
      } as Record<string, Blob>)[type];
    },
  };
  await assert.rejects(
    readBrowserClipboardItems([item], { maxMediaFileBytes: 5, maxTotalBytes: 10 }),
    ClipboardLimitError,
  );
  assert.deepEqual(requested, ["image/png", "audio/wav", "video/mp4"]);
  assert.deepEqual(first.calls(), { textCalls: 0, arrayBufferCalls: 0 });
  assert.deepEqual(second.calls(), { textCalls: 0, arrayBufferCalls: 0 });
  assert.deepEqual(third.calls(), { textCalls: 0, arrayBufferCalls: 0 });
});

test("browser clipboard rejects oversized text before calling Blob.text", async () => {
  const text = fakeBlob(MAX_BOARD_FILE_BYTES + 1, "oversized");
  const item = { types: ["text/plain"], getType: async () => text.blob };
  await assert.rejects(readBrowserClipboardItems([item]), ClipboardLimitError);
  assert.deepEqual(text.calls(), { textCalls: 0, arrayBufferCalls: 0 });
});

test("browser clipboard validates combined text and media size before any conversion", async () => {
  const text = fakeBlob(6, "text");
  const media = fakeBlob(5, "image");
  const item = {
    types: ["text/plain", "image/png"],
    getType: async (type: string) => type === "text/plain" ? text.blob : media.blob,
  };
  await assert.rejects(
    readBrowserClipboardItems([item], { maxMediaFileBytes: 5, maxTotalBytes: 10 }),
    ClipboardLimitError,
  );
  assert.deepEqual(text.calls(), { textCalls: 0, arrayBufferCalls: 0 });
  assert.deepEqual(media.calls(), { textCalls: 0, arrayBufferCalls: 0 });
});

test("browser clipboard preserves text, HTML, and supported media contents", async () => {
  const requested: string[] = [];
  const item = {
    types: ["application/pdf", "text/plain", "text/html", "image/png"],
    getType: async (type: string) => {
      requested.push(type);
      if (type === "application/pdf") throw new Error("unsupported MIME requested");
      return new Blob([type === "text/plain" ? "plain" : type === "text/html" ? "<b>html</b>" : "png"]);
    },
  };
  const result = await readBrowserClipboardItems([item]);
  assert.deepEqual(requested, ["text/plain", "text/html", "image/png"]);
  assert.equal(result.text, "plain");
  assert.equal(result.html, "<b>html</b>");
  assert.equal(result.files.length, 1);
  assert.equal(result.files[0].type, "image/png");
  assert.equal(await result.files[0].text(), "png");
});

test("native base64 decoding checks encoded size and aggregate budget before atob", () => {
  const previousAtob = Object.getOwnPropertyDescriptor(globalThis, "atob");
  let calls = 0;
  Object.defineProperty(globalThis, "atob", {
    configurable: true,
    value: (_value: string) => { calls += 1; return "123456"; },
  });
  try {
    assert.throws(() => decodeNativeClipboardMedia("AAAAAAAAAA==", "x.png", "image/png", 0, {
      maxMediaFileBytes: 4,
      maxTotalBytes: 10,
    }), ClipboardLimitError);
    assert.equal(calls, 0);
    assert.throws(() => decodeNativeClipboardMedia("AAAAAA==", "x.png", "image/png", 9, {
      maxMediaFileBytes: 4,
      maxTotalBytes: 10,
    }), ClipboardLimitError);
    assert.equal(calls, 0);
  } finally {
    if (previousAtob) Object.defineProperty(globalThis, "atob", previousAtob);
    else Reflect.deleteProperty(globalThis, "atob");
  }
});

test("native text and HTML count toward the aggregate budget before media decoding", () => {
  assert.throws(() => getNativeClipboardTextBytes("plain", "<b>html</b>", {
    maxMediaFileBytes: 4,
    maxTotalBytes: 10,
  }), ClipboardLimitError);
  assert.equal(getNativeClipboardTextBytes("plain", "<b>html</b>", {
    maxMediaFileBytes: 4,
    maxTotalBytes: 32,
  }), new TextEncoder().encode("plain").byteLength + new TextEncoder().encode("<b>html</b>").byteLength);
});
