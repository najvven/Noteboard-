import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import MenuSettingsBlock from "../src/components/MenuSettingsBlock.tsx";

test("tool settings render as a collapsed footer by default", () => {
  const markup = renderToStaticMarkup(
    <MenuSettingsBlock
      alwaysOnTop={false}
      onAlwaysOnTopChange={() => undefined}
      keepToolActive={true}
      onKeepToolActiveChange={() => undefined}
      previewMode="box"
      onPreviewModeChange={() => undefined}
    />,
  );

  assert.match(markup, /aria-expanded="false"/);
  assert.match(markup, /lucide-settings-2/);
  assert.match(markup, /menu-settings-block/);
  assert.match(markup, /data-menu-settings-height="24"/);
  assert.match(markup, /menu-settings-header[^>]*h-6/);
  assert.match(markup, /data-menu-settings-caption="true"[^>]*menu-settings-caption[^>]*leading-4/);
  assert.match(markup, /menu-settings-block[^>]*pt-2/);
  assert.match(markup, /Tool settings/);
  assert.doesNotMatch(markup, /Always on top/);
  assert.doesNotMatch(markup, /Tool mode/);
  assert.doesNotMatch(markup, />Preview</);
});

test("a footer-only tool menu can remove the redundant top separator", () => {
  const markup = renderToStaticMarkup(
    <MenuSettingsBlock
      compact
      alwaysOnTop={false}
      onAlwaysOnTopChange={() => undefined}
      keepToolActive={true}
      onKeepToolActiveChange={() => undefined}
      previewMode="box"
      onPreviewModeChange={() => undefined}
    />,
  );

  assert.match(markup, /data-compact="true"/);
  assert.match(markup, /border-t-0/);
  assert.doesNotMatch(markup, /before:absolute/);
  assert.match(markup, /menu-settings-header[^>]*h-6/);
  assert.match(markup, /data-menu-settings-caption="true"/);
});

test("a narrow settings footer uses compact controls for the Layers panel", () => {
  const markup = renderToStaticMarkup(
    <MenuSettingsBlock
      narrow
      alwaysOnTop={false}
      onAlwaysOnTopChange={() => undefined}
      keepToolActive={true}
      onKeepToolActiveChange={() => undefined}
      previewMode="box"
      onPreviewModeChange={() => undefined}
    />,
  );

  assert.match(markup, /data-narrow="true"/);
  assert.match(markup, /menu-settings-header[^>]*text-\[10px\]/);
});

test("expanded settings stay within a wrapping, non-scrolling menu surface", () => {
  const source = fs.readFileSync(
    new URL("../src/components/MenuSettingsBlock.tsx", import.meta.url),
    "utf8",
  );
  const markup = renderToStaticMarkup(
    <MenuSettingsBlock
      alwaysOnTop={false}
      onAlwaysOnTopChange={() => undefined}
      keepToolActive={true}
      onKeepToolActiveChange={() => undefined}
      previewMode="box"
      onPreviewModeChange={() => undefined}
    />,
  );

  assert.doesNotMatch(source, /overflow-x-auto|w-max|min-w-max/);
  assert.match(source, /menu-settings-content[^\n]*min-w-0/);
  assert.match(source, /flex-wrap/);
  assert.doesNotMatch(markup, /overflow-x-auto|w-max|min-w-max/);
});
