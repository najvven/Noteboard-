import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import HomeScreen from "../src/components/HomeScreen.tsx";

test("the New Noteboard action uses a simple plus icon", () => {
  const markup = renderToStaticMarkup(
    <HomeScreen
      pages={[]}
      onOpenPage={() => undefined}
      onCreateNewPage={() => undefined}
      onDeletePage={() => undefined}
      onRenamePage={() => undefined}
      onTogglePin={() => undefined}
      onMovePage={() => undefined}
      onImportPage={() => undefined}
      onRefreshPages={() => Promise.resolve()}
      globalBrightness={100}
      setGlobalBrightness={() => undefined}
    />,
  );

  const newNoteboardButton = markup.match(
    /<button\b[^>]*>(?:(?!<\/button>)[\s\S])*?<span>New Noteboard<\/span>(?:(?!<\/button>)[\s\S])*?<\/button>/,
  )?.[0];

  assert.ok(newNoteboardButton);
  assert.match(newNoteboardButton, /lucide-plus/);
  assert.doesNotMatch(newNoteboardButton, /lucide-files/);
});

test("the Main Menu exposes Brightness inside Settings > Visual", () => {
  const markup = renderToStaticMarkup(
    <HomeScreen
      pages={[]}
      onOpenPage={() => undefined}
      onCreateNewPage={() => undefined}
      onDeletePage={() => undefined}
      onRenamePage={() => undefined}
      onTogglePin={() => undefined}
      onMovePage={() => undefined}
      onImportPage={() => undefined}
      onRefreshPages={() => Promise.resolve()}
      globalBrightness={100}
      setGlobalBrightness={() => undefined}
    />,
  );

  assert.match(markup, /aria-haspopup="dialog"/);
  assert.match(markup, /aria-controls="main-settings-dialog"/);
  assert.match(markup, /data-main-settings-button="true"[^>]*class="[^"]*h-full w-full/);
  assert.match(markup, /class="relative h-\[40px\] w-\[250px\] shrink-0"/);
  assert.match(markup, />Settings<\/span>/);
  assert.doesNotMatch(markup, /uppercase tracking-wider select-none shrink-0">Brightness/);
  assert.match(markup, /id="main-settings-dialog"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(markup, /data-settings-dialog="true"/);
  assert.match(markup, /fixed inset-0 z-50 flex items-center justify-center/);
  assert.match(markup, /h-\[min\(680px,90vh\)\][^\"]*max-w-5xl/);
  assert.doesNotMatch(markup, /absolute right-0 top-\[calc\(100%\+8px\)\]/);
  assert.match(markup, /aria-label="Close settings dialog"/);
  assert.match(markup, /aria-label="Settings categories"/);
  assert.match(markup, />Visual<\/span>/);
  assert.equal((markup.match(/lucide-settings-2/g) ?? []).length, 1);
  assert.doesNotMatch(markup, /lucide-settings-2[^<]*<\/svg>[^\n]*Categories/);
  assert.match(markup, /id="global-brightness"/);
});
