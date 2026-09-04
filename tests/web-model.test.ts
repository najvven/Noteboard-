import assert from "node:assert/strict";
import test from "node:test";

import { normalizeWebUrl } from "../src/features/web/model.ts";

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
