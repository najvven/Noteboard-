import assert from "node:assert/strict";
import test from "node:test";

import { internalRichTextTargetId, sanitizeRichText } from "../src/lib/sanitize-rich-text.ts";

test("rich text falls back to escaped text when DOM sanitization is unavailable", () => {
  assert.equal(
    sanitizeRichText('<script>alert("x")</script><b>safe</b>'),
    "&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;&lt;b&gt;safe&lt;/b&gt;",
  );
});

test("internal rich-text target prefix is case-insensitive while element IDs stay case-sensitive", () => {
  assert.equal(internalRichTextTargetId("#target-Item_A"), "Item_A");
  assert.equal(internalRichTextTargetId("#TARGET-Item_A"), "Item_A");
  assert.equal(internalRichTextTargetId("#TaRgEt-Item_A"), "Item_A");
  assert.equal(internalRichTextTargetId("#TARGET-"), null);
  assert.equal(internalRichTextTargetId("javascript:alert(1)"), null);
});
