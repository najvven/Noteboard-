import assert from "node:assert/strict";
import test from "node:test";

import { sanitizeRichText } from "../src/lib/sanitize-rich-text.ts";

test("rich text falls back to escaped text when DOM sanitization is unavailable", () => {
  assert.equal(
    sanitizeRichText('<script>alert("x")</script><b>safe</b>'),
    "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&lt;b&gt;safe&lt;/b&gt;",
  );
});
