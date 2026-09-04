import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import BoardEditor from "../src/components/BoardEditor.tsx";
import type { BoardElement, Page } from "../src/types.ts";

const renderWebBoard = (popupBlocker: boolean) => {
  const webElement: BoardElement = {
    id: `web-${popupBlocker}`,
    type: "embed",
    position: { x: 80, y: 80 },
    size: { width: 360, height: 220 },
    content: "https://example.com",
    mediaKind: "web",
    webPopupBlocker: popupBlocker,
    zIndex: 1,
  };
  const page: Page = {
    id: `web-board-${popupBlocker}`,
    title: "Web policy",
    width: 900,
    height: 650,
    updatedAt: 0,
    isPinned: false,
    elements: [webElement],
  };

  return renderToStaticMarkup(
    <BoardEditor
      page={page}
      onBack={() => undefined}
      onSave={() => undefined}
      onSavePreset={() => undefined}
    />,
  );
};

test("browser preview blocks iframe popups by default without showing desktop-only session clearing", () => {
  const markup = renderWebBoard(true);
  const iframe = markup.match(/<iframe[^>]+>/)?.[0];

  assert.ok(iframe);
  assert.match(iframe, /sandbox="[^"]*allow-forms/);
  assert.doesNotMatch(iframe, /allow-popups/);
  assert.doesNotMatch(markup, /Clear Web Session/);
});

test("browser preview grants popup sandbox permissions only after the blocker is disabled", () => {
  const markup = renderWebBoard(false);
  const iframe = markup.match(/<iframe[^>]+>/)?.[0];

  assert.ok(iframe);
  assert.match(iframe, /allow-popups/);
  assert.match(iframe, /allow-popups-to-escape-sandbox/);
});
