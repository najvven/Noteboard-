import assert from "node:assert/strict";
import test from "node:test";

import type { BoardElement } from "../src/types";
import { mergeLiveWebviewUrls, readLiveWebviewUrl } from "../src/features/web/webview-state";

test("save-time webview synchronization returns an immutable copy", () => {
  const elements: BoardElement[] = [
    {
      id: "web-1",
      type: "embed",
      position: { x: 0, y: 0 },
      content: "https://example.com/old",
      zIndex: 1,
    },
  ];
  const snapshot = structuredClone(elements);

  const merged = mergeLiveWebviewUrls(
    elements,
    new Map([["web-1", "https://example.com/new"]]),
  );

  assert.deepEqual(elements, snapshot);
  assert.notEqual(merged, elements);
  assert.equal(merged[0].content, "https://example.com/new");
});

test('saving a webview before dom-ready safely retains the requested URL', () => {
  const view = { src:'https://youtube.com/watch?v=M7lc1UVf-VE', getURL: () => { throw new Error('WebView is not ready'); } };
  assert.equal(readLiveWebviewUrl(view),view.src);
  assert.equal(readLiveWebviewUrl({...view,getURL:()=> 'https://example.com/next'}),'https://example.com/next');
});

test('saving during native device bootstrap keeps the requested address, not about:blank', () => {
  const view = {src:'about:blank',getURL:()=> 'about:blank',getAttribute:(key:string)=>key === 'data-web-requested-url' ? 'https://example.com/page' : null};
  assert.equal(readLiveWebviewUrl(view),'https://example.com/page');
  assert.equal(readLiveWebviewUrl({...view,getURL:()=> 'https://example.com/next'}),'https://example.com/next');
});

test('save prefers a pending navigation over the previously committed page', () => {
  const view = {
    getURL: () => 'https://example.com/first',
    getAttribute: (key: string) => key === 'data-web-requested-url'
      ? 'https://example.com/slow-next'
      : key === 'data-web-navigation-pending' ? 'true' : null,
  };
  assert.equal(readLiveWebviewUrl(view), 'https://example.com/slow-next');
});

test('save retains the committed redirect after navigation finishes', () => {
  const view = {
    getURL: () => 'https://example.com/final',
    getAttribute: (key: string) => key === 'data-web-requested-url'
      ? 'https://example.com/final'
      : null,
  };
  assert.equal(readLiveWebviewUrl(view), 'https://example.com/final');
});
