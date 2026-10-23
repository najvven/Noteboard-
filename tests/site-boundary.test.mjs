import assert from "node:assert/strict";
import test from "node:test";

import { isThirdPartySite } from "../shared/site-boundary.js";

test("third-party site checks use registrable domains from the public suffix list", () => {
  assert.equal(
    isThirdPartySite("https://cdn.victim.co.jp/a", "https://www.victim.co.jp"),
    false,
  );
  assert.equal(
    isThirdPartySite("https://tracker.co.jp/a", "https://victim.co.jp"),
    true,
  );
  assert.equal(
    isThirdPartySite("https://alice.github.io/a", "https://bob.github.io"),
    true,
  );
  assert.equal(isThirdPartySite("not a url", "https://example.com"), false);
});
