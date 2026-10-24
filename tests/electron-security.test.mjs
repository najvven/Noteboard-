import assert from "node:assert/strict";
import test from "node:test";

import {
  isAllowedEmbeddedWebUrl,
  isAllowedMainWindowNavigation,
  isAllowedWebPartition,
} from "../shared/electron-security.js";

const productionEntry = "file:///C:/Noteboard/dist/index.html";

test("main-window navigation allows only the exact development origin", () => {
  const options = {
    development: true,
    developmentOrigin: "http://localhost:3000",
    productionEntry,
  };

  assert.equal(isAllowedMainWindowNavigation("http://localhost:3000/board", options), true);
  assert.equal(isAllowedMainWindowNavigation("http://localhost:3000@evil.example", options), false);
  assert.equal(isAllowedMainWindowNavigation("http://evil.example/?next=http://localhost:3000", options), false);
  assert.equal(isAllowedMainWindowNavigation("http://user:pass@localhost:3000", options), false);
  assert.equal(isAllowedMainWindowNavigation("file:///C:/Noteboard/dist/index.html", options), false);
});

test("production navigation allows only the packaged entry file", () => {
  const options = {
    development: false,
    developmentOrigin: "http://localhost:3000",
    productionEntry,
  };

  assert.equal(isAllowedMainWindowNavigation(`${productionEntry}#board`, options), true);
  assert.equal(isAllowedMainWindowNavigation("file:///C:/Noteboard/dist/other.html", options), false);
  assert.equal(isAllowedMainWindowNavigation("file://server/share/index.html", options), false);
  assert.equal(isAllowedMainWindowNavigation("https://example.com", options), false);
  assert.equal(isAllowedMainWindowNavigation("not a URL", options), false);
});

test("embedded web fields accept only isolated partitions and network URLs", () => {
  assert.equal(isAllowedWebPartition("persist:noteboard-web-board_1"), true);
  assert.equal(isAllowedWebPartition("noteboard-web-temporary-1"), true);
  assert.equal(isAllowedWebPartition("persist:noteboard-web"), false);
  assert.equal(isAllowedWebPartition("persist:noteboard-web-board!"), false);
  assert.equal(isAllowedWebPartition("persist:other-board"), false);

  assert.equal(isAllowedEmbeddedWebUrl("https://example.com/path"), true);
  assert.equal(isAllowedEmbeddedWebUrl("http://localhost:8080"), true);
  assert.equal(isAllowedEmbeddedWebUrl("about:blank"), true);
  assert.equal(isAllowedEmbeddedWebUrl("data:text/html,unsafe"), false);
  assert.equal(isAllowedEmbeddedWebUrl("file:///C:/secret.txt"), false);
  assert.equal(isAllowedEmbeddedWebUrl("https://user:pass@example.com"), false);
});
