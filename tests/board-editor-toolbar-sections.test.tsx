import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import BoardEditor from "../src/components/BoardEditor.tsx";

test("general settings sections have no toolbar representation", () => {
  const markup = renderToStaticMarkup(
    <BoardEditor
      page={{
        id: "toolbar-sections",
        title: "Toolbar sections",
        width: 800,
        height: 600,
        updatedAt: 0,
        isPinned: false,
        elements: [],
      }}
      onBack={() => undefined}
      onSave={() => undefined}
      onSavePreset={() => undefined}
    />,
  );

  for (const id of [
    "grid",
    "toolDefaults",
    "presetSettings",
    "behaviorSettings",
    "shortcutSettings",
  ]) {
    assert.doesNotMatch(markup, new RegExp(`data-toolbar-item="${id}"`));
  }

  assert.match(markup, /data-toolbar-item="generalSettings"/);
  assert.match(markup, /title="General Settings"/);
  assert.match(markup, /grid-template-rows:34px/);
});
