import assert from "node:assert/strict";
import test from "node:test";

import { getBrowserWebSource, normalizeWebUrl } from "../src/features/web/model.ts";

test("web fields normalize network addresses and reject privileged schemes", () => {
  assert.equal(normalizeWebUrl("example.com/docs"), "https://example.com/docs");
  assert.equal(normalizeWebUrl(" https://openai.com/path "), "https://openai.com/path");
  assert.equal(normalizeWebUrl("about:blank"), "about:blank");
  assert.equal(normalizeWebUrl("file:///C:/secret.txt"), "");
  assert.equal(normalizeWebUrl("data:text/html,unsafe"), "");
  assert.equal(normalizeWebUrl("javascript:alert(1)"), "");
  assert.equal(normalizeWebUrl("https://user:pass@example.com"), "");
  assert.equal(normalizeWebUrl(""), "");
});

test('YouTube browser links use the supported player and retain start times', () => {
  for (const link of ['https://youtu.be/M7lc1UVf-VE?t=1m30s','https://www.youtube.com/watch?v=M7lc1UVf-VE&start=90','https://youtube.com/shorts/M7lc1UVf-VE?t=90']) {
    const source=getBrowserWebSource(link);
    assert.equal(source.url,'https://www.youtube-nocookie.com/embed/M7lc1UVf-VE?start=90');
    assert.equal(source.requiresDesktop,false);
  }
  assert.equal(getBrowserWebSource('https://youtube.com').requiresDesktop,true);
  assert.equal(getBrowserWebSource('https://youtube.com.evil.test/watch?v=M7lc1UVf-VE').youtube,false);
  assert.equal(getBrowserWebSource('javascript:alert(1)').url,'');
});
