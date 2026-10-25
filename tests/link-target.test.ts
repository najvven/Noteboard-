import assert from "node:assert/strict";
import test from "node:test";

import { validateBoardLinkTargetDraft } from "../src/features/board/link-target";

test("link drafts accept existing targets and complete http URLs", () => {
  const ids = new Set(["element-a"]);
  assert.deepEqual(validateBoardLinkTargetDraft(" element-a ", ids), {
    value: "element-a",
  });
  assert.deepEqual(validateBoardLinkTargetDraft("https://example.com/path", ids), {
    value: "https://example.com/path",
  });
  assert.deepEqual(validateBoardLinkTargetDraft("", ids), { value: undefined });
});

test("link drafts reject partial URLs, privileged schemes and missing ids", () => {
  const ids = new Set(["element-a"]);
  for (const value of ["https://exa", "javascript:alert(1)", "missing-id"]) {
    assert.match(validateBoardLinkTargetDraft(value, ids).error ?? "", /complete|existing/i);
  }
});
