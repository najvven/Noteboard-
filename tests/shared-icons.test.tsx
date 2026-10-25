import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { ClipboardPaste, Wrench } from "lucide-react";

import { BoardSettingsIcon } from "../src/components/icons/BoardSettingsIcon.tsx";
import { SettingsToolbarIcon } from "../src/components/icons/SettingsToolbarIcon.tsx";

test("the shared board settings icon combines a board and centered controls", () => {
  const markup = renderToStaticMarkup(
    <BoardSettingsIcon className="h-5 w-5" data-testid="board-settings-icon" />,
  );

  assert.match(markup, /data-testid="board-settings-icon"/);
  assert.match(markup, /aria-hidden="true"/);
  assert.match(markup, /data-icon-part="board"/);
  assert.match(markup, /data-icon-part="settings"/);
  assert.match(markup, /lucide-settings-2/);
  assert.equal((markup.match(/<svg/g) ?? []).length, 2);
});

test("toolbar settings icons reuse the board frame with a tool glyph", () => {
  const markup = renderToStaticMarkup(
    <SettingsToolbarIcon
      icon={Wrench}
      className="h-5 w-5"
      data-testid="global-tool-settings-icon"
    />,
  );

  assert.match(markup, /data-testid="global-tool-settings-icon"/);
  assert.match(markup, /data-icon-part="board"/);
  assert.match(markup, /data-icon-part="section"/);
  assert.match(markup, /lucide-wrench/);
});

test("toolbar settings icons preserve section-specific glyphs", () => {
  const markup = renderToStaticMarkup(
    <SettingsToolbarIcon
      icon={ClipboardPaste}
      className="h-5 w-5"
      data-testid="preset-toolbar-icon"
    />,
  );

  assert.match(markup, /data-testid="preset-toolbar-icon"/);
  assert.match(markup, /data-icon-part="board"/);
  assert.match(markup, /data-icon-part="section"/);
  assert.match(markup, /lucide-clipboard-paste/);
});
