import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";

import NewPageScreen from "../src/components/NewPageScreen.tsx";

test("Create New Noteboard keeps a fixed responsive height and readable pixel fields", () => {
  const markup = renderToStaticMarkup(
    <NewPageScreen
      userPresets={[]}
      onStart={() => undefined}
      onBack={() => undefined}
    />,
  );

  assert.match(markup, /role="dialog"/);
  assert.match(markup, /data-new-noteboard-dialog="true"/);
  assert.match(markup, /data-new-noteboard-settings-panel="true"[^>]*overflow-x-hidden/);
  assert.match(markup, /h-\[min\(680px,90vh\)\]/);
  assert.match(markup, /data-size-toggle="true"/);
  assert.match(markup, /data-size-fields="true" hidden/);
  for (const label of ["Board Width", "Board Height", "Workspace Width", "Workspace Height"]) {
    assert.match(markup, new RegExp(`>${label}<`));
  }
  assert.doesNotMatch(markup, /Board (Width|Height) \(px\)/);
  assert.equal((markup.match(/lucide-info/g) ?? []).length, 1);
  assert.match(markup, /role="tooltip"/);
  assert.match(markup, /Board\/workspace dimensions use pixels\./);
  assert.match(markup, /bottom-full left-1\/2[^\"]*-translate-x-1\/2/);
  assert.match(markup, /w-40[^\"]*max-w-\[calc\(100vw-2rem\)\]/);
  assert.doesNotMatch(markup, /(?:Board|Workspace) (?:Width|Height) is measured in pixels/);
  assert.doesNotMatch(markup, /overflow-x-auto/);
});
